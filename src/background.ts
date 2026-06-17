// Service worker: context menu, tab id replies, tab-note cleanup.

import type { GetTabIdResponse, Message } from "./types.js";
import { deleteAllTabNotes, deleteTabNotes } from "./storage.js";

const MENU_ID = "anchored-notes-add";

function createContextMenu(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Add Note Here",
      contexts: ["page", "selection", "link", "image"],
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  createContextMenu();
});

chrome.runtime.onStartup.addListener(() => {
  createContextMenu();
  // Tab ids from the previous session are meaningless now: drop tab notes.
  void deleteAllTabNotes();
});

chrome.contextMenus.onClicked.addListener((_info, tab) => {
  if (tab?.id === undefined) return;
  const message: Message = { type: "CREATE_NOTE" };
  chrome.tabs.sendMessage(tab.id, message).catch((err: unknown) => {
    console.warn("[anchored-notes] Could not send CREATE_NOTE:", err);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void deleteTabNotes(tabId);
});

chrome.runtime.onMessage.addListener(
  (message: Message, sender, sendResponse) => {
    if (message.type === "GET_TAB_ID") {
      const response: GetTabIdResponse = { tabId: sender.tab?.id ?? -1 };
      sendResponse(response);
      return true;
    }
    return undefined;
  },
);
