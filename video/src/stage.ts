// Talking to a stage frame: waiting for the real extension to come up inside it,
// and pushing a scene state into it.
//
// The frame is not a mock — it is the shipped content script running against the
// chrome stub. So "apply this state" means writing notes into storage exactly
// like a sync would, and letting the extension's own reconcile draw them.

import type { FocusState, Note, NotesMap, Point, SceneState } from "./types";

const HOST_ID = "anchored-notes-host";

/** Blur radius at full focus strength, in stage pixels. */
const FOCUS_BLUR = 7;

/**
 * A CSS filter for `strength` (0 = untouched). Colour comes down with the blur
 * so a stepped-back element reads as background rather than as a soft copy of
 * the foreground.
 */
function blurFilter(strength: number): string {
  if (strength <= 0) return "none";
  return `blur(${FOCUS_BLUR * strength}px) saturate(${1 - 0.35 * strength}) brightness(${1 - 0.06 * strength})`;
}

/** The frame's window, with `chrome` and `__anStub` typed by shell/entry.ts. */
export function stubWindow(frame: HTMLIFrameElement): Window {
  const win = frame.contentWindow;
  if (!win) throw new Error("stage frame has no contentWindow");
  return win;
}

function shadowRoot(win: Window): ShadowRoot {
  const root = win.document.getElementById(HOST_ID)?.shadowRoot;
  if (!root) throw new Error("extension has not mounted its shadow host yet");
  return root;
}

/** Where a page-scoped note anchors on this stage (src/matching.ts urlNoHash). */
export function pageKeyOf(win: Window): string {
  const { origin, pathname, search } = win.location;
  return `${origin}${pathname}${search}`;
}

/**
 * Resolves once the extension has mounted and the page's webfonts are in — the
 * two things that make an early frame render differently from a late one.
 */
export async function waitForStage(frame: HTMLIFrameElement): Promise<void> {
  const win = stubWindow(frame);

  if (win.document.readyState !== "complete") {
    await new Promise<void>((resolve) => win.addEventListener("load", () => resolve(), { once: true }));
  }

  const deadlineMs = 10_000;
  const startedAt = Date.now();
  while (win.document.getElementById(HOST_ID)?.shadowRoot == null) {
    if (Date.now() - startedAt > deadlineMs) {
      throw new Error("timed out waiting for the content script to mount — is shell.js loaded first?");
    }
    await new Promise((resolve) => setTimeout(resolve, 16));
  }

  await loadFonts(win);
}

/**
 * Make sure every webfont the page declares is actually in before a frame is
 * captured.
 *
 * `document.fonts.ready` alone is not enough: it settles once nothing is
 * *pending*, and a face nobody has asked for yet is not pending. A stylesheet
 * that arrived late leaves its faces unloaded, `ready` resolves immediately, and
 * the frame is captured in the fallback family — which is how two renders of the
 * same scenario came out different. Requesting each face first makes them
 * pending, so `ready` has something to wait for.
 */
export async function loadFonts(win: Window): Promise<void> {
  const faces = Array.from(win.document.fonts);
  // A face that cannot be fetched must not be papered over: it would silently
  // render in a substitute family and the video would be wrong, not broken.
  await Promise.all(faces.map((face) => face.load()));
  await win.document.fonts.ready;
}

/**
 * Let the extension's asynchronous reactions settle before the frame is
 * captured. Milkdown applies external content through a promise chain
 * (src/content/editor.ts), so a microtask flush is not enough on its own.
 */
async function settle(win: Window): Promise<void> {
  for (let i = 0; i < 3; i += 1) await Promise.resolve();
  await new Promise((resolve) => win.setTimeout(resolve, 0));
}

/**
 * Push a scene state into the frame.
 *
 * Notes go through chrome.storage, which is the extension's own update path:
 * storage.onChanged fires, reconcile() runs, cards mount, move or re-render.
 * Only the badge's open/closed list — pure local UI state with no storage
 * backing — is touched directly in the shadow DOM.
 */
