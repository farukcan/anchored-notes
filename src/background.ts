// Service worker: context menu, tab id replies, tab-note cleanup, and the
// single writer of note storage (see storage.ts).

import type {
  AccountMergeResponse,
  GetTabIdResponse,
  LoginResponse,
  Message,
  RealtimeSubscribeResponse,
  RuntimeConfigResponse,
} from "./types.js";
import { LAST_SYNC_ERROR_KEY, PENDING_WARNING_KEY } from "./types.js";
import {
  applyStorageWrite,
  deleteAllTabNotes,
  deleteTabNotes,
  onNotesChanged,
} from "./storage.js";
import {
  getAuthState,
  getLastAccountEmail,
  login,
  onAuthChanged,
  refreshIfExpiringSoon,
  setLastAccountEmail,
} from "./auth.js";
import { applyAccountMerge, getPendingAccountMerge } from "./account-merge.js";
import { ensureEncryptionReady } from "./encryption.js";
import { isApplyingSyncResult, sync } from "./sync.js";
import { getLang, initI18n, onLangChanged, t } from "./i18n.js";
import { injectContentScript } from "./inject.js";
import { BACKEND_URL, getRuntimeConfig } from "./config.js";
import { subscribeRealtime } from "./realtime.js";
import { track } from "./umami.js";

const SYNC_ALARM = "anchored-notes-sync";
// How long the "!" badge (and its pending flag) stays if the popup never
// opens to consume the warning.
const WARNING_BADGE_MS = 10_000;

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
// tabs open from before this install/update have no content script. Injecting
// the  bundle into every open tab on update spikes CPU; only the active tab
// of each window is injected now, and background tabs get it when focused.
async function injectIntoActiveTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({
    active: true,
    url: ["http://*/*", "https://*/*"],
  });
  await Promise.all(tabs.map((tab) => (tab.id !== undefined ? injectIntoTab(tab.id) : undefined)));
}

async function injectIntoTab(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  if (!tab?.url || !/^https?:/.test(tab.url)) return;
  try {
    await injectContentScript(tabId);
  } catch {
    // Restricted (e.g. Web Store) or discarded tab: nothing to do.
  }
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
    void injectIntoActiveTabs();
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
    sendToTab(tabId, {
      type: "CREATE_NOTE",
      content: info.selectionText ?? "",
      source: "context_menu",
    });
  }
});

chrome.tabs.onActivated.addListener((info) => {
  activeTabId = info.tabId;
  syncAppendMenuVisibility();
  void injectIntoTab(info.tabId);
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
  // Otherwise the badge would sit there until the tab closes, and the flag
  // would toast on some unrelated popup open much later.
  setTimeout(() => void clearCantAddNoteWarning(tabId), WARNING_BADGE_MS);
}

async function clearCantAddNoteWarning(tabId: number): Promise<void> {
  // The tab may be gone by now.
  await chrome.action.setBadgeText({ tabId, text: "" }).catch(() => undefined);
  const res = await chrome.storage.session.get(PENDING_WARNING_KEY);
  // A newer warning for another tab owns the flag now; leave it.
  if (res[PENDING_WARNING_KEY] === tabId) {
    await chrome.storage.session.remove(PENDING_WARNING_KEY);
  }
}

// storage.session is readable only from trusted contexts by default; the
// content script (umami's note_edited throttle) needs it too. Idempotent, so
// it simply runs on every worker start.
void chrome.storage.session.setAccessLevel({
  accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS",
});

// Sync triggers. sync() is a no-op for anonymous users, so these are safe to
// always register. Local note edits are debounced; a periodic alarm pulls
// changes made on other devices; signing in syncs immediately.
function runSync(): void {
  sync()
    .then(() => chrome.storage.session.remove(LAST_SYNC_ERROR_KEY))
    .catch((err: unknown) => {
      console.error("[anchored-notes] sync failed:", err);
      void chrome.storage.session.set({ [LAST_SYNC_ERROR_KEY]: true });
    });
}

let syncTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSync(): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(runSync, 2000);
}

