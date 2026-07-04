// Client-side encryption primitives for note content. Pure Web Crypto module:
// no project imports, and chrome.storage is only touched inside the key-state
// persistence functions, so the crypto core is unit-testable under node --test.
//
// Scheme: PBKDF2-SHA256 (600k iterations, per-user random salt) derives an
// AES-256-GCM key; each encryption uses a fresh random 12-byte IV. Wire format:
// `enc:v1:<base64(iv || ciphertext+tag)>`. Content without the prefix is
// legacy plaintext.

export const ENC_PREFIX = "enc:v1:";

const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
// Known plaintext encrypted into the server-side `encCheck` verifier so a
// device can test whether its derived key matches the account's key.
const CANARY = "anchored-notes-canary-v1";

const ENC_KEY_STATE_KEY = "encKeyState";
const ENC_STATUS_KEY = "encStatus";

// Persisted per-device key material: the raw AES key (so unlocking survives
// service-worker restarts), the encCheck it was verified against (staleness
// detection when the password changes on another device), and whether the key
// came from the default secret (user id) or a custom password.
export interface EncKeyState {
  rawKeyB64: string;
  encCheck: string;
  mode: "default" | "custom";
}

function toB64(bytes: Uint8Array): string {
  let bin = "";
  // Chunked to avoid call-stack limits on large contents.
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function isEncrypted(content: string): boolean {
  return content.startsWith(ENC_PREFIX);
}

export function generateSaltB64(): string {
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);
  return toB64(salt);
}

// Derives the AES-GCM key from a secret (custom password or default user id)
// and the account salt. Extractable so it can be persisted via exportKeyB64.
export async function deriveKey(secret: string, saltB64: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: fromB64(saltB64),
      iterations: PBKDF2_ITERATIONS,
    },
    material,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

export async function exportKeyB64(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return toB64(new Uint8Array(raw));
}

// Re-imports a persisted key as non-extractable (encrypt/decrypt only).
export async function importKeyB64(rawB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", fromB64(rawB64), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptContent(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = new Uint8Array(IV_BYTES);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  const packed = new Uint8Array(IV_BYTES + ciphertext.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(ciphertext), IV_BYTES);
  return ENC_PREFIX + toB64(packed);
}

export async function decryptContent(key: CryptoKey, payload: string): Promise<string> {
  if (!isEncrypted(payload)) {
    throw new Error(`decryptContent: payload missing "${ENC_PREFIX}" prefix`);
  }
  const packed = fromB64(payload.slice(ENC_PREFIX.length));
  if (packed.length <= IV_BYTES) {
    throw new Error(`decryptContent: payload too short (${packed.length} bytes)`);
  }
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: packed.subarray(0, IV_BYTES) },
      key,
      packed.subarray(IV_BYTES)
    );
    return new TextDecoder().decode(plaintext);
  } catch (err) {
    // GCM auth failure: wrong key or tampered ciphertext.
    throw new Error(`decryptContent: decryption failed: ${String(err)}`);
  }
}

// Builds the server-side verifier: the canary encrypted under the given key.
export async function makeEncCheck(key: CryptoKey): Promise<string> {
  return encryptContent(key, CANARY);
}

// Tests whether the key matches the account's verifier. A mismatch (wrong
// password / stale key) is an expected outcome, hence boolean, not throw.
export async function verifyEncCheck(key: CryptoKey, encCheck: string): Promise<boolean> {
  try {
    return (await decryptContent(key, encCheck)) === CANARY;
  } catch {
    return false;
  }
}

export async function storeKeyState(state: EncKeyState): Promise<void> {
  await chrome.storage.local.set({ [ENC_KEY_STATE_KEY]: state });
}

export async function loadKeyState(): Promise<EncKeyState | null> {
  const result = await chrome.storage.local.get(ENC_KEY_STATE_KEY);
  return (result[ENC_KEY_STATE_KEY] as EncKeyState | undefined) ?? null;
}

// Removes all encryption state from the device (logout / account deletion).
export async function wipeEncryptionState(): Promise<void> {
  await chrome.storage.local.remove([ENC_KEY_STATE_KEY, ENC_STATUS_KEY]);
}
