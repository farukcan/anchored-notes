// Content script: mounts a shadow-DOM host, renders notes visible in the
// current page context, and keeps them in sync with storage.

import styles from "./styles.css";
import type { AnchorScope, GetTabIdResponse, Message, Note, PageContext } from "../types.js";
import { anchorKeyFor, isNoteVisible, pageContextFromLocation, shortDomainFromHostname } from "../matching.js";
import { fetchSiteNameFromManifest } from "../site-manifest.js";
import {
  deleteNote,
  getBadgeOffset,
  getNotesMap,
  onBadgeOffsetChanged,
  onNotesChanged,
  saveBadgeOffset,
  saveNote,
  type BadgeOffset
} from "../storage.js";
import { deriveTitle } from "../note-title.js";
import { initI18n, onLangChanged, t } from "../i18n.js";
import { formatLimit, getCurrentLimit } from "../limits.js";
import { getAuthState, onAuthChanged } from "../auth.js";
import { connectRealtime } from "../realtime.js";
import { COLORS, createNoteCard, toBlockquote, type NoteCardHandle } from "./note-card.js";
import { playErrorBeep } from "../sound.js";

const HOST_ID = "anchored-notes-host";

let tabId = -1;
let zCounter = 2147483000;
let cachedSiteName = shortDomainFromHostname(location.hostname);
let cachedPageTitle: string | undefined;
const cards = new Map<string, NoteCardHandle>();
/** Last note the user focused/interacted with on this page; cleared when gone. */
let lastFocusedNoteId: string | undefined;
/** Oldest → newest focus order; used to pass the append target to a prior note. */
const focusHistory: string[] = [];
/** Set when a note is created so reconcile focuses it once the card mounts. */
let pendingFocusNoteId: string | undefined;

function siteLabelFromPage(): string {
  return shortDomainFromHostname(location.hostname);
}

function pageTitleFromDocument(): string | undefined {
  const title = document.title.trim();
  return title || undefined;
}

function cardDeps(): typeof deps & { siteName: string; pageTitle?: string } {
  return {
    ...deps,
    siteName: cachedSiteName,
    ...(cachedPageTitle ? { pageTitle: cachedPageTitle } : {})
  };
}

function reportAppendTarget(): void {
  // Show the append menu whenever any note is visible on this page — not only
  // after an explicit focus (FR: hide only when there is no note).
  const hasTarget = cards.size > 0;
  const message: Message = { type: "SET_APPEND_TARGET", hasTarget };
  void chrome.runtime.sendMessage(message).catch(() => undefined);
}

function setLastFocusedNote(noteId: string): void {
  lastFocusedNoteId = noteId;
  const i = focusHistory.indexOf(noteId);
  if (i !== -1) focusHistory.splice(i, 1);
  focusHistory.push(noteId);
  // Always report: after a service-worker restart the in-memory per-tab map is
  // empty and the menu stays hidden until a fresh SET_APPEND_TARGET arrives.
  // Re-focusing the same note must still restore visibility.
  reportAppendTarget();
}

/** Drop a note from history; if it was the append target, pass to the prior visible one. */
function forgetNoteFocus(noteId: string): void {
  const i = focusHistory.indexOf(noteId);
  if (i !== -1) focusHistory.splice(i, 1);
  if (lastFocusedNoteId === noteId) lastFocusedNoteId = undefined;
  ensureAppendTarget();
}

/** Prefer last focused, then focus history, then any remaining visible card. */
function resolveAppendTarget(): NoteCardHandle | undefined {
  if (lastFocusedNoteId !== undefined) {
    const focused = cards.get(lastFocusedNoteId);
    if (focused) return focused;
  }
  for (let i = focusHistory.length - 1; i >= 0; i--) {
    const handle = cards.get(focusHistory[i]!);
    if (handle) return handle;
  }
  return cards.values().next().value;
}

