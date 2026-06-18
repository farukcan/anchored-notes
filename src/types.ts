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
  | { type: "CREATE_NOTE" };

export type GetTabIdResponse = { tabId: number };
