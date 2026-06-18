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
import { COLORS, createNoteCard, type NoteCardHandle } from "./note-card.js";

const HOST_ID = "anchored-notes-host";

let tabId = -1;
let zCounter = 2147483000;
let cachedSiteName = shortDomainFromHostname(location.hostname);
let cachedPageTitle: string | undefined;
const cards = new Map<string, NoteCardHandle>();

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
  anchorKeyForScope
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

function newNote(): Note {
  const ctx = currentContext();
  const scope: AnchorScope = "page";
  const now = Date.now();
  const w = 220;
  const h = 200;
  return {
    id: crypto.randomUUID(),
    content: "",
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

  // Language switched (from the popup): relocalize existing cards in place so
  // their labels, hints and tooltips pick up the new language without tearing
  // down their editors (and losing unsaved edits), and refresh the badge tooltip.
  onLangChanged(() => {
    for (const handle of cards.values()) handle.relocalize();
    if (badge) badge.root.title = t("badgeTitle", null);
  });

  // Re-evaluate visibility on SPA navigation (URL changes without reload).
  window.addEventListener("popstate", () => {
    resolvePageTitle();
    redraw(shadow);
  });
  window.addEventListener("hashchange", () => {
    resolvePageTitle();
    redraw(shadow);
  });
  // Keep notes inside the viewport when the window is resized smaller.
  window.addEventListener("resize", () => {
    for (const handle of cards.values()) handle.clamp();
    if (badge) applyBadgeOffset(badge.root.parentElement as HTMLElement, badgeOffset);
  });
}

// Registered synchronously so a context-menu click during init isn't dropped.
chrome.runtime.onMessage.addListener((message: Message) => {
  if (message.type === "CREATE_NOTE") void saveNote(newNote());
});

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

void bootstrap();
