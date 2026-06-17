// Factory for a single sticky-note DOM card. Holds a local mutable copy of the
// note and reports edits through the provided callbacks.

import type { AnchorScope, Note, NoteColor } from "../types.js";
import { createMarkdownEditor, type MarkdownEditorHandle } from "./editor.js";

export const COLORS: NoteColor[] = ["yellow", "green", "pink", "purple", "blue", "gray", "dark"];
const SCOPES: AnchorScope[] = ["global", "site", "page", "tab"];
const SCOPE_META: Record<AnchorScope, { label: string; hint: string }> = {
  global: { label: "🌐 Everywhere", hint: "Anchored everywhere — shows on every page you open" },
  site: { label: "🌍 Site", hint: "Anchored to this site — shows on every page of this domain" },
  page: { label: "📄 Page", hint: "Anchored to this page — shows only on this exact URL" },
  tab: { label: "🗂️ Tab", hint: "Anchored to this tab — follows it across navigation, gone on restart" }
};

function scopeLabel(scope: AnchorScope, siteName?: string): string {
  if (scope === "site" && siteName) return `🌍 ${siteName}`;
  return SCOPE_META[scope].label;
}

function scopeHint(scope: AnchorScope, siteName?: string): string {
  if (scope === "site" && siteName) {
    return `Anchored to ${siteName} — shows on every page of this domain`;
  }
  return SCOPE_META[scope].hint;
}
const SAVE_DEBOUNCE_MS = 400;

export interface NoteCardDeps {
  save: (note: Note) => void;
  remove: (id: string) => void;
  bringToFront: () => number;
  anchorKeyForScope: (scope: AnchorScope) => string;
  siteName?: string;
}