/** Keep lastFocused on a mounted card, preferring the most recent focus history entry. */
function ensureAppendTarget(): void {
  if (lastFocusedNoteId !== undefined && cards.has(lastFocusedNoteId)) {
    reportAppendTarget();
    return;
  }
  while (focusHistory.length > 0) {
    const prev = focusHistory[focusHistory.length - 1]!;
    if (cards.has(prev)) {
      lastFocusedNoteId = prev;
      reportAppendTarget();
      return;
    }
    focusHistory.pop();
  }
  const anyId = cards.keys().next().value as string | undefined;
  lastFocusedNoteId = anyId;
  reportAppendTarget();
}

function syncScopeLabelsToCards(): void {
  const labels = {
    siteName: cachedSiteName,
    ...(cachedPageTitle ? { pageTitle: cachedPageTitle } : {})
  };
  for (const handle of cards.values()) handle.setScopeLabels(labels);
}

function currentContext(): PageContext {
  return pageContextFromLocation(location.href, tabId);
}

function anchorKeyForScope(scope: AnchorScope): string {
  return anchorKeyFor(scope, currentContext());
}

async function getTabId(): Promise<number> {
  const message: Message = { type: "GET_TAB_ID" };
  const res = (await chrome.runtime.sendMessage(message)) as GetTabIdResponse;
  return res.tabId;
}

function mountHost(): ShadowRoot {
  const existing = document.getElementById(HOST_ID);
  if (existing?.shadowRoot) return existing.shadowRoot;

  const host = document.createElement("div");
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = styles;
  shadow.appendChild(style);
  document.documentElement.appendChild(host);
  return shadow;
}

const deps = {
  save: (note: Note): void => void saveNote(note),
  remove: (id: string): void => void deleteNote(id),
  bringToFront: (): number => ++zCounter,
  anchorKeyForScope,
  onFocus: setLastFocusedNote
};

async function resolveSiteName(): Promise<void> {
  let name = await fetchSiteNameFromManifest();
  if (!name && document.readyState === "loading") {
    await new Promise<void>((resolve) => document.addEventListener("DOMContentLoaded", () => resolve(), { once: true }));
    name = await fetchSiteNameFromManifest();
  }
  const next = name ?? siteLabelFromPage();
  if (next === cachedSiteName) return;
  cachedSiteName = next;
  syncScopeLabelsToCards();
}

function resolvePageTitle(): void {
  const title = pageTitleFromDocument();
  if (title === cachedPageTitle) return;
  cachedPageTitle = title;
  syncScopeLabelsToCards();
}

function watchPageTitle(): void {
  resolvePageTitle();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => resolvePageTitle(), { once: true });
  }
  const titleEl = document.querySelector("title");
  if (!titleEl) return;
  new MutationObserver(() => resolvePageTitle()).observe(titleEl, {
    childList: true,
    characterData: true,
    subtree: true
  });
}

function reconcile(shadow: ShadowRoot, notes: Note[]): void {
  const ctx = currentContext();
  const matching = notes.filter((n) => isNoteVisible(n, ctx));
  const visible = matching.filter((n) => !n.hidden);
  const hidden = matching.filter((n) => n.hidden);
  const visibleIds = new Set(visible.map((n) => n.id));

  for (const [id, handle] of cards) {
    if (!visibleIds.has(id)) {
      handle.destroy();
      handle.el.remove();
      cards.delete(id);
      forgetNoteFocus(id);
    }
  }

  for (const note of visible) {
    const existing = cards.get(note.id);
    if (existing) {
      existing.update(note);
    } else {
      const handle = createNoteCard(note, cardDeps());
      cards.set(note.id, handle);
      shadow.appendChild(handle.el);
      handle.mount();
    }
  }

  if (pendingFocusNoteId !== undefined && cards.has(pendingFocusNoteId)) {
    setLastFocusedNote(pendingFocusNoteId);
    pendingFocusNoteId = undefined;
  } else {
    ensureAppendTarget();
  }

  for (const handle of cards.values()) handle.clamp();

  updateBadge(shadow, hidden);
}

// --- bottom-right badge collecting hidden notes ---
interface BadgeParts {
  root: HTMLElement;
  count: HTMLElement;
  list: HTMLElement;
}

let badge: BadgeParts | undefined;

