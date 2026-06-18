// Content script: mounts a shadow-DOM host, renders notes visible in the
// current page context, and keeps them in sync with storage.

import styles from "./styles.css";
import type { AnchorScope, GetTabIdResponse, Message, Note, PageContext } from "../types.js";
import { anchorKeyFor, isNoteVisible, pageContextFromLocation, shortDomainFromHostname } from "../matching.js";
import { fetchSiteNameFromManifest } from "../site-manifest.js";
import { deleteNote, getNotesMap, onNotesChanged, saveNote } from "../storage.js";
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
  const visible = notes.filter((n) => isNoteVisible(n, ctx));
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
  });
}

// Registered synchronously so a context-menu click during init isn't dropped.
chrome.runtime.onMessage.addListener((message: Message) => {
  if (message.type === "CREATE_NOTE") void saveNote(newNote());
});

// At document_start the <html> element may not exist yet; wait for it.
if (document.documentElement) {
  init();
} else {
  const observer = new MutationObserver(() => {
    if (document.documentElement) {
      observer.disconnect();
      init();
    }
  });
  observer.observe(document, { childList: true });
}
