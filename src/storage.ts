// chrome.storage.local access layer. All notes live under a single key.
// Tab-scoped notes are cleaned on browser startup (see background.ts), which
// makes them effectively session-only without a second storage area.

import type { Note } from "./types.js";
import { getAuthState } from "./auth.js";

const NOTES_KEY = "notes";
const BADGE_OFFSET_KEY = "badgeOffset";
// Tombstones: ids of user-deleted notes not yet pushed to the sync backend.
const DELETED_KEY = "deletedNoteIds";

type NotesMap = Record<string, Note>;

// Persistent drag offset of the hidden-notes badge from its bottom-right
// anchor. Shared across all pages so the user can move it once to avoid
// overlapping other extensions' badges.
export interface BadgeOffset {
  dx: number; // pixels left of the anchor (>= 0)
  dy: number; // pixels up from the anchor (>= 0)
}

// Serialize read-modify-write cycles within this context so concurrent writes
// (e.g. dragging one card while another's debounced save fires) don't clobber
// each other on the single shared key.
let writeChain: Promise<void> = Promise.resolve();

function mutate(transform: (map: NotesMap) => boolean): Promise<void> {
  writeChain = writeChain.then(async () => {
    const map = await getNotesMap();
    if (transform(map)) await chrome.storage.local.set({ [NOTES_KEY]: map });
  });
  return writeChain;
}

export async function getNotesMap(): Promise<NotesMap> {
  const result = await chrome.storage.local.get(NOTES_KEY);
  const map = result[NOTES_KEY] as NotesMap | undefined;
  return map ?? {};
}

export async function getAllNotes(): Promise<Note[]> {
  return Object.values(await getNotesMap());
}

export async function saveNote(note: Note): Promise<void> {
  let switchedToTab = false;
  await mutate((map) => {
    const prev = map[note.id];
    switchedToTab = note.scope === "tab" && prev !== undefined && prev.scope !== "tab";
    map[note.id] = note;
    return true;
  });
  // Switching a synced note to tab scope unsyncs it: tombstone it so the next
  // sync drops the server copy. The note lives on locally as a session-only tab
  // note (applySyncResult keeps tab notes through the applied deletes).
  if (switchedToTab && (await getAuthState())) await recordDeletedNote(note.id);
}

export async function deleteNote(id: string): Promise<void> {
  await mutate((map) => {
    if (!(id in map)) return false;
    delete map[id];
    return true;
  });
  // Tombstone the deletion so the next sync removes it from the backend too.
  // Only signed-in users sync, so anonymous deletes don't accumulate tombstones.
  if (await getAuthState()) await recordDeletedNote(id);
}

export function deleteTabNotes(tabId: number): Promise<void> {
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

export function replaceAllNotes(notes: Note[]): Promise<void> {
  return mutate((map) => {
    for (const key of Object.keys(map)) delete map[key];
    for (const note of notes) map[note.id] = note;
    return true;
  });
}

async function recordDeletedNote(id: string): Promise<void> {
  const ids = await getDeletedNoteIds();
  if (ids.includes(id)) return;
  ids.push(id);
  await chrome.storage.local.set({ [DELETED_KEY]: ids });
}

export async function getDeletedNoteIds(): Promise<string[]> {
  const result = await chrome.storage.local.get(DELETED_KEY);
  return (result[DELETED_KEY] as string[] | undefined) ?? [];
}

export async function clearDeletedNoteIds(ids: string[]): Promise<void> {
  const remaining = (await getDeletedNoteIds()).filter((id) => !ids.includes(id));
  await chrome.storage.local.set({ [DELETED_KEY]: remaining });
}

// Remove all locally stored notes and pending deletion tombstones. Used after
// account deletion so no synced data lingers on the device.
export async function wipeLocalNotes(): Promise<void> {
  await chrome.storage.local.remove([NOTES_KEY, DELETED_KEY]);
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
//  - drop pushed notes the server no longer returns (deleted on another device),
//  - re-add over-limit rejected notes as local-only.
// tab-scoped notes and notes created after the push snapshot are left untouched.
// Returns without writing (no change event) when nothing actually changed, so a
// realtime-triggered sync doesn't bounce back as another storage change.
export function applySyncResult(params: {
  serverNotes: Note[];
  pushedIds: string[];
  rejected: Note[];
  appliedDeletes: string[];
}): Promise<void> {
  const pushed = new Set(params.pushedIds);
  const deleted = new Set(params.appliedDeletes);
  const rejectedIds = new Set(params.rejected.map((n) => n.id));
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
    for (const id of pushed) {
      if (!serverById.has(id) && !rejectedIds.has(id) && id in map) {
        delete map[id];
        changed = true;
      }
    }
    for (const note of params.rejected) {
      const local = map[note.id];
      if (!local || !sameNote(local, note)) {
        map[note.id] = note;
        changed = true;
      }
    }
    return changed;
  });
}

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
