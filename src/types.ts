// Core domain types shared across the extension.

export const ANCHOR_SCOPES = ["global", "site", "page", "tab"] as const;
export type AnchorScope = (typeof ANCHOR_SCOPES)[number];

export const NOTE_COLORS = ["yellow", "green", "pink", "purple", "blue", "gray", "dark"] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

const ANCHOR_SCOPE_SET: ReadonlySet<string> = new Set(ANCHOR_SCOPES);
const NOTE_COLOR_SET: ReadonlySet<string> = new Set(NOTE_COLORS);

export function isAnchorScope(value: string): value is AnchorScope {
  return ANCHOR_SCOPE_SET.has(value);
}

export function isNoteColor(value: string): value is NoteColor {
  return NOTE_COLOR_SET.has(value);
}

export interface Note {
  id: string;
  content: string;
  color: NoteColor;
  scope: AnchorScope;
  anchorKey: string; // global:"" | site: origin | page: origin+pathname | tab: String(tabId)
  x: number;
  y: number;
  w: number;
  h: number;
  hidden?: boolean; // collapsed into the bottom-right badge instead of rendered
  createdAt: number;
  updatedAt: number;
}

export interface PageContext {
  origin: string; // e.g. https://www.google.com
  urlNoHash: string; // origin + pathname + search (no hash)
  tabId: number;
}

// Message protocol between contexts.
export type NoteCreateSource = "popup" | "context_menu";

export type Message =
  | { type: "GET_TAB_ID" }
  | { type: "CREATE_NOTE"; content: string; source: NoteCreateSource }
  | { type: "APPEND_SELECTION"; content: string }
  | { type: "SET_APPEND_TARGET"; hasTarget: boolean }
  | { type: "SYNC" }
  | { type: "LOGIN" }
  | { type: "GET_RUNTIME_CONFIG" }
  | { type: "REALTIME_SUBSCRIBE"; realtimeUrl: string; clientId: string }
  | { type: "STORAGE_WRITE"; write: StorageWrite }
  | { type: "ACCOUNT_MERGE"; choice: "upload" | "keep" | "delete" };

// Note-storage mutations that non-background contexts forward to the
// background worker, the single writer of the shared notes key (storage.ts).
export type StorageWrite =
  | { op: "saveNote"; note: Note }
  | { op: "createNote"; note: Note }
  | { op: "deleteNote"; id: string }
  | { op: "replaceAllNotes"; notes: Note[] }
  | { op: "wipeLocalNotes" }
  | { op: "bumpAllNoteTimestamps" }
  | { op: "clearAllDeletedNoteIds" };

// `created` is only set for createNote: false when the note limit was hit.
export type StorageWriteResponse =
  | { ok: true; created?: boolean }
  | { ok: false; error: string };

// Set by the background worker in chrome.storage.session (value: the tab id)
// when a note couldn't be added on a restricted page (no content script
// possible); the popup reads it on open, shows the error toast, then clears the
// flag and that tab's badge.
export const PENDING_WARNING_KEY = "pendingCantAddNote";

// Set by the background worker when sync() throws, cleared on the next
// successful run. The popup reads it to show a short retry notice (L9).
export const LAST_SYNC_ERROR_KEY = "lastSyncError";

export type LoginResponse = { ok: true } | { ok: false; error: string };

export type AccountMergeResponse = { ok: true } | { ok: false; error: string };

export type GetTabIdResponse = { tabId: number };

export type RuntimeConfigResponse =
  | { ok: true; pbUrl: string; oauthProvider: string }
  | { ok: false; error: string };

export type RealtimeSubscribeResponse =
  | { ok: true; status: number; gaveUp: boolean }
  | { ok: false; error: string };
