// Sync layer. For signed-in users it reconciles local notes with the backend:
// pushes local notes + pending deletions, pulls the authoritative set, and
// rewrites local storage. Anonymous users never sync (no-op). tab-scoped notes
// are session-only and excluded. Notes the backend rejects (over the plan
// limit) are kept locally so the user never loses data.

import { getAuthState, logout, updatePlan, type Plan } from "./auth.js";
import { BACKEND_URL } from "./config.js";
import { decryptContent, encryptContent, isEncrypted } from "./crypto.js";
import {
  ensureEncryptionReady,
  getReadyKey,
  markPasswordRequiredIfStale,
} from "./encryption.js";
import {
  applySyncResult,
  bumpNoteTimestamps,
  clearDeletedNoteIds,
  getAllNotes,
  getDeletedNoteIds,
} from "./storage.js";
import type { AnchorScope, Note, NoteColor } from "./types.js";

interface NoteDTO {
  clientId: string;
  content: string;
  color: string;
  scope: string;
  anchorKey: string;
  x: number;
  y: number;
  w: number;
  h: number;
  hidden: boolean;
  deleted: boolean;
  noteCreatedAt: number;
  noteUpdatedAt: number;
}

interface SyncResponse {
  notes: NoteDTO[];
  rejected: string[];
  failed: string[];
  plan: Plan;
  limit: number;
  encCheck: string;
}

// Content is encrypted at this boundary: local notes stay plaintext, the
// server only ever sees `enc:v1:` ciphertext.
async function toDTO(note: Note, key: CryptoKey): Promise<NoteDTO> {
  return {
    clientId: note.id,
    content: await encryptContent(key, note.content),
    color: note.color,
    scope: note.scope,
    anchorKey: note.anchorKey,
    x: note.x,
    y: note.y,
    w: note.w,
    h: note.h,
    hidden: note.hidden ?? false,
    deleted: false,
    noteCreatedAt: note.createdAt,
    noteUpdatedAt: note.updatedAt,
  };
}

// content arrives already decrypted (or as accepted legacy plaintext).
function fromDTO(dto: NoteDTO, content: string): Note {
  return {
    id: dto.clientId,
    content,
    color: dto.color as NoteColor,
    scope: dto.scope as AnchorScope,
    anchorKey: dto.anchorKey,
    x: dto.x,
    y: dto.y,
    w: dto.w,
    h: dto.h,
    hidden: dto.hidden,
    createdAt: dto.noteCreatedAt,
    updatedAt: dto.noteUpdatedAt,
  };
}

// Guard against overlapping runs (debounced change + periodic alarm).
let inFlight = false;

export async function sync(): Promise<void> {
  if (inFlight) return;
  const auth = await getAuthState();
  if (!auth) return;

  inFlight = true;
  try {
    // No verified encryption key on this device (e.g. a custom password not
    // yet entered) means no sync: pushing would need the key, and pulling
    // would yield undecryptable content.
    let keyState = await getReadyKey();
    if (!keyState) {
      const status = await ensureEncryptionReady();
      if (status !== "ready") return;
      keyState = await getReadyKey();
      if (!keyState) throw new Error("sync: encryption ready but key state missing");
    }
    const key = keyState.key;

    const syncable = (await getAllNotes()).filter((n) => n.scope !== "tab");
    const deletes = await getDeletedNoteIds();
    const localById = new Map(syncable.map((n) => [n.id, n]));

    const upserts = await Promise.all(syncable.map((n) => toDTO(n, key)));

    const res = await fetch(`${BACKEND_URL}/api/notes/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify({ upserts, deletes, encCheck: keyState.encCheck }),
    });

    if (res.status === 401) {
      await logout();
      return;
    }
    // 409: the account's verifier changed (password set/changed on another
    // device) and the server rejected this push before applying anything.
    if (res.status === 409) {
      await markPasswordRequiredIfStale(keyState.encCheck);
      return;
    }
    if (!res.ok) {
      throw new Error(`sync failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as SyncResponse;

    // Belt-and-braces staleness check for servers that don't enforce the
    // request encCheck: apply nothing with a stale key.
    if (data.encCheck !== keyState.encCheck) {
      await markPasswordRequiredIfStale(keyState.encCheck);
      return;
    }

    // Keep notes the backend didn't store (over-limit or errored) local-only so
    // nothing is lost client-side.
    const notStored = new Set([...data.rejected, ...data.failed]);
    const keptLocal = syncable.filter((n) => notStored.has(n.id));

    // Server tombstones (deleted=true) tell us a note was deleted on another
    // device: drop it locally and don't render it.
    const liveNotes = data.notes.filter((n) => !n.deleted);
    const serverDeletedIds = data.notes.filter((n) => n.deleted).map((n) => n.clientId);

    // Decrypt pulled content. `bumps` collects notes whose server copy must be
    // re-pushed encrypted (legacy plaintext or unreadable): bumping the local
    // updatedAt to serverTs+1 makes the server's strictly-newer LWW accept the
    // follow-up push while a genuinely newer edit elsewhere still wins.
    const serverNotes: Note[] = [];
    const bumps = new Map<string, number>();
    for (const dto of liveNotes) {
      if (!isEncrypted(dto.content)) {
        // Legacy plaintext from before encryption: accept and self-heal.
        serverNotes.push(fromDTO(dto, dto.content));
        bumps.set(dto.clientId, dto.noteUpdatedAt + 1);
        continue;
      }
      try {
        serverNotes.push(fromDTO(dto, await decryptContent(key, dto.content)));
      } catch (err) {
        console.error(`[anchored-notes] cannot decrypt note ${dto.clientId}:`, err);
        const local = localById.get(dto.clientId);
        if (local) {
          // Route through the kept-local path so applySyncResult doesn't drop
          // the note as "pushed but missing", then re-push it encrypted.
          keptLocal.push(local);
          bumps.set(dto.clientId, dto.noteUpdatedAt + 1);
        }
        // No local copy: leave the server record alone; a device that can
        // read it will heal it.
      }
    }

    // Atomic merge re-reads local state, so notes created/edited during the
    // round-trip survive (vs. a blanket overwrite of the snapshot).
    await applySyncResult({
      serverNotes,
      pushedIds: syncable.map((n) => n.id),
      rejected: keptLocal,
      appliedDeletes: [...deletes, ...serverDeletedIds],
    });
    await clearDeletedNoteIds(deletes);
    // The bump is a notes-storage write, so the existing change listener in
    // background.ts schedules the follow-up sync that pushes the ciphertext.
    if (bumps.size > 0) await bumpNoteTimestamps(bumps);

    if (data.plan !== auth.plan) await updatePlan(data.plan);
  } finally {
    inFlight = false;
  }
}
