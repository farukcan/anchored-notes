// After a real account switch, leftover local notes would otherwise be pushed
// to the newly signed-in account. Sync is held until the user chooses to
// upload them, keep them device-only, or delete them.
//
// Logout records `lastAccountEmail`. A missing value is a session that
// predates this field (or a first-ever sign-in): treat the notes as already
// belonging to the current account so sync is not stalled behind a prompt.

import { getAuthState, getLastAccountEmail, setLastAccountEmail } from "./auth.js";
import {
  clearAllDeletedNoteIds,
  getAllNotes,
  setDeviceOnlyNoteIds,
  setLastSyncedAt,
  wipeLocalNotes,
} from "./storage.js";

export interface PendingAccountMerge {
  email: string;
  count: number;
}

export type AccountMergeChoice = "upload" | "keep" | "delete";

function syncableCount(notes: { scope: string }[]): number {
  return notes.filter((n) => n.scope !== "tab").length;
}

// Returns the prompt payload when this device has leftover notes from a
// *different* recorded account. Resolves itself when there is nothing to ask.
export async function getPendingAccountMerge(): Promise<PendingAccountMerge | null> {
  const auth = await getAuthState();
  if (!auth) return null;
  const last = await getLastAccountEmail();
  if (last === auth.email) return null;
  if (last === null) {
    await setLastAccountEmail(auth.email);
    return null;
  }
  const notes = await getAllNotes();
  const count = syncableCount(notes);
  if (count === 0) {
    await setLastAccountEmail(auth.email);
    return null;
  }
  return { email: auth.email, count };
}

export async function applyAccountMerge(choice: AccountMergeChoice): Promise<void> {
  const auth = await getAuthState();
  if (!auth) return;
  if (choice === "delete") {
    await wipeLocalNotes();
  } else if (choice === "keep") {
    const notes = (await getAllNotes()).filter((n) => n.scope !== "tab");
    await setDeviceOnlyNoteIds(notes.map((n) => n.id));
    const watermark = notes.reduce((max, note) => Math.max(max, note.updatedAt), 0);
    await setLastSyncedAt(watermark);
    await clearAllDeletedNoteIds();
  } else {
    // Upload: push every leftover note to this account. Reset the watermark
    // so a previous account's lastSyncedAt cannot hide them from dirty.
    await setDeviceOnlyNoteIds([]);
    await setLastSyncedAt(0);
    await clearAllDeletedNoteIds();
  }
  await setLastAccountEmail(auth.email);
}