const DRAG_THRESHOLD = 4; // px before a press becomes a drag rather than a click

// Live badge offset, kept in sync with storage so a drag can read it
// synchronously on pointerdown without an async race.
let badgeOffset: BadgeOffset = { dx: 0, dy: 0 };

// Keep the badge anchored to the bottom-right corner but shifted by the saved
// offset, clamped so it always stays within the viewport.
function applyBadgeOffset(container: HTMLElement, offset: BadgeOffset): void {
  const dx = Math.min(Math.max(offset.dx, 0), window.innerWidth - 48);
  const dy = Math.min(Math.max(offset.dy, 0), window.innerHeight - 48);
  container.style.transform = `translate(${-dx}px, ${-dy}px)`;
}

function makeBadgeDraggable(container: HTMLElement, root: HTMLElement): void {
  let startX = 0;
  let startY = 0;
  let base: BadgeOffset = { dx: 0, dy: 0 };
  let dragging = false;

  const onMove = (e: PointerEvent): void => {
    const moveX = startX - e.clientX; // pointer left -> dx grows
    const moveY = startY - e.clientY; // pointer up -> dy grows
    if (!dragging && Math.hypot(moveX, moveY) < DRAG_THRESHOLD) return;
    dragging = true;
    applyBadgeOffset(container, { dx: base.dx + moveX, dy: base.dy + moveY });
  };

  const onUp = (e: PointerEvent): void => {
    root.removeEventListener("pointermove", onMove);
    root.removeEventListener("pointerup", onUp);
    if (!dragging) return;
    e.stopPropagation();
    root.setAttribute("data-an-dragged", "1"); // suppress the trailing click
    badgeOffset = {
      dx: Math.max(base.dx + (startX - e.clientX), 0),
      dy: Math.max(base.dy + (startY - e.clientY), 0)
    };
    void saveBadgeOffset(badgeOffset);
  };

  root.addEventListener("pointerdown", (e: PointerEvent) => {
    if (e.button !== 0) return;
    startX = e.clientX;
    startY = e.clientY;
    base = badgeOffset;
    dragging = false;
    root.setPointerCapture(e.pointerId);
    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerup", onUp);
  });
}

function ensureBadge(shadow: ShadowRoot): BadgeParts {
  if (badge) return badge;

  const root = document.createElement("div");
  root.className = "an-badge";
  root.title = t("badgeTitle", null);

  const logo = document.createElement("img");
  logo.className = "an-badge-logo";
  logo.src = chrome.runtime.getURL("icons/icon-128.png");
  logo.alt = "Anchored Notes";

  const count = document.createElement("span");
  count.className = "an-badge-count";

  const list = document.createElement("div");
  list.className = "an-badge-list";

  root.append(logo, count);
  root.addEventListener("click", () => {
    if (root.getAttribute("data-an-dragged")) {
      root.removeAttribute("data-an-dragged");
      return;
    }
    list.classList.toggle("open");
  });

  const container = document.createElement("div");
  container.className = "an-badge-wrap";
  container.append(list, root);
  shadow.appendChild(container);

  makeBadgeDraggable(container, root);
  void getBadgeOffset().then((o) => {
    badgeOffset = o;
    applyBadgeOffset(container, o);
  });
  onBadgeOffsetChanged((o) => {
    badgeOffset = o;
    applyBadgeOffset(container, o);
  });

  badge = { root, count, list };
  return badge;
}

function updateBadge(shadow: ShadowRoot, hidden: Note[]): void {
  const parts = ensureBadge(shadow);
  if (hidden.length === 0) {
    parts.root.parentElement!.style.display = "none";
    parts.list.classList.remove("open");
    return;
  }
  parts.root.parentElement!.style.display = "block";
  parts.count.textContent = String(hidden.length);

  parts.list.replaceChildren();
  for (const note of hidden) {
    const item = document.createElement("button");
    item.className = "an-badge-item";
    item.textContent = deriveTitle(note.content);
    item.addEventListener("click", () => {
      parts.list.classList.remove("open");
      void saveNote({ ...note, hidden: false, updatedAt: Date.now() });
    });
    parts.list.appendChild(item);
  }
}