export interface NoteCardHandle {
  el: HTMLElement;
  noteId: string;
  mount: () => void;
  update: (note: Note) => void;
  setSiteName: (siteName?: string) => void;
  clamp: () => void;
  destroy: () => void;
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function createNoteCard(initial: Note, deps: NoteCardDeps): NoteCardHandle {
  let note: Note = { ...initial };
  let siteName = deps.siteName;
  let contentTimer: number | undefined;

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
  date.textContent = formatTimestamp(note.createdAt);

  const tools = document.createElement("div");
  tools.className = "note-tools";

  const anchor = document.createElement("span");
  anchor.className = "note-anchor";
  anchor.textContent = "⚓";
  anchor.title = "Anchored to";

  const scope = document.createElement("select");
  scope.className = "note-scope";
  scope.title = "⚓ Where this note is anchored";
  for (const s of SCOPES) {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = scopeLabel(s, siteName);
    opt.title = scopeHint(s, siteName);
    scope.appendChild(opt);
  }
  scope.value = note.scope;

  function applySiteName(next?: string): void {
    siteName = next;
    for (const s of SCOPES) {
      const opt = scope.querySelector<HTMLOptionElement>(`option[value="${s}"]`);
      if (!opt) continue;
      opt.textContent = scopeLabel(s, siteName);
      opt.title = scopeHint(s, siteName);
    }
  }

  const colorBtn = document.createElement("button");
  colorBtn.className = "note-btn note-color-btn";
  colorBtn.title = "Color";
  colorBtn.textContent = "🎨";

  const closeBtn = document.createElement("button");
  closeBtn.className = "note-btn";
  closeBtn.title = "Delete";
  closeBtn.textContent = "×";

  tools.append(anchor, scope, colorBtn, closeBtn);
  header.append(date, tools);

  const palette = document.createElement("div");
  palette.className = "note-palette";
  for (const c of COLORS) {
    const sw = document.createElement("button");
    sw.className = `note-swatch swatch-${c}`;
    sw.title = c;
    sw.addEventListener("click", () => {
      patch({ color: c });
      el.className = `note color-${c}`;
      palette.classList.remove("open");
    });
    palette.appendChild(sw);
  }

  const body = document.createElement("div");
  body.className = "note-body";

  const resize = document.createElement("div");
  resize.className = "note-resize";

  el.append(header, palette, body, resize);

  function patch(changes: Partial<Note>): void {
    note = { ...note, ...changes, updatedAt: Date.now() };
    deps.save(note);
  }

  // --- markdown editor (Milkdown) ---
  // Created via mount() only after the card is attached to the shadow root, so
  // ProseMirror resolves the shadow root for selection/coordinate handling.
  let editor: MarkdownEditorHandle | undefined;
  function mount(): void {
    if (editor) return;
    editor = createMarkdownEditor(body, el, note.content, (markdown) => {
      if (markdown === note.content) return; // ignore the initial value echo
      window.clearTimeout(contentTimer);
      contentTimer = window.setTimeout(() => patch({ content: markdown }), SAVE_DEBOUNCE_MS);
    });
  }

  // --- color palette toggle ---
  colorBtn.addEventListener("click", () => palette.classList.toggle("open"));

  // --- scope change recomputes anchorKey for the current page ---
  scope.addEventListener("change", () => {
    const next = scope.value as AnchorScope;
    patch({ scope: next, anchorKey: deps.anchorKeyForScope(next) });
  });

  // --- delete ---
  closeBtn.addEventListener("click", () => deps.remove(note.id));

  // --- bring to front on interaction ---
  el.addEventListener("pointerdown", () => {
    el.style.zIndex = String(deps.bringToFront());
  });

  // --- keep keyboard input inside the note ---
  // Key events are `composed`, so they cross the shadow boundary and reach the
  // host page, triggering its shortcuts (e.g. GitHub single-key shortcuts) while
  // the user types. Stopping propagation here keeps them contained to the note.
  for (const type of ["keydown", "keyup", "keypress"] as const) {
    el.addEventListener(type, (e) => e.stopPropagation());
  }

  // --- drag via header ---
  let dragStart: { px: number; py: number; x: number; y: number } | null = null;
  header.addEventListener("pointerdown", (e) => {
    if (e.target !== header && e.target !== date) return; // ignore tool clicks
    dragStart = { px: e.clientX, py: e.clientY, x: note.x, y: note.y };
    header.setPointerCapture(e.pointerId);
  });
  header.addEventListener("pointermove", (e) => {
    if (!dragStart) return;
    const x = dragStart.x + (e.clientX - dragStart.px);
    const y = dragStart.y + (e.clientY - dragStart.py);
    note = { ...note, x, y };
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  });
  header.addEventListener("pointerup", (e) => {
    if (!dragStart) return;
    dragStart = null;
    header.releasePointerCapture(e.pointerId);
    patch({ x: note.x, y: note.y });
  });

  // --- resize via corner handle ---
  let resizeStart: { px: number; py: number; w: number; h: number } | null = null;
  resize.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    resizeStart = { px: e.clientX, py: e.clientY, w: note.w, h: note.h };
    resize.setPointerCapture(e.pointerId);
  });
  resize.addEventListener("pointermove", (e) => {
    if (!resizeStart) return;
    const w = Math.max(140, resizeStart.w + (e.clientX - resizeStart.px));
    const h = Math.max(120, resizeStart.h + (e.clientY - resizeStart.py));
    note = { ...note, w, h };
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
  });
  resize.addEventListener("pointerup", (e) => {
    if (!resizeStart) return;
    resizeStart = null;
    resize.releasePointerCapture(e.pointerId);
    patch({ w: note.w, h: note.h });
  });

  // --- external updates (e.g. edited in another tab) ---
  function update(next: Note): void {
    note = { ...next };
    el.className = `note color-${next.color}`;
    el.style.left = `${next.x}px`;
    el.style.top = `${next.y}px`;
    el.style.width = `${next.w}px`;
    el.style.height = `${next.h}px`;
    scope.value = next.scope;
    date.textContent = formatTimestamp(next.createdAt);
    // Note content lives in the Milkdown editor; external content edits are not
    // re-synced into an open editor to avoid clobbering in-progress typing.
  }

  // --- keep the card inside the viewport (e.g. after the window shrinks) ---
  let clampTimer: number | undefined;
  function clamp(): void {
    const maxX = Math.max(0, window.innerWidth - note.w);
    const maxY = Math.max(0, window.innerHeight - note.h);
    const x = Math.max(0, Math.min(note.x, maxX));
    const y = Math.max(0, Math.min(note.y, maxY));
    if (x === note.x && y === note.y) return;
    note = { ...note, x, y };
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    window.clearTimeout(clampTimer);
    clampTimer = window.setTimeout(() => deps.save(note), 300);
  }

  function setSiteName(next?: string): void {
    applySiteName(next);
  }

  function destroy(): void {
    window.clearTimeout(contentTimer);
    window.clearTimeout(clampTimer);
    editor?.destroy();
  }

  return { el, noteId: note.id, mount, update, setSiteName, clamp, destroy };
}
