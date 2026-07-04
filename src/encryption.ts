// Encryption key lifecycle for synced notes. Every signed-in account is
// encrypted: without a custom password the key derives from the PocketBase
// user id (zero-friction encryption at rest); setting a custom password
// upgrades to true end-to-end encryption. The server only ever stores the
// opaque salt + verifier (encSalt/encCheck) — never the key or password.
//
// This module must not import sync.ts (sync.ts imports it); flows that need a
// sync afterwards rely on the storage-change listener in background.ts.

import { getAuthState } from "./auth.js";
import { BACKEND_URL } from "./config.js";
import {
  deriveKey,
  exportKeyB64,
  generateSaltB64,
  importKeyB64,
  loadKeyState,
  makeEncCheck,
  storeKeyState,
  verifyEncCheck,
  wipeEncryptionState,
} from "./crypto.js";
import { bumpAllNoteTimestamps } from "./storage.js";

export type EncStatus = "ready" | "password-required" | "unconfigured";

const ENC_STATUS_KEY = "encStatus";

// Subset of GET /api/me the encryption flows rely on.
interface MeResponse {
  id: string;
  encSalt: string;
  encCheck: string;
}

async function setEncStatus(status: EncStatus): Promise<void> {
  await chrome.storage.local.set({ [ENC_STATUS_KEY]: status });
}

export async function getEncStatus(): Promise<EncStatus> {
  const result = await chrome.storage.local.get(ENC_STATUS_KEY);
  return (result[ENC_STATUS_KEY] as EncStatus | undefined) ?? "unconfigured";
}

// Subscribe to encryption status changes across contexts (popup/options/bg).
export function onEncStatusChanged(listener: (status: EncStatus) => void): () => void {
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string
  ): void => {
    if (area !== "local" || !(ENC_STATUS_KEY in changes)) return;
    listener((changes[ENC_STATUS_KEY].newValue as EncStatus | undefined) ?? "unconfigured");
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

// Returns the persisted, verified key for this device, or null when absent
// (signed out, or a custom password hasn't been entered here yet).
export async function getReadyKey(): Promise<{ key: CryptoKey; encCheck: string; mode: "default" | "custom" } | null> {
  const state = await loadKeyState();
  if (!state) return null;
  return { key: await importKeyB64(state.rawKeyB64), encCheck: state.encCheck, mode: state.mode };
}

async function fetchMe(token: string): Promise<MeResponse> {
  const res = await fetch(`${BACKEND_URL}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`GET /api/me failed: ${res.status} ${await res.text()}`);
  }
  const me = (await res.json()) as Partial<MeResponse>;
  // A backend predating the encryption feature omits these fields; fail loudly
  // instead of deriving a key from undefined.
  if (typeof me.id !== "string" || me.id === "" ||
      typeof me.encSalt !== "string" || typeof me.encCheck !== "string") {
    throw new Error(
      `GET /api/me missing encryption fields (id/encSalt/encCheck) — backend not updated or migrate not run: ${JSON.stringify(me)}`
    );
  }
  return me as MeResponse;
}

async function putEncryption(
  token: string,
  encSalt: string,
  encCheck: string,
  expectedEncCheck: string
): Promise<Response> {
  return fetch(`${BACKEND_URL}/api/me/encryption`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ encSalt, encCheck, expectedEncCheck }),
  });
}

async function persistKey(key: CryptoKey, encCheck: string, mode: "default" | "custom"): Promise<void> {
  await storeKeyState({ rawKeyB64: await exportKeyB64(key), encCheck, mode });
  await setEncStatus("ready");
}

// Ensures this device has a verified encryption key, initializing the account
// on first use. Called after sign-in and lazily from sync().
// - Account has no salt yet: initialize with the default secret (user id).
// - Salt present: try the default key; failure means a custom password is set
//   on this account → "password-required" until the user unlocks.
export async function ensureEncryptionReady(): Promise<EncStatus> {
  const auth = await getAuthState();
  if (!auth) return "unconfigured";
  if ((await loadKeyState()) !== null) {
    // Staleness (password changed on another device) is detected by sync()
    // comparing the sync response's encCheck against the stored one.
    await setEncStatus("ready");
    return "ready";
  }

  let me = await fetchMe(auth.token);

  if (me.encSalt === "") {
    // First device ever on this account: initialize default-mode encryption.
    const salt = generateSaltB64();
    const key = await deriveKey(me.id, salt);
    const check = await makeEncCheck(key);
    const res = await putEncryption(auth.token, salt, check, "");
    if (res.status === 409) {
      // Another fresh device won the init race; adopt its salt/check below.
      me = await fetchMe(auth.token);
    } else if (!res.ok) {
      throw new Error(`PUT /api/me/encryption failed: ${res.status} ${await res.text()}`);
    } else {
      await persistKey(key, check, "default");
      return "ready";
    }
  }

  const defaultKey = await deriveKey(me.id, me.encSalt);
  if (await verifyEncCheck(defaultKey, me.encCheck)) {
    await persistKey(defaultKey, me.encCheck, "default");
    return "ready";
  }
  return markPasswordRequired();
}

// Attempts to unlock this device with a custom password. Returns false on a
// wrong password (expected outcome); throws on network/server errors.
export async function unlockWithPassword(password: string): Promise<boolean> {
  const auth = await getAuthState();
  if (!auth) throw new Error("unlockWithPassword: not signed in");
  const me = await fetchMe(auth.token);
  if (me.encSalt === "") {
    throw new Error("unlockWithPassword: account has no encryption state");
  }
  const key = await deriveKey(password, me.encSalt);
  if (!(await verifyEncCheck(key, me.encCheck))) return false;
  await persistKey(key, me.encCheck, "custom");
  return true;
}

// Sets (or changes) the custom encryption password. Server-first ordering: the
// new verifier is stored remotely before anything local changes, so other
// devices gate on the encCheck mismatch immediately and cannot push old-key
// ciphertext. Then all local notes get a timestamp bump so the next sync
// re-pushes every note re-encrypted under the new key. If that re-push dies
// midway, this device still holds full plaintext with bumped timestamps, so
// any retried sync converges; unreadable leftovers on other devices heal via
// the pull-side bump in sync.ts.
export async function setCustomPassword(newPassword: string): Promise<void> {
  const auth = await getAuthState();
  if (!auth) throw new Error("setCustomPassword: not signed in");
  const current = await loadKeyState();
  if (!current) throw new Error("setCustomPassword: no active encryption key on this device");

  const salt = generateSaltB64();
  const key = await deriveKey(newPassword, salt);
  const check = await makeEncCheck(key);
  const res = await putEncryption(auth.token, salt, check, current.encCheck);
  if (res.status === 409) {
    throw new Error("setCustomPassword: encryption state changed on another device");
  }
  if (!res.ok) {
    throw new Error(`PUT /api/me/encryption failed: ${res.status} ${await res.text()}`);
  }
  await persistKey(key, check, "custom");
  await bumpAllNoteTimestamps();
}

// Drops the device key and flags that a custom password must be entered.
// Called when sync detects a stale key or the default key stops verifying.
export async function markPasswordRequired(): Promise<EncStatus> {
  await wipeEncryptionState();
  await setEncStatus("password-required");
  return "password-required";
}

// Staleness-conditioned variant for sync: only wipes when the persisted key is
// still the one the (slow) sync round-trip started with. If unlock/set-password
// replaced the key mid-flight, the fresh key must survive.
export async function markPasswordRequiredIfStale(staleEncCheck: string): Promise<void> {
  const current = await loadKeyState();
  if (current !== null && current.encCheck !== staleEncCheck) return;
  await markPasswordRequired();
}
