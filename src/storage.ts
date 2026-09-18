// chrome.storage.local access layer. All notes live under a single key.
// Tab-scoped notes are cleaned on browser startup (see background.ts), which
// makes them effectively session-only without a second storage area.
//
// Writes have exactly one owner: the background service worker. Every other
// context (each tab's content script, the popup, the options page) is its own
// JS realm, so a per-realm queue can't stop two contexts from interleaving
// their read-modify-write cycles on the shared key and one overwriting the
// other's change. Those contexts forward writes as STORAGE_WRITE messages and
// the worker applies them through one serialized queue. Reads and change
// listeners stay local to every context.

import type { Message, Note, StorageWrite, StorageWriteResponse } from "./types.js";
import { getAuthState } from "./auth.js";
import { getCurrentLimit } from "./limits.js";

const NOTES_KEY = "notes";
const BADGE_OFFSET_KEY = "badgeOffset";
// Tombstones: ids of user-deleted notes not yet pushed to the sync backend.
const DELETED_KEY = "deletedNoteIds";
// Watermark for delta push: only notes with updatedAt newer than this are
// re-encrypted and sent. Pull still returns the authoritative set.
const LAST_SYNCED_AT_KEY = "lastSyncedAt";
// Note ids the user chose to keep device-only after an account switch.
const DEVICE_ONLY_KEY = "deviceOnlyNoteIds";

type NotesMap = Record<string, Note>;

// Persistent drag offset of the hidden-notes badge from its bottom-right
// anchor. Shared across all pages so the user can move it once to avoid
// overlapping other extensions' badges.
export interface BadgeOffset {
  dx: number; // pixels left of the anchor (>= 0)
  dy: number; // pixels up from the anchor (>= 0)
}

// The service worker is the only extension context without a `window`
// (so are the node test runs, which therefore write directly).
const isWriter = typeof window === "undefined";

function assertWriter(name: string): void {
  if (!isWriter) throw new Error(`storage.${name} may only run in the background worker`);
}

// ---------------------------------------------------------------------------
// Serialized write queue (background worker only)

let writeChain: Promise<void> = Promise.resolve();