onNotesChanged(() => {
  if (isApplyingSyncResult()) return;
  scheduleSync();
});
onAuthChanged((auth, previous) => {
  // Set up the encryption key eagerly so a required custom password surfaces
  // in the UI right after sign-in instead of at the first sync attempt.
  // Errors (e.g. offline at sign-in) are logged; the periodic alarm retries.
  // Rewrites of the same account (a token refresh, sync's own plan update)
  // aren't sign-ins: reacting to them would re-run setup and sync a second
  // time right after the alarm already did.
  if (auth && auth.email !== previous?.email) {
    void ensureEncryptionReady()
      .then(async () => {
        if (await getPendingAccountMerge()) {
          await chrome.runtime.openOptionsPage();
          return;
        }
        await sync();
      })
      .catch((err: unknown) => {
        console.error("[anchored-notes] post-sign-in encryption setup failed:", err);
      });
  }
});

// Existing signed-in users have no lastAccountEmail; without this,
// leftover notes would look like an account-switch and sync would stall.
async function migrateLastAccountEmail(): Promise<void> {
  const auth = await getAuthState();
  if (auth && (await getLastAccountEmail()) === null) {
    await setLastAccountEmail(auth.email);
  }
}

// alarms.create on an existing name replaces the alarm and restarts its
// countdown. This top-level code runs on every service-worker wake, which for
// an actively browsing user happens far more often than every 5 minutes, so an
// unconditional create would keep pushing the alarm out and it might never
// fire. Create it only when missing (fresh install, or cleared by an
// update/reload).
async function ensureSyncAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(SYNC_ALARM);
  if (!existing) await chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 5 });
}
void ensureSyncAlarm();
void migrateLastAccountEmail();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== SYNC_ALARM) return;
  // Renew the token ahead of expiry so sync() (and any other authenticated
  // call) doesn't have to fall back to the reactive 401-retry. A failed
  // proactive refresh (e.g. offline) must not skip the periodic sync itself.
  void refreshIfExpiringSoon()
    .catch((err: unknown) => {
      console.error("[anchored-notes] proactive token refresh failed:", err);
    })
    .then(runSync);
});

chrome.runtime.onMessage.addListener(
  (message: Message, sender) => {
    if (message.type === "GET_TAB_ID") {
      const response: GetTabIdResponse = { tabId: sender.tab?.id ?? -1 };
      return Promise.resolve(response);
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
      runSync();
      return undefined;
    }
    if (message.type === "STORAGE_WRITE") {
      // Returning the Promise keeps the worker alive until the write
      // finishes; sendResponse + `return true` can yield an empty reply.
      return applyStorageWrite(message.write);
    }
    if (message.type === "ACCOUNT_MERGE") {
      return applyAccountMerge(message.choice)
        .then(() => ({ ok: true }) satisfies AccountMergeResponse)
        .catch((err: unknown) => ({ ok: false, error: String(err) }) satisfies AccountMergeResponse);
    }
    if (message.type === "GET_RUNTIME_CONFIG") {
      return getRuntimeConfig()
        .then((cfg) => ({ ok: true, ...cfg }) satisfies RuntimeConfigResponse)
        .catch((err: unknown) => ({ ok: false, error: String(err) }) satisfies RuntimeConfigResponse);
    }
    if (message.type === "REALTIME_SUBSCRIBE") {
      return subscribeRealtime(message.realtimeUrl, message.clientId)
        .then((result) => ({ ok: true, ...result }) satisfies RealtimeSubscribeResponse)
        .catch((err: unknown) => ({ ok: false, error: String(err) }) satisfies RealtimeSubscribeResponse);
    }
    if (message.type === "LOGIN") {
      // Run the OAuth flow here, not in the popup: opening the auth window makes
      // the popup lose focus and close, which would kill an in-popup flow before
      // the token exchange completes.
      return (async (): Promise<LoginResponse> => {
        await track("sign_in_started");
        try {
          await login();
          await track("sign_in_succeeded");
          return { ok: true };
        } catch (err: unknown) {
          console.error("[anchored-notes] login failed:", err);
          await track("sign_in_failed");
          return { ok: false, error: String(err) };
        }
      })();
    }
    return undefined;
  },
);
