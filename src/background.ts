// Service worker: context menu, tab id replies, tab-note cleanup.

import type { GetTabIdResponse, LoginResponse, Message } from "./types.js";
import { PENDING_WARNING_KEY } from "./types.js";
import { deleteAllTabNotes, deleteTabNotes, onNotesChanged } from "./storage.js";
import { login, onAuthChanged } from "./auth.js";
import { ensureEncryptionReady } from "./encryption.js";
import { sync } from "./sync.js";
import { getLang, initI18n, onLangChanged, t } from "./i18n.js";
import { injectContentScript } from "./inject.js";
import { BACKEND_URL } from "./config.js";

const SYNC_ALARM = "anchored-notes-sync";

const MENU_ID = "anchored-notes-add";
const APPEND_MENU_ID = "anchored-notes-append-selection";

// Per-tab: whether the page has a visible note the append item can target.
// The context menu is global, so visibility follows the active tab's flag.
const appendTargetByTab = new Map<number, boolean>();
let activeTabId: number | undefined;

function syncAppendMenuVisibility(): void {
  // Default to visible when unknown (e.g. SW just woke). Hide only when the
  // content script has explicitly reported that this tab has no notes.
  // Do not use contextMenus.onShown — it is undefined in some Chrome builds
  // and crashes service-worker registration.
  const known =
    activeTabId !== undefined ? appendTargetByTab.get(activeTabId) : undefined;
  const visible = known !== false;
  chrome.contextMenus.update(APPEND_MENU_ID, { visible }, () => {
    void chrome.runtime.lastError;
  });
}

function buildContextMenu(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: t("addNoteHere", null),
      contexts: ["page", "selection", "link", "image"],
    });
    chrome.contextMenus.create(
      {
        id: APPEND_MENU_ID,
        title: t("addSelectionToNote", null),
        contexts: ["selection"],
      },
      () => syncAppendMenuVisibility(),
    );
  });
}

function sendToTab(tabId: number, message: Message): void {
  // Old tab (no content script): the first send fails; inject the bundle then
  // retry. If injection also fails, the page is genuinely restricted (e.g. a PDF
  // viewer). By then the gesture is stale, so only badge + pending flag are used
  // (the popup shows the toast when the user clicks the icon).
  chrome.tabs.sendMessage(tabId, message).catch(() =>
    injectContentScript(tabId)
      .then(() => chrome.tabs.sendMessage(tabId, message))
      .catch((err: unknown) => {
        console.warn("[anchored-notes] Could not send", message.type, ":", err);
        warnCantAddNote(tabId, false);
      }),
  );
}

async function createContextMenu(): Promise<void> {
  await initI18n();
  buildContextMenu();
}

// Declarative content scripts only load into tabs navigated after install, so
// tabs open from before this install/update have no content script and can't
// receive notes. Inject the bundle into every open http(s) tab so notes work
// (and existing notes render) without the user having to reload. Per-tab errors
// (discarded or restricted tabs) are swallowed.
async function injectIntoOpenTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  await Promise.all(
    tabs.map(async (tab) => {
      if (tab.id === undefined) return;
      try {
        await injectContentScript(tab.id);
      } catch {
        // Restricted (e.g. Web Store) or discarded tab: nothing to do.
      }
    })
  );
}

chrome.runtime.onInstalled.addListener((details) => {
  void createContextMenu();
  // First install: open the backend welcome page in a new tab. It's a normal
  // https page the content script matches, so the user can create their first
  // note there right away — avoiding the trap where the first note attempts land
  // on restricted pages (Web Store, New Tab) and look like the extension is broken.
  // Not on "update" so auto-updates don't spam a tab.
  if (details.reason === "install") {
    void openWelcomeTab();
  }
  if (details.reason === "install" || details.reason === "update") {
    void injectIntoOpenTabs();
  }
});

// Open the welcome page localized to the user's chosen language. The page
// falls back to the browser language when no ?lang is given, but passing it
// keeps the onboarding page in the same language as the extension UI.
async function openWelcomeTab(): Promise<void> {
  await initI18n();
  await chrome.tabs.create({ url: `${BACKEND_URL}/welcome?lang=${getLang()}` });
}

chrome.runtime.onStartup.addListener(() => {
  void createContextMenu();
  // Tab ids from the previous session are meaningless now: drop tab notes.
  void deleteAllTabNotes();
});

// Keep the context-menu label in sync when the language is switched at runtime.
// onLangChanged already updated the active language, so rebuild the menu (which
// also creates it if this service-worker wake never ran createContextMenu).
onLangChanged(() => buildContextMenu());

// Schemes/hosts where no extension content script can ever run. Detected
// synchronously from tab.url so we can warn the user while the click's user
// gesture is still fresh (openPopup requires it). Note: a page served over
// http(s) but rendered by a built-in viewer (e.g. PDF) looks normal here and is
// caught later by the injection failure path instead.
function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return true;
  return (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:") ||
    url.startsWith("devtools://") ||
    url.startsWith("view-source:") ||
    url.startsWith("https://chrome.google.com/webstore") ||
    url.startsWith("https://chromewebstore.google.com")
  );
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (tab?.id === undefined) return;
  const tabId = tab.id;

  // Known-restricted page: injection can't work. Warn now, while the gesture is
  // fresh, so openPopup() is permitted.
  if (isRestrictedUrl(tab.url)) {
    warnCantAddNote(tabId, true);
    return;
  }

  if (info.menuItemId === APPEND_MENU_ID) {
    sendToTab(tabId, {
      type: "APPEND_SELECTION",
      content: info.selectionText ?? "",
    });
    return;
  }

  if (info.menuItemId === MENU_ID) {
    sendToTab(tabId, { type: "CREATE_NOTE", content: info.selectionText ?? "" });
  }
});

chrome.tabs.onActivated.addListener((info) => {
  activeTabId = info.tabId;
  syncAppendMenuVisibility();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  appendTargetByTab.delete(tabId);
  if (activeTabId === tabId) activeTabId = undefined;
  syncAppendMenuVisibility();
  void deleteTabNotes(tabId);
});

// Seed activeTabId so the first SET_APPEND_TARGET from a content script can
// update visibility before any onActivated event.
void chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
  activeTabId = tabs[0]?.id;
  syncAppendMenuVisibility();
});

// The page can host neither the content script nor an in-page toast, so warn via
// the toolbar icon (works without any permission): a red "!" badge, plus a
// pending flag the popup reads to show the red error toast. When a fresh user
// gesture is available, also open the popup immediately so the reason is shown
// right away. openPopup() must be called synchronously within the gesture, so it
// runs before the async storage write; the popup catches the flag via its
// storage.onChanged listener even if it opens before the write lands.
function warnCantAddNote(tabId: number, canOpenPopup: boolean): void {
  void chrome.action.setBadgeBackgroundColor({ color: "#c0392b" });
  void chrome.action.setBadgeText({ tabId, text: "!" });
  if (canOpenPopup && chrome.action.openPopup) {
    chrome.action.openPopup().catch(() => undefined);
  }
  void chrome.storage.session.set({ [PENDING_WARNING_KEY]: tabId });
}

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
    if (message.type === "SET_APPEND_TARGET") {
      const tabId = sender.tab?.id;
      if (tabId !== undefined) {
        appendTargetByTab.set(tabId, message.hasTarget);
        if (tabId === activeTabId) syncAppendMenuVisibility();
      }
      return undefined;
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