// Run `step` after every previously queued write has settled. A failed step
// must not poison the queue for the writes behind it.
function enqueue<T>(step: () => Promise<T>): Promise<T> {
  const run = writeChain.then(step);
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// Which of the two stored collections a transform touched; only those keys
// are written, so an untouched key emits no storage change event.
interface Changed {
  notes?: boolean;
  deleted?: boolean;
}

// One serialized read-modify-write over the notes map and the tombstone set
// together, so a note deletion and its tombstone land in a single write and
// no other queued write can slip between them.
function mutateState(
  transform: (notes: NotesMap, deleted: Set<string>) => Changed,
): Promise<void> {
  return enqueue(async () => {
    const result = await chrome.storage.local.get([NOTES_KEY, DELETED_KEY]);
    const notes = (result[NOTES_KEY] as NotesMap | undefined) ?? {};
    const deleted = new Set((result[DELETED_KEY] as string[] | undefined) ?? []);
    const changed = transform(notes, deleted);
    const items: Record<string, unknown> = {};
    if (changed.notes) items[NOTES_KEY] = notes;
    if (changed.deleted) items[DELETED_KEY] = [...deleted];
    if (Object.keys(items).length > 0) await chrome.storage.local.set(items);
  });
}

function mutate(transform: (map: NotesMap) => boolean): Promise<void> {
  return mutateState((notes) => ({ notes: transform(notes) }));
}

// ---------------------------------------------------------------------------
// Reads (any context)

export async function getNotesMap(): Promise<NotesMap> {
  const result = await chrome.storage.local.get(NOTES_KEY);
  const map = result[NOTES_KEY] as NotesMap | undefined;
  return map ?? {};
}

export async function getAllNotes(): Promise<Note[]> {
  return Object.values(await getNotesMap());
}

export async function getDeletedNoteIds(): Promise<string[]> {
  const result = await chrome.storage.local.get(DELETED_KEY);
  return (result[DELETED_KEY] as string[] | undefined) ?? [];
}

// ---------------------------------------------------------------------------
// Writes available to every context (forwarded to the worker when needed)

async function sendWrite(write: StorageWrite): Promise<StorageWriteResponse> {
  const message: Message = { type: "STORAGE_WRITE", write };
  let response: StorageWriteResponse | undefined;
  try {
    response = (await chrome.runtime.sendMessage(message)) as StorageWriteResponse | undefined;
  } catch (err) {
    throw new Error(
      `storage.${write.op}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!response) {
    throw new Error(`storage.${write.op}: no response from the background worker`);
  }
  return response;
}

async function submit(write: StorageWrite): Promise<StorageWriteResponse & { ok: true }> {
  const response = isWriter ? await applyStorageWrite(write) : await sendWrite(write);
  if (!response.ok) throw new Error(response.error);
  return response;
}

// Executes a forwarded write in the background worker. Also the local path
// when this context is the worker itself.
export async function applyStorageWrite(write: StorageWrite): Promise<StorageWriteResponse> {
  try {
    switch (write.op) {
      case "saveNote":
        await saveNoteLocal(write.note);
        return { ok: true };
      case "createNote":
        return { ok: true, created: await createNoteLocal(write.note) };
      case "deleteNote":
        await deleteNoteLocal(write.id);
        return { ok: true };
      case "replaceAllNotes":
        await replaceAllNotesLocal(write.notes);
        return { ok: true };
      case "wipeLocalNotes":
        await enqueue(() =>
          chrome.storage.local.remove([
            NOTES_KEY,
            DELETED_KEY,
            LAST_SYNCED_AT_KEY,
            DEVICE_ONLY_KEY,
          ]),
        );
        return { ok: true };
      case "bumpAllNoteTimestamps":
        await bumpAllNoteTimestampsLocal();
        return { ok: true };
      case "clearAllDeletedNoteIds":
        await mutateState((_notes, deleted) => {
          if (deleted.size === 0) return {};
          deleted.clear();
          return { deleted: true };
        });
        return { ok: true };
      default: {
        const _exhaustive: never = write;
        return { ok: false, error: `unknown storage write: ${JSON.stringify(_exhaustive)}` };
      }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function saveNote(note: Note): Promise<void> {
  await submit({ op: "saveNote", note });
}

// Inserts a new note unless the account's quota is already used up. Returns
// false (and writes nothing) when the limit was hit.
export async function createNote(note: Note): Promise<boolean> {
  return (await submit({ op: "createNote", note })).created === true;
}

export async function deleteNote(id: string): Promise<void> {
  await submit({ op: "deleteNote", id });
}

export async function replaceAllNotes(notes: Note[]): Promise<void> {
  await submit({ op: "replaceAllNotes", notes });
}

// Remove all locally stored notes and pending deletion tombstones. Used after
// account deletion so no synced data lingers on the device.
export async function wipeLocalNotes(): Promise<void> {
  await submit({ op: "wipeLocalNotes" });
}

// Bump updatedAt on all syncable (non-tab) notes by 1ms so the server's
// strictly-newer LWW check accepts a re-push of unchanged content. Used when
// the encryption key changes and every note must be re-encrypted server-side.
export async function bumpAllNoteTimestamps(): Promise<void> {
  await submit({ op: "bumpAllNoteTimestamps" });
}

export async function clearAllDeletedNoteIds(): Promise<void> {
  await submit({ op: "clearAllDeletedNoteIds" });
}

export async function getDeviceOnlyNoteIds(): Promise<Set<string>> {
  const result = await chrome.storage.local.get(DEVICE_ONLY_KEY);
  return new Set((result[DEVICE_ONLY_KEY] as string[] | undefined) ?? []);
}

export async function setDeviceOnlyNoteIds(ids: string[]): Promise<void> {
  if (ids.length === 0) {
    await chrome.storage.local.remove(DEVICE_ONLY_KEY);
    return;
  }
  await chrome.storage.local.set({ [DEVICE_ONLY_KEY]: ids });
}

async function saveNoteLocal(note: Note): Promise<void> {
  const signedIn = (await getAuthState()) !== null;
  await mutateState((notes, deleted) => {
    const prev = notes[note.id];
    notes[note.id] = note;
    // Switching a synced note to tab scope unsyncs it: tombstone it so the next
    // sync drops the server copy. The note lives on locally as a session-only
    // tab note (applySyncResult keeps tab notes through the applied deletes).
    // Only signed-in users sync, so anonymous switches leave no tombstone.
    const switchedToTab = note.scope === "tab" && prev !== undefined && prev.scope !== "tab";
    const tombstone = signedIn && switchedToTab && !deleted.has(note.id);
    if (tombstone) deleted.add(note.id);
    return { notes: true, deleted: tombstone };
  });
}

// The limit check runs inside the serialized write, so two near-simultaneous
// creates can't both pass against the same snapshot.
async function createNoteLocal(note: Note): Promise<boolean> {
  const limit = await getCurrentLimit();
  let created = false;
  await mutate((notes) => {
    if (Object.keys(notes).length >= limit) return false;
    notes[note.id] = note;
    created = true;
    return true;
  });
  return created;
}

async function deleteNoteLocal(id: string): Promise<void> {
  const signedIn = (await getAuthState()) !== null;
  await mutateState((notes, deleted) => {
    const present = id in notes;
    if (present) delete notes[id];
    // Tombstone the deletion so the next sync removes it from the backend too.
    // Only signed-in users sync, so anonymous deletes don't accumulate tombstones.
    const tombstone = signedIn && !deleted.has(id);
    if (tombstone) deleted.add(id);
    return { notes: present, deleted: tombstone };
  });
}

// Import: the incoming set becomes the whole local set. For a signed-in
// account the notes the import drops are tombstoned, so the next sync deletes
// their server copies instead of pulling them straight back; pending
// tombstones for re-imported ids are lifted so that sync doesn't delete them.
async function replaceAllNotesLocal(incoming: Note[]): Promise<void> {
  const signedIn = (await getAuthState()) !== null;
  await mutateState((notes, deleted) => {
    const incomingIds = new Set(incoming.map((n) => n.id));
    let deletedChanged = false;
    for (const [id, note] of Object.entries(notes)) {
      if (signedIn && !incomingIds.has(id) && note.scope !== "tab" && !deleted.has(id)) {
        deleted.add(id);
        deletedChanged = true;
      }
      delete notes[id];
    }
    for (const note of incoming) {
      notes[note.id] = note;
      if (deleted.delete(note.id)) deletedChanged = true;
    }
    return { notes: true, deleted: deletedChanged };
  });
  await chrome.storage.local.set({ [LAST_SYNCED_AT_KEY]: 0 });
}

export async function getLastSyncedAt(): Promise<number> {
  const result = await chrome.storage.local.get(LAST_SYNCED_AT_KEY);
  const value = result[LAST_SYNCED_AT_KEY];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function setLastSyncedAt(ts: number): Promise<void> {
  await chrome.storage.local.set({ [LAST_SYNCED_AT_KEY]: ts });
}

function bumpAllNoteTimestampsLocal(): Promise<void> {
  return mutate((map) => {
    let changed = false;
    for (const note of Object.values(map)) {
      if (note.scope === "tab") continue;
      note.updatedAt += 1;
      changed = true;
    }
    return changed;
  });
}

// ---------------------------------------------------------------------------
// Background-only writes (tab lifecycle and sync)

export function deleteTabNotes(tabId: number): Promise<void> {
  assertWriter("deleteTabNotes");
  const key = String(tabId);
  return mutate((map) => {
    let changed = false;
    for (const note of Object.values(map)) {
      if (note.scope === "tab" && note.anchorKey === key) {
        delete map[note.id];
        changed = true;
      }
    }
    return changed;
  });
}

export function deleteAllTabNotes(): Promise<void> {
  assertWriter("deleteAllTabNotes");
  return mutate((map) => {
    let changed = false;
    for (const note of Object.values(map)) {
      if (note.scope === "tab") {
        delete map[note.id];
        changed = true;
      }
    }
    return changed;
  });
}

export function clearDeletedNoteIds(ids: string[]): Promise<void> {
  assertWriter("clearDeletedNoteIds");
  return mutateState((_notes, deleted) => {
    let changed = false;
    for (const id of ids) if (deleted.delete(id)) changed = true;
    return { deleted: changed };
  });
}

// Bump specific notes to the given updatedAt values (id -> new timestamp).
// Used by the pull-side self-heal: notes whose server copy is legacy plaintext
// or unreadable get re-pushed encrypted on the follow-up sync.
export function bumpNoteTimestamps(timestamps: Map<string, number>): Promise<void> {
  assertWriter("bumpNoteTimestamps");
  return mutate((map) => {
    let changed = false;
    for (const [id, updatedAt] of timestamps) {
      const note = map[id];
      if (!note || note.scope === "tab") continue;
      if (note.updatedAt >= updatedAt) continue;
      note.updatedAt = updatedAt;
      changed = true;
    }
    return changed;
  });
}

// Field-wise note equality, used to skip storage writes when a sync produced no
// real change (JSON.stringify would be sensitive to key order).
function sameNote(a: Note, b: Note): boolean {
  return (
    a.content === b.content &&
    a.color === b.color &&
    a.scope === b.scope &&
    a.anchorKey === b.anchorKey &&
    a.x === b.x &&
    a.y === b.y &&
    a.w === b.w &&
    a.h === b.h &&
    (a.hidden ?? false) === (b.hidden ?? false) &&
    a.createdAt === b.createdAt &&
    a.updatedAt === b.updatedAt
  );
}

// Merge a sync response into local storage atomically (single read-modify-write
// so notes created or edited during the network round-trip aren't lost):
//  - drop notes we deleted (appliedDeletes),
//  - adopt each server note unless the local copy has a strictly newer edit,
//  - re-add over-limit rejected notes as local-only.
// A pushed note the server neither returned nor listed as rejected/failed is
// left alone: deletions arrive as explicit server tombstones, so that gap can
// only be an inconsistent response, and silently dropping the note would
// turn it into data loss.
// tab-scoped notes and notes created after the push snapshot are left untouched.
// Returns without writing (no change event) when nothing actually changed, so a
// realtime-triggered sync doesn't bounce back as another storage change.
export function applySyncResult(params: {
  serverNotes: Note[];
  rejected: Note[];
  appliedDeletes: string[];
}): Promise<void> {
  assertWriter("applySyncResult");
  const deleted = new Set(params.appliedDeletes);
  const serverById = new Map(params.serverNotes.map((n) => [n.id, n]));
  return mutate((map) => {
    let changed = false;
    for (const id of deleted) {
      const local = map[id];
      if (!local) continue;
      // A note switched to tab scope is tombstoned to drop its server copy, but
      // stays locally as a session-only tab note — don't delete it here.
      if (local.scope === "tab") continue;
      delete map[id];
      changed = true;
    }
    for (const [id, serverNote] of serverById) {
      const local = map[id];
      // A note switched to tab scope is session-only and authoritative locally;
      // never let the stale pre-switch server copy overwrite it back.
      if (local && local.scope === "tab") continue;
      if (local && local.updatedAt > serverNote.updatedAt) continue;
      if (!local || !sameNote(local, serverNote)) {
        map[id] = serverNote;
        changed = true;
      }
    }
    for (const note of params.rejected) {
      const local = map[note.id];
      // Don't roll back an edit made during the sync round-trip: the kept-local
      // copy is the pre-push snapshot and may be older than the live note.
      if (local && local.updatedAt > note.updatedAt) continue;
      if (!local || !sameNote(local, note)) {
        map[note.id] = note;
        changed = true;
      }
    }
    return changed;
  });
}

// ---------------------------------------------------------------------------
// Badge offset (single key, last write wins by design)

export async function getBadgeOffset(): Promise<BadgeOffset> {
  const result = await chrome.storage.local.get(BADGE_OFFSET_KEY);
  const offset = result[BADGE_OFFSET_KEY] as BadgeOffset | undefined;
  return offset ?? { dx: 0, dy: 0 };
}

export async function saveBadgeOffset(offset: BadgeOffset): Promise<void> {
  await chrome.storage.local.set({ [BADGE_OFFSET_KEY]: offset });
}

export function onBadgeOffsetChanged(
  listener: (offset: BadgeOffset) => void
): () => void {
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string
  ): void => {
    if (area !== "local" || !(BADGE_OFFSET_KEY in changes)) return;
    listener(
      (changes[BADGE_OFFSET_KEY].newValue as BadgeOffset | undefined) ?? {
        dx: 0,
        dy: 0
      }
    );
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

export function onNotesChanged(listener: (notes: NotesMap) => void): () => void {
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string
  ): void => {
    if (area !== "local" || !(NOTES_KEY in changes)) return;
    listener((changes[NOTES_KEY].newValue as NotesMap | undefined) ?? {});
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