/**
 * Select whatever the pointer is over, from the start of the passage.
 *
 * The browser is asked where the pointer is in the text and the range is set on
 * the real document, so the highlight is the browser's own and it is in step
 * with the pointer by construction. Revealing the selection on its own clock
 * instead — the obvious way to animate it — makes two animations of one
 * gesture, and they drift apart the moment the text wraps.
 *
 * The range is clamped to the passage: before it nothing is selected, past its
 * end the whole of it is. That is what lets a scenario overshoot slightly, the
 * way a hand does.
 */
function applySelection(win: Window, target: string | null, cursor: Point): void {
  const active = win.getSelection();
  if (!active) throw new Error("stage frame has no selection API");
  if (target === null) {
    active.removeAllRanges();
    return;
  }

  const passage = win.document.getElementById(target);
  if (!passage) {
    throw new Error(`no element "#${target}" on this stage to select`);
  }

  const doc = win.document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (typeof doc.caretRangeFromPoint !== "function") {
    throw new Error("this browser cannot say where a point falls in the text");
  }

  const whole = win.document.createRange();
  whole.selectNodeContents(passage);

  const range = win.document.createRange();
  range.setStart(whole.startContainer, whole.startOffset);
  range.setEnd(whole.startContainer, whole.startOffset);

  const at = doc.caretRangeFromPoint(cursor.x, cursor.y);
  if (at) {
    // comparePoint throws when the point is in another root — the pointer over
    // a note card, say — which is simply "not in the passage yet".
    let side = -1;
    try {
      side = whole.comparePoint(at.startContainer, at.startOffset);
    } catch {
      side = -1;
    }
    if (side === 0) range.setEnd(at.startContainer, at.startOffset);
    else if (side > 0) range.setEnd(whole.endContainer, whole.endOffset);
  }

  active.removeAllRanges();
  active.addRange(range);
}

export async function applyState(frame: HTMLIFrameElement, state: SceneState): Promise<void> {
  const win = stubWindow(frame);
  const chromeApi = win.chrome;
  if (!chromeApi) throw new Error("stage frame has no chrome stub");

  await chromeApi.storage.local.set({ notes: state.notes as NotesMap });
  await settle(win);

  applySelection(win, state.selection, state.cursor);

  const root = shadowRoot(win);

  const list = root.querySelector(".an-badge-list");
  if (list) list.classList.toggle("open", state.badgeListOpen);

  // A note's ⋮ menu is local UI state on the card, not something storage knows
  // about, so it is toggled directly — on the card the extension itself built.
  // Cards carry no id attribute, so the target is found by the position we just
  // wrote and reconcile has already applied.
  const menuNote = state.openMenuNoteId === null ? null : state.notes[state.openMenuNoteId];
  if (state.openMenuNoteId !== null && !menuNote) {
    throw new Error(`step opened the menu of unknown note "${state.openMenuNoteId}"`);
  }
  // A hidden note has no card to carry a menu; that is a legitimate scene, not a
  // mismatch, so it must not trip the "no card found" check below.
  const target = menuNote?.hidden === true ? null : menuNote;

  let matched = false;
  let caretCard: HTMLElement | null = null;
  // `card instanceof HTMLElement` would always be false here: the cards live in
  // the iframe's realm, so they are instances of *its* HTMLElement, not this
  // document's. Test against the frame's own constructor.
  const FrameElement = (win as Window & typeof globalThis).HTMLElement;
  for (const card of root.querySelectorAll(".note")) {
    if (!(card instanceof FrameElement)) continue;
    const note = noteAt(state.notes, card);
    const isTarget = note !== null && note.id === target?.id;
    if (isTarget) matched = true;
    if (note !== null && note.id === state.caret) caretCard = card;
    card.querySelector(".note-menu")?.classList.toggle("open", isTarget);
    // A card the position lookup could not name still belongs to the page it
    // sits on, so it steps back with it.
    card.style.filter = blurFilter(note === null ? state.focus.page : state.focus.notes[note.id] ?? state.focus.page);
  }

  // Position matching can miss if clamp() moved the card (src/content/note-card.ts).
  // A miss would silently render the menu closed — say so instead.
  if (target != null && !matched) {
    const seen = [...root.querySelectorAll(".note")]
      .map((card) => (card instanceof FrameElement ? `(${card.style.left}, ${card.style.top})` : "?"))
      .join(" ");
    throw new Error(
      `no card found at (${target.x}, ${target.y}) for note "${target.id}"; cards are at ${seen || "<none>"}`
    );
  }

  if (state.caret !== null && caretCard === null) {
    throw new Error(`step typed into note "${state.caret}" but no card is on the stage for it`);
  }
  paintCaret(win, root, FrameElement, caretCard);

  applyFocus(win, root, FrameElement, state.focus);
}