function newNote(content: string): Note {
  const ctx = currentContext();
  const scope: AnchorScope = "page";
  const now = Date.now();
  const w = 220;
  const h = 200;
  return {
    id: crypto.randomUUID(),
    content,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    scope,
    anchorKey: anchorKeyFor(scope, ctx),
    x: Math.max(8, Math.round(window.innerWidth / 2 - w / 2)),
    y: Math.max(8, Math.round(window.innerHeight / 2 - h / 2)),
    w,
    h,
    createdAt: now,
    updatedAt: now
  };
}

function redraw(shadow: ShadowRoot): void {
  void getNotesMap().then((m) => reconcile(shadow, Object.values(m)));
}

// Live updates: subscribe to PocketBase realtime for the signed-in user's notes
// while this tab is visible, so changes from other devices appear without
// waiting for the periodic sync. A realtime event only triggers a background
// sync (the single reconciliation path); the resulting storage change then
// re-renders the page through onNotesChanged. Debounced to collapse bursts.
let disconnectRealtime: (() => void) | null = null;
let realtimeSyncTimer: ReturnType<typeof setTimeout> | undefined;

function triggerRealtimeSync(): void {
  if (realtimeSyncTimer) clearTimeout(realtimeSyncTimer);
  realtimeSyncTimer = setTimeout(() => {
    void chrome.runtime.sendMessage({ type: "SYNC" } satisfies Message);
  }, 300);
}

// Serialize connect/disconnect so overlapping triggers (visibilitychange +
// onAuthChanged) can't both pass the guard across an await and leak a second
// EventSource.
let realtimeOp: Promise<void> = Promise.resolve();

function refreshRealtime(): void {
  realtimeOp = realtimeOp.then(applyRealtimeState);
}

async function applyRealtimeState(): Promise<void> {
  const auth = await getAuthState();
  const shouldRun = auth !== null && document.visibilityState === "visible";
  if (shouldRun && !disconnectRealtime) {
    disconnectRealtime = connectRealtime(triggerRealtimeSync);
    // Catch up on changes missed while this tab was hidden/disconnected.
    triggerRealtimeSync();
  } else if (!shouldRun && disconnectRealtime) {
    disconnectRealtime();
    disconnectRealtime = null;
  }
}

function init(): void {
  const shadow = mountHost();

  // Draw immediately from storage. The tab id is only needed for tab-scoped
  // notes, so fetch it in parallel instead of blocking the first paint on the
  // (possibly asleep) service worker — notes appear as the page renders.
  redraw(shadow);
  void getTabId().then((id) => {
    tabId = id;
    redraw(shadow);
  });
  void resolveSiteName();
  watchPageTitle();

  onNotesChanged((next) => reconcile(shadow, Object.values(next)));

  // Right-click wakes the service worker and refreshes append-menu visibility
  // before the menu is committed (best-effort; unknown state defaults to shown).
  document.addEventListener("contextmenu", () => reportAppendTarget(), true);

  // Connect realtime when signed in and this tab is visible; reconnect/disconnect
  // as visibility or auth state changes.
  refreshRealtime();
  document.addEventListener("visibilitychange", () => refreshRealtime());
  onAuthChanged(() => refreshRealtime());

  // Language switched (from the popup): relocalize existing cards in place so
  // their labels, hints and tooltips pick up the new language without tearing
  // down their editors (and losing unsaved edits), and refresh the badge tooltip.
  onLangChanged(() => {
    for (const handle of cards.values()) handle.relocalize();
    if (badge) badge.root.title = t("badgeTitle", null);
  });

  // Re-evaluate visibility when the URL changes without a reload. SPAs navigate
  // via history.pushState/replaceState, which emit no popstate; the Navigation
  // API observes those same-document navigations, so prefer it when present and
  // fall back to popstate/hashchange otherwise.
  const onUrlChange = (): void => {
    resolvePageTitle();
    redraw(shadow);
  };
  if (navigation) {
    navigation.addEventListener("navigatesuccess", onUrlChange);
  } else {
    window.addEventListener("popstate", onUrlChange);
    window.addEventListener("hashchange", onUrlChange);
  }
  // Keep notes inside the viewport when the window is resized smaller.
  window.addEventListener("resize", () => {
    for (const handle of cards.values()) handle.clamp();
    if (badge) applyBadgeOffset(badge.root.parentElement as HTMLElement, badgeOffset);
  });
}

