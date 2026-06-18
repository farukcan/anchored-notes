// Service worker: context menu, tab id replies, tab-note cleanup.

import type { GetTabIdResponse, Message } from "./types.js";
import { deleteAllTabNotes, deleteTabNotes } from "./storage.js";
import { initI18n, onLangChanged, t } from "./i18n.js";

const MENU_ID = "anchored-notes-add";

function buildContextMenu(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: t("addNoteHere", null),
      contexts: ["page", "selection", "link", "image"],
    });
  });
}

async function createContextMenu(): Promise<void> {
  await initI18n();
  buildContextMenu();
}

chrome.runtime.onInstalled.addListener(() => {
  void createContextMenu();
});

chrome.runtime.onStartup.addListener(() => {
  void createContextMenu();
  // Tab ids from the previous session are meaningless now: drop tab notes.
  void deleteAllTabNotes();
});

// Keep the context-menu label in sync when the language is switched at runtime.
// onLangChanged already updated the active language, so rebuild the menu (which
// also creates it if this service-worker wake never ran createContextMenu).
onLangChanged(() => buildContextMenu());

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (tab?.id === undefined) return;
  const message: Message = { type: "CREATE_NOTE", content: info.selectionText ?? "" };
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