/**
 * The note a card was built from. Cards carry no id attribute, so the only
 * handle is the position reconcile has just applied.
 */
function noteAt(notes: NotesMap, card: HTMLElement): Note | null {
  const left = Math.round(parseFloat(card.style.left));
  const top = Math.round(parseFloat(card.style.top));
  for (const note of Object.values(notes)) {
    if (note.x === left && note.y === top) return note;
  }
  return null;
}

/**
 * Where a text caret belongs on a card: just past the last character its editor
 * has rendered. Measured rather than computed — only layout knows where a line
 * wrapped, which list marker widened a row, or how tall the line box ended up.
 */
function caretSpot(win: Window, card: HTMLElement): { x: number; y: number; height: number } {
  const body = card.querySelector(".note-body");
  if (!body) throw new Error("note card has no .note-body to place a caret in");

  const showText = (win as Window & typeof globalThis).NodeFilter.SHOW_TEXT;
  const walker = win.document.createTreeWalker(body, showText);
  let last: Text | null = null;
  while (walker.nextNode()) last = walker.currentNode as Text;

  if (last !== null && last.length > 0) {
    const range = win.document.createRange();
    range.setStart(last, last.length - 1);
    range.setEnd(last, last.length);
    const box = range.getBoundingClientRect();
    return { x: box.right, y: box.top, height: box.height };
  }

  // Nothing typed yet: sit at the start of the deepest empty line box, which is
  // where the editor's own caret would be on an untouched note.
  let block: Element = body;
  while (block.firstElementChild) block = block.firstElementChild;
  const box = block.getBoundingClientRect();
  return { x: box.left, y: box.top, height: box.height };
}

/** Height added above and below the measured line box, so the caret overshoots it slightly. */
const CARET_OVERSHOOT = 3;
const CARET_ID = "an-video-caret";

/**
 * Draw (or hide) the text caret. It is a child of the shadow root rather than of
 * the card so that a blurred card cannot take it down with it, and it is placed
 * after reconcile has run, so nothing the extension does can drop it.
 */
function paintCaret(
  win: Window,
  root: ShadowRoot,
  FrameElement: typeof HTMLElement,
  card: HTMLElement | null
): void {
  const existing = root.getElementById(CARET_ID);
  let caret: HTMLElement;
  if (existing instanceof FrameElement) {
    caret = existing;
  } else {
    caret = win.document.createElement("div");
    caret.id = CARET_ID;
    caret.style.cssText =
      "position:fixed;width:2px;background:#211c15;pointer-events:none;z-index:2147483601;border-radius:1px;";
    root.appendChild(caret);
  }

  if (card === null) {
    caret.style.display = "none";
    return;
  }

  const spot = caretSpot(win, card);
  caret.style.display = "block";
  caret.style.left = `${spot.x}px`;
  caret.style.top = `${spot.y - CARET_OVERSHOOT}px`;
  caret.style.height = `${spot.height + CARET_OVERSHOOT * 2}px`;
}

/**
 * Step the page and the badge back. Cards are handled with the rest of the card
 * work above; this covers everything else inside the frame.
 *
 * Blurring the page means blurring `<body>`: the extension mounts its shadow
 * host on `<html>` (src/content/index.ts mountHost), so the product's own UI is
 * never caught by it and stays sharp on its own terms.
 */
function applyFocus(
  win: Window,
  root: ShadowRoot,
  FrameElement: typeof HTMLElement,
  focus: FocusState
): void {
  win.document.body.style.filter = blurFilter(focus.page);

  // The badge exists only once a note has been hidden, so its absence is a
  // normal state of the scene rather than a mismatch.
  const badge = root.querySelector(".an-badge-wrap");
  if (badge instanceof FrameElement) badge.style.filter = blurFilter(focus.badge);
}