function showToast(shadow: ShadowRoot, text: string): void {
  shadow.querySelector(".an-toast")?.remove();
  const toast = document.createElement("div");
  toast.className = "an-toast";
  toast.textContent = text;
  shadow.appendChild(toast);
  playErrorBeep();
  setTimeout(() => toast.remove(), 4000);
}

// Enforce the note quota at the single creation point. Both the popup and the
// context menu reach note creation through this CREATE_NOTE message.
async function createNoteWithinLimit(content: string): Promise<void> {
  const map = await getNotesMap();
  const limit = await getCurrentLimit();
  if (Object.keys(map).length >= limit) {
    showToast(mountHost(), t("noteLimitReached", { limit: formatLimit(limit) }));
    return;
  }
  const note = newNote(content);
  pendingFocusNoteId = note.id;
  await saveNote(note);
}

/** Append selection as a blockquote to the last focused note, or create one. */
async function appendSelectionToNote(content: string): Promise<void> {
  const trimmed = content.trim();
  if (!trimmed) return;
  // Inject+retry can deliver APPEND_SELECTION before the first reconcile; hydrate
  // from storage so existing notes are not skipped in favor of a spurious create.
  if (cards.size === 0) {
    const map = await getNotesMap();
    reconcile(mountHost(), Object.values(map));
  }
  const target = resolveAppendTarget();
  if (target) {
    target.appendBlockquote(trimmed);
    setLastFocusedNote(target.noteId);
    return;
  }
  // No visible note (menu should normally stay hidden); fall back to a new note.
  await createNoteWithinLimit(toBlockquote(trimmed));
}

// Resolve the active language before first paint, then start. At document_start
// the <html> element may not exist yet; wait for it.
async function bootstrap(): Promise<void> {
  await initI18n();
  if (document.documentElement) {
    init();
    return;
  }
  const observer = new MutationObserver(() => {
    if (document.documentElement) {
      observer.disconnect();
      init();
    }
  });
  observer.observe(document, { childList: true });
}

// Re-injection (popup/context-menu retry, bulk-inject on install) can run this
// bundle again in a tab that already has it. Key the guard by extension version
// so an update can re-bootstrap after orphaned scripts; same-version re-runs
// skip to avoid duplicate CREATE_NOTE listeners. mountHost already dedupes the
// shadow host by id. Programmatic inject clears the guard first (see inject.ts).
type InjectionGuard = {
  version: string;
  onMessage: (message: Message) => boolean | undefined;
};

const INJECTION_MARKER = "__anchoredNotesInjected";
const injectionMarker = window as Window & { [INJECTION_MARKER]?: InjectionGuard | boolean };
const version = chrome.runtime.getManifest().version;
const prev = injectionMarker[INJECTION_MARKER];
const alreadyInjected = typeof prev === "object" && prev.version === version;

if (!alreadyInjected) {
  if (typeof prev === "object" && typeof prev.onMessage === "function") {
    try {
      chrome.runtime.onMessage.removeListener(prev.onMessage);
    } catch {
      // Orphaned extension context after update/reload.
    }
  }
  // Registered synchronously so a context-menu click during init isn't dropped.
  function onMessage(message: Message): boolean | undefined {
    if (message.type === "CREATE_NOTE") {
      void createNoteWithinLimit(message.content);
      return undefined;
    }
    if (message.type === "APPEND_SELECTION") {
      void appendSelectionToNote(message.content);
      return undefined;
    }
    return undefined;
  }
  chrome.runtime.onMessage.addListener(onMessage);
  injectionMarker[INJECTION_MARKER] = { version, onMessage };
  void bootstrap();
}
