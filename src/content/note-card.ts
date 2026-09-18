// Factory for a single sticky-note DOM card. Holds a local mutable copy of the
// note and reports edits through the provided callbacks.

import { ANCHOR_SCOPES, NOTE_COLORS, type AnchorScope, type Note } from "../types.js";
import { formatRelativeTime } from "../relative-time.js";
import { t, type MessageKey } from "../i18n.js";
import { track, trackNoteEdited } from "../umami.js";
import type { MarkdownEditorHandle } from "./editor.js";

let editorModule: typeof import("./editor.js") | undefined;
let editorModulePromise: Promise<typeof import("./editor.js")> | undefined;

function loadEditor(): Promise<typeof import("./editor.js")> {
  if (editorModule) return Promise.resolve(editorModule);
  if (!editorModulePromise) {
    editorModulePromise = import(chrome.runtime.getURL("editor.js"))
      .then((mod) => {
        editorModule = mod as typeof import("./editor.js");
        return editorModule;
      })
      .catch((err: unknown) => {
        editorModulePromise = undefined;
        throw err;
      });
  }
  return editorModulePromise;
}

const SCOPE_LABEL_KEY: Record<AnchorScope, MessageKey> = {
  global: "scopeEverywhereLabel",
  site: "scopeSiteLabel",
  page: "scopePageLabel",
  tab: "scopeTabLabel",
};
const SCOPE_HINT_KEY: Record<AnchorScope, MessageKey> = {
  global: "scopeEverywhereHint",
  site: "scopeSiteHint",
  page: "scopePageHint",
  tab: "scopeTabHint",
};

function scopeLabel(scope: AnchorScope, labels: ScopeLabels): string {
  if (scope === "site" && labels.siteName) return `🌍 ${labels.siteName}`;
  if (scope === "page" && labels.pageTitle)
    return `📄 ${shortLabel(labels.pageTitle, 10)}`;
  return t(SCOPE_LABEL_KEY[scope], null);
}

function scopeHint(scope: AnchorScope, labels: ScopeLabels): string {
  if (scope === "site" && labels.siteName) {
    return t("scopeSiteHintNamed", { name: labels.siteName });
  }
  if (scope === "page" && labels.pageTitle) {
    return t("scopePageHintNamed", { title: labels.pageTitle });
  }
  return t(SCOPE_HINT_KEY[scope], null);
}

interface ScopeLabels {
  siteName?: string;
  pageTitle?: string;
}

