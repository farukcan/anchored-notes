// Sync layer. For signed-in users it reconciles local notes with the backend:
// pushes local notes + pending deletions, pulls the authoritative set, and
// rewrites local storage. Anonymous users never sync (no-op). tab-scoped notes
// are session-only and excluded. Notes the backend rejects (over the plan
// limit) are kept locally so the user never loses data.

import { getAuthState, logout, updatePlan, type Plan } from "./auth.js";
import { BACKEND_URL } from "./config.js";
import {
  applySyncResult,
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
}

function toDTO(note: Note): NoteDTO {
  return {
    clientId: note.id,
    content: note.content,
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

function fromDTO(dto: NoteDTO): Note {
  return {
    id: dto.clientId,
    content: dto.content,
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
    const syncable = (await getAllNotes()).filter((n) => n.scope !== "tab");
    const deletes = await getDeletedNoteIds();

    const res = await fetch(`${BACKEND_URL}/api/notes/sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify({ upserts: syncable.map(toDTO), deletes }),
    });

    if (res.status === 401) {
      await logout();
      return;
    }
    if (!res.ok) {
      throw new Error(`sync failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as SyncResponse;

    // Keep notes the backend didn't store (over-limit or errored) local-only so
    // nothing is lost client-side.
    const notStored = new Set([...data.rejected, ...data.failed]);
    const keptLocal = syncable.filter((n) => notStored.has(n.id));

    // Server tombstones (deleted=true) tell us a note was deleted on another
    // device: drop it locally and don't render it.
    const liveNotes = data.notes.filter((n) => !n.deleted);
    const serverDeletedIds = data.notes.filter((n) => n.deleted).map((n) => n.clientId);

    // Atomic merge re-reads local state, so notes created/edited during the
    // round-trip survive (vs. a blanket overwrite of the snapshot).
    await applySyncResult({
      serverNotes: liveNotes.map(fromDTO),
      pushedIds: syncable.map((n) => n.id),
      rejected: keptLocal,
      appliedDeletes: [...deletes, ...serverDeletedIds],
    });
    await clearDeletedNoteIds(deletes);

    if (data.plan !== auth.plan) await updatePlan(data.plan);
  } finally {
    inFlight = false;
  }
}
