// Service worker: context menu, tab id replies, tab-note cleanup.

import type { GetTabIdResponse, LoginResponse, Message } from "./types.js";
import { deleteAllTabNotes, deleteTabNotes, onNotesChanged } from "./storage.js";
import { login, onAuthChanged } from "./auth.js";
import { ensureEncryptionReady } from "./encryption.js";
import { sync } from "./sync.js";
import { initI18n, onLangChanged, t } from "./i18n.js";

const SYNC_ALARM = "anchored-notes-sync";

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

// Sync triggers. sync() is a no-op for anonymous users, so these are safe to
// always register. Local note edits are debounced; a periodic alarm pulls
// changes made on other devices; signing in syncs immediately.
let syncTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSync(): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void sync(), 2000);
}

onNotesChanged(() => scheduleSync());
onAuthChanged((auth) => {
  // Set up the encryption key eagerly so a required custom password surfaces
  // in the UI right after sign-in instead of at the first sync attempt.
  // Errors (e.g. offline at sign-in) are logged; the periodic alarm retries.
  if (auth) {
    void ensureEncryptionReady()
      .then(() => sync())
      .catch((err: unknown) => {
        console.error("[anchored-notes] post-sign-in encryption setup failed:", err);
      });
  }
});

chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) void sync();
});

chrome.runtime.onMessage.addListener(
  (message: Message, sender, sendResponse) => {
    if (message.type === "GET_TAB_ID") {
      const response: GetTabIdResponse = { tabId: sender.tab?.id ?? -1 };
      sendResponse(response);
      return true;
    }
    if (message.type === "SYNC") {
      void sync();
      return undefined;
    }
    if (message.type === "LOGIN") {
      // Run the OAuth flow here, not in the popup: opening the auth window makes
      // the popup lose focus and close, which would kill an in-popup flow before
      // the token exchange completes.
      login()
        .then(() => sendResponse({ ok: true } satisfies LoginResponse))
        .catch((err: unknown) => {
          console.error("[anchored-notes] login failed:", err);
          sendResponse({ ok: false, error: String(err) } satisfies LoginResponse);
        });
      return true; // keep the message channel open for the async response
    }
    return undefined;
  },
);
