// chrome.storage.local access layer. All notes live under a single key.
// Tab-scoped notes are cleaned on browser startup (see background.ts), which
// makes them effectively session-only without a second storage area.

import type { Note } from "./types.js";

const NOTES_KEY = "notes";

type NotesMap = Record<string, Note>;

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

export function saveNote(note: Note): Promise<void> {
  return mutate((map) => {
    map[note.id] = note;
    return true;
  });
}

export function deleteNote(id: string): Promise<void> {
  return mutate((map) => {
    if (!(id in map)) return false;
    delete map[id];
    return true;
  });
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