function shortLabel(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
const SAVE_DEBOUNCE_MS = 400;

/** Format plain text as a markdown blockquote (one `>` prefix per line). */
export function toBlockquote(text: string): string {
  return text
    .trim()
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
}

export interface NoteCardDeps {
  save: (note: Note) => void;
  remove: (id: string) => void;
  bringToFront: () => number;
  anchorKeyForScope: (scope: AnchorScope) => string;
  /** Called when the user focuses or interacts with this card (not on blur). */
  onFocus?: (noteId: string) => void;
  siteName?: string;
  pageTitle?: string;
}

export interface NoteCardHandle {
  el: HTMLElement;
  noteId: string;
  mount: () => void;
  update: (note: Note) => void;
  setScopeLabels: (labels: Partial<ScopeLabels>) => void;
  relocalize: () => void;
  clamp: () => void;
  /** Append selection as a markdown blockquote; flushes pending editor saves. */
  appendBlockquote: (text: string) => void;
  destroy: () => void;
}

export function createNoteCard(
  initial: Note,
  deps: NoteCardDeps,
): NoteCardHandle {
  let note: Note = { ...initial };
  let latestContent = note.content;
  let scopeLabels: ScopeLabels = {
    ...(deps.siteName ? { siteName: deps.siteName } : {}),
    ...(deps.pageTitle ? { pageTitle: deps.pageTitle } : {}),
  };
  let contentTimer: number | undefined;
  // Once the card is destroyed (e.g. the note was deleted), its editor is torn
  // down asynchronously and may emit one last markdownUpdated event. Without
  // this guard that trailing change would schedule a save and re-create the
  // just-deleted note, which then gets deleted again by sync — an endless
  // delete/resurrect loop. The flag neutralizes any save after destroy.
  let destroyed = false;

  const el = document.createElement("div");
  el.className = `note color-${note.color}`;
  el.style.left = `${note.x}px`;
  el.style.top = `${note.y}px`;
  el.style.width = `${note.w}px`;
  el.style.height = `${note.h}px`;

  const header = document.createElement("div");
  header.className = "note-header";

  const date = document.createElement("span");
  date.className = "note-date";
  date.textContent = formatRelativeTime(note.createdAt);

  const tools = document.createElement("div");
  tools.className = "note-tools";

  const anchor = document.createElement("span");
  anchor.className = "note-anchor";
  anchor.textContent = "⚓";
  anchor.title = t("anchorTitle", null);

  const scope = document.createElement("select");
  scope.className = "note-scope";
  scope.title = t("scopeSelectTitle", null);
  for (const s of ANCHOR_SCOPES) {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = scopeLabel(s, scopeLabels);
    opt.title = scopeHint(s, scopeLabels);
    scope.appendChild(opt);
  }
  scope.value = note.scope;

  function applyScopeLabels(next: ScopeLabels): void {
    scopeLabels = next;
    for (const s of ANCHOR_SCOPES) {
      const opt = scope.querySelector<HTMLOptionElement>(
        `option[value="${s}"]`,
      );
      if (!opt) continue;
      opt.textContent = scopeLabel(s, scopeLabels);
      opt.title = scopeHint(s, scopeLabels);
    }
  }

  const colorBtn = document.createElement("button");
  colorBtn.className = "note-btn note-color-btn";
  colorBtn.title = t("colorTitle", null);
  colorBtn.textContent = "🎨";

  const menuBtn = document.createElement("button");
  menuBtn.className = "note-btn note-menu-btn";
  menuBtn.title = t("optionsMenuTitle", null);
  menuBtn.textContent = "⋮";

  const menu = document.createElement("div");
  menu.className = "note-menu";

  const hideItem = document.createElement("button");
  hideItem.className = "note-menu-item";
  hideItem.textContent = t("hide", null);

  const deleteItem = document.createElement("button");
  deleteItem.className = "note-menu-item";
  deleteItem.textContent = t("delete", null);

  menu.append(hideItem, deleteItem);

  tools.append(anchor, scope, colorBtn, menuBtn);
  header.append(date, tools);

  const palette = document.createElement("div");
  palette.className = "note-palette";
  for (const c of NOTE_COLORS) {
    const sw = document.createElement("button");
    sw.className = `note-swatch swatch-${c}`;
    sw.title = c;
    sw.addEventListener("click", () => {
      patch({ color: c });
      el.className = `note color-${c}`;
      palette.classList.remove("open");
      void track("note_color_changed", { source: "card", color: c });
    });
    palette.appendChild(sw);
  }

  const body = document.createElement("div");
  body.className = "note-body";

  const tabNotice = document.createElement("div");
  tabNotice.className = "note-tab-notice";
  tabNotice.textContent = t("tabNoteWarning", null);
  tabNotice.hidden = note.scope !== "tab";

  const resize = document.createElement("div");
  resize.className = "note-resize";

  el.append(header, palette, menu, body, tabNotice, resize);

  function patch(changes: Partial<Note>): void {
    note = { ...note, ...changes, updatedAt: Date.now() };
    deps.save(note);
  }

  // --- markdown editor (Milkdown) ---
  // Created via mount() only after the card is attached to the shadow root, so
  // ProseMirror resolves the shadow root for selection/coordinate handling.
  let editor: MarkdownEditorHandle | undefined;
  // Track focus so external (synced) content updates don't clobber active typing.
  let editorFocused = false;
  body.addEventListener("focusin", () => {
    editorFocused = true;
    deps.onFocus?.(note.id);
  });
  body.addEventListener("focusout", () => {
    editorFocused = false;
  });
  let editorLoad: Promise<void> | undefined;
  function mount(): void {
    if (editor || editorLoad) return;
    editorLoad = loadEditor()
      .then((mod) => {
        if (destroyed) return;
        editor = mod.createMarkdownEditor(body, el, note.content, (markdown) => {
          if (destroyed) return; // trailing change from teardown: never resave
          latestContent = markdown;
          if (markdown === note.content) return; // ignore the initial value echo
          window.clearTimeout(contentTimer);
          contentTimer = window.setTimeout(() => {
            // Clear the handle so update()'s "save pending" guard reflects reality;
            // otherwise a stale id would block all future external content updates.
            contentTimer = undefined;
            if (destroyed) return;
            patch({ content: markdown });
            void trackNoteEdited({ source: "card" });
          }, SAVE_DEBOUNCE_MS);
        });
      })
      .catch(() => {
        editorLoad = undefined;
      });
  }

  function flushPendingContent(): void {
    if (contentTimer === undefined) return;
    window.clearTimeout(contentTimer);
    contentTimer = undefined;
    if (destroyed) return;
    if (latestContent !== note.content) {
      patch({ content: latestContent });
      void trackNoteEdited({ source: "card" });
    }
  }

  function appendBlockquote(text: string): void {
    if (destroyed) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    flushPendingContent();
    const quote = toBlockquote(trimmed);
    const next =
      note.content.trim().length === 0
        ? quote
        : `${note.content.trimEnd()}\n\n${quote}`;
    latestContent = next;
    editor?.replace(next, { scrollToEnd: true });
    patch({ content: next });
    el.style.zIndex = String(deps.bringToFront());
  }

  // --- color palette toggle ---
  colorBtn.addEventListener("click", () => {
    menu.classList.remove("open");
    palette.classList.toggle("open");
  });

  // --- options menu toggle ---
  menuBtn.addEventListener("click", () => {
    palette.classList.remove("open");
    menu.classList.toggle("open");
  });

  // --- scope change recomputes anchorKey for the current page ---
  scope.addEventListener("change", () => {
    const next = scope.value as AnchorScope;
    patch({ scope: next, anchorKey: deps.anchorKeyForScope(next) });
    tabNotice.hidden = next !== "tab";
    void track("note_scope_changed", { source: "card", scope: next });
  });

  // --- hide (collapse into the bottom-right badge) ---
  hideItem.addEventListener("click", () => {
    menu.classList.remove("open");
    patch({ hidden: true });
    void track("note_hidden", { source: "card" });
  });

  // --- delete ---
  deleteItem.addEventListener("click", () => {
    menu.classList.remove("open");
    if (latestContent.trim() && !window.confirm(t("deleteConfirm", null))) return;
    deps.remove(note.id);
    void track("note_deleted", { source: "card" });
  });

  // --- bring to front on interaction ---
  el.addEventListener("pointerdown", () => {
    el.style.zIndex = String(deps.bringToFront());
    deps.onFocus?.(note.id);
  });

  // --- keep keyboard input inside the note ---
  // Key events are `composed`, so they cross the shadow boundary and reach the
  // host page, triggering its shortcuts (e.g. GitHub single-key shortcuts) while
  // the user types. Stopping propagation here keeps them contained to the note.
  for (const type of ["keydown", "keyup", "keypress"] as const) {
    el.addEventListener(type, (e) => e.stopPropagation());
  }

  // --- drag via header ---
  // A drag starts from where the card is drawn (see clamp), not from the
  // stored position, so a card pulled into view on a small window doesn't jump
  // off-screen on the first pointer move. Only the drop is persisted;
  // pointercancel (touch scroll, lost capture) snaps back to the stored spot.
  type DragStart = { px: number; py: number; x: number; y: number };
  let dragStart: DragStart | null = null;
  function dragPosition(e: PointerEvent, start: DragStart): { x: number; y: number } {
    return { x: start.x + (e.clientX - start.px), y: start.y + (e.clientY - start.py) };
  }
  header.addEventListener("pointerdown", (e) => {
    if (e.target !== header && e.target !== date) return; // ignore tool clicks
    dragStart = { px: e.clientX, py: e.clientY, ...clampedPosition() };
    header.setPointerCapture(e.pointerId);
  });
  header.addEventListener("pointermove", (e) => {
    if (!dragStart) return;
    const { x, y } = dragPosition(e, dragStart);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  });
  header.addEventListener("pointerup", (e) => {
    if (!dragStart) return;
    const { x, y } = dragPosition(e, dragStart);
    dragStart = null;
    header.releasePointerCapture(e.pointerId);
    patch({ x, y });
  });
  header.addEventListener("pointercancel", () => {
    if (!dragStart) return;
    dragStart = null;
    clamp();
  });

  // --- resize via corner handle ---
  type ResizeStart = { px: number; py: number; w: number; h: number };
  let resizeStart: ResizeStart | null = null;
  function resizeSize(e: PointerEvent, start: ResizeStart): { w: number; h: number } {
    return {
      w: Math.max(140, start.w + (e.clientX - start.px)),
      h: Math.max(120, start.h + (e.clientY - start.py)),
    };
  }
  resize.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    resizeStart = { px: e.clientX, py: e.clientY, w: note.w, h: note.h };
    resize.setPointerCapture(e.pointerId);
  });
  resize.addEventListener("pointermove", (e) => {
    if (!resizeStart) return;
    const { w, h } = resizeSize(e, resizeStart);
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
  });
  resize.addEventListener("pointerup", (e) => {
    if (!resizeStart) return;
    const { w, h } = resizeSize(e, resizeStart);
    resizeStart = null;
    resize.releasePointerCapture(e.pointerId);
    patch({ w, h });
  });
  resize.addEventListener("pointercancel", () => {
    if (!resizeStart) return;
    resizeStart = null;
    el.style.width = `${note.w}px`;
    el.style.height = `${note.h}px`;
  });

  // --- external updates (e.g. edited in another tab or synced from another device) ---
  function update(next: Note): void {
    const contentChanged = next.content !== note.content;
    note = { ...next };
    el.className = `note color-${next.color}`;
    el.style.left = `${next.x}px`;
    el.style.top = `${next.y}px`;
    el.style.width = `${next.w}px`;
    el.style.height = `${next.h}px`;
    scope.value = next.scope;
    tabNotice.hidden = next.scope !== "tab";
    date.textContent = formatRelativeTime(next.createdAt);
    // Note content lives in the Milkdown editor. Apply external content changes
    // into it, but not while the user is editing this card (focused or a save
    // pending), to avoid clobbering in-progress typing.
    if (contentChanged && editor && !editorFocused && contentTimer === undefined) {
      latestContent = next.content;
      editor.replace(next.content);
    }
  }

  // --- keep the card inside the viewport (e.g. after the window shrinks) ---
  // Visual only; the stored position stays authoritative. Persisting the
  // clamped position without bumping updatedAt made the server's strictly-newer
  // LWW hand the original back, which re-clamped and re-saved in an endless
  // sync loop — and bumping it instead would let the smallest window overwrite
  // every other device's layout.
  function clampedPosition(): { x: number; y: number } {
    const maxX = Math.max(0, window.innerWidth - note.w);
    const maxY = Math.max(0, window.innerHeight - note.h);
    return { x: Math.max(0, Math.min(note.x, maxX)), y: Math.max(0, Math.min(note.y, maxY)) };
  }
  function clamp(): void {
    const { x, y } = clampedPosition();
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }

  function setScopeLabels(partial: Partial<ScopeLabels>): void {
    applyScopeLabels({ ...scopeLabels, ...partial });
  }

  // Re-apply all t()-backed static strings in place after a language switch,
  // without tearing down the card (which would clear the unsaved-content
  // debounce timer and destroy the Milkdown editor mid-edit).
  function relocalize(): void {
    anchor.title = t("anchorTitle", null);
    scope.title = t("scopeSelectTitle", null);
    applyScopeLabels(scopeLabels);
    colorBtn.title = t("colorTitle", null);
    menuBtn.title = t("optionsMenuTitle", null);
    hideItem.textContent = t("hide", null);
    deleteItem.textContent = t("delete", null);
    tabNotice.textContent = t("tabNoteWarning", null);
    date.textContent = formatRelativeTime(note.createdAt);
  }

  function destroy(): void {
    destroyed = true;
    window.clearTimeout(contentTimer);
    editor?.destroy();
  }

  return {
    el,
    noteId: note.id,
    mount,
    update,
    setScopeLabels,
    relocalize,
    clamp,
    appendBlockquote,
    destroy,
  };
}
