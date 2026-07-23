// Core domain types shared across the extension.

export type AnchorScope = "global" | "site" | "page" | "tab";

export type NoteColor = "yellow" | "green" | "pink" | "purple" | "blue" | "gray" | "dark";

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
export type Message =
  | { type: "GET_TAB_ID" }
  | { type: "CREATE_NOTE"; content: string }
  | { type: "APPEND_SELECTION"; content: string }
  | { type: "SET_APPEND_TARGET"; hasTarget: boolean }
  | { type: "SYNC" }
  | { type: "LOGIN" };

// Set by the background worker in chrome.storage.session (value: the tab id)
// when a note couldn't be added on a restricted page (no content script
// possible); the popup reads it on open, shows the error toast, then clears the
// flag and that tab's badge.
export const PENDING_WARNING_KEY = "pendingCantAddNote";

export type LoginResponse = { ok: true } | { ok: false; error: string };

export type GetTabIdResponse = { tabId: number };
