// Turns a scenario timeline into "what the scene looks like at time T".
//
// Pure and total: stateAt(t) depends only on the scenario, never on the previous
// frame. That is not a style preference — Remotion renders frames out of order
// and across parallel tabs, so anything incremental would drift or tear.

import { NEW_NOTE_ORIGIN, NEW_NOTE_SIZE, STAGE_HEIGHT, STAGE_WIDTH } from "../stage-url";
import type { FocusState, FocusTarget, NotesMap, Point, Rect, SceneState, Step } from "./types";

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Smoothstep — pointer moves and zooms should not start or stop abruptly. */
function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function lerpPoint(from: Point, to: Point, t: number): Point {
  return { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) };
}

function lerpRect(from: Rect, to: Rect, t: number): Rect {
  return {
    x: lerp(from.x, to.x, t),
    y: lerp(from.y, to.y, t),
    width: lerp(from.width, to.width, t),
    height: lerp(from.height, to.height, t)
  };
}

/** Nothing stepped back: the state a scenario starts and ends in. */
const NO_FOCUS: FocusState = { page: 0, badge: 0, notes: {} };

/** The blur strengths a target asks for once it has fully taken hold. */
function desiredFocus(target: FocusTarget | null): FocusState {
  if (target === null) return NO_FOCUS;
  switch (target.kind) {
    case "note":
      return { page: 1, badge: 1, notes: { [target.id]: 0 } };
    case "badge":
      return { page: 1, badge: 0, notes: {} };
    case "popup":
      // The popup is drawn outside the stage frame, so stepping the whole frame
      // back is all it takes.
      return { page: 1, badge: 1, notes: {} };
  }
}

/**
 * A card with no override follows the page, so that is what it travels from and
 * to. That is what makes one subject dissolve into the next: the outgoing note's
 * override rises to the page's blur while the incoming one falls away from it.
 */
function lerpFocus(from: FocusState, to: FocusState, t: number): FocusState {
  const notes: Record<string, number> = {};
  for (const id of Object.keys({ ...from.notes, ...to.notes })) {
    notes[id] = lerp(from.notes[id] ?? from.page, to.notes[id] ?? to.page, t);
  }
  return { page: lerp(from.page, to.page, t), badge: lerp(from.badge, to.badge, t), notes };
}

/** Total timeline length, so a composition can size itself from its data. */
export function stepsDurationMs(steps: Step[]): number {
  return steps.reduce((total, step) => total + step.ms, 0);
}

/** A line's markdown opener: heading, task item, list bullet, ordered item, quote. */
const LINE_PREFIX = /^\s*(?:#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+\.\s+|>\s+)/;

/**
 * Split text into the units typing advances by: one per character, except that a
 * line's markdown opener is atomic.
 *
 * Half an opener ("- [") is not markdown Milkdown round-trips unchanged, and a
 * changed round-trip arms the save debounce in src/content/note-card.ts, which
 * then blocks every later external update to that card — the typing would stall
 * silently. Emitting openers whole keeps every intermediate value valid
 * markdown, and reads better anyway: nobody types half a checkbox.
 */
function typingUnits(text: string): string[] {
  const units: string[] = [];
  const lines = text.split("\n");

  lines.forEach((line, index) => {
    const opener = LINE_PREFIX.exec(line);
    const rest = opener ? line.slice(opener[0].length) : line;
    if (opener) units.push(opener[0]);
    for (const char of Array.from(rest)) units.push(char);
    if (index < lines.length - 1) units.push("\n");
  });

  return units;
}

/** Reveal `text` progressively, one typing unit at a time. */
function typedPrefix(text: string, progress: number): string {
  const units = typingUnits(text);
  return units.slice(0, Math.round(units.length * progress)).join("");
}

/**
 * A step naming a note that does not exist is a scenario bug. Silently returning
 * the map unchanged would render a video where that step simply does nothing —
 * no error, no clue, just a wrong video.
 */
function withNote(
  notes: NotesMap,
  id: string,
  action: string,
  changes: Partial<NotesMap[string]>
): NotesMap {
  const existing = notes[id];
  if (!existing) {
    throw new Error(`unknown note id "${id}" in step "${action}" — known: ${Object.keys(notes).join(", ")}`);
  }
  return { ...notes, [id]: { ...existing, ...changes } };
}

/**
 * `pageKey` is the anchorKey a page-scoped note gets on this stage; the caller
 * reads it from the stage frame's own location (see src/matching.ts).
 */
function applyStep(
  state: SceneState,
  step: Step,
  progress: number,
  pageKey: string,
  now: number,
  home: Rect
): SceneState {
  switch (step.action) {
    case "hold":
      return state;

    case "cursor":
      return { ...state, cursor: lerpPoint(state.cursor, step.to, ease(progress)) };

    case "click":
      return { ...state, clickProgress: progress };

    case "createNote":
      return {
        ...state,
        notes: {
          ...state.notes,
          [step.id]: {
            id: step.id,
            content: step.content,
            color: "yellow",
            scope: "page",
            anchorKey: pageKey,
            x: NEW_NOTE_ORIGIN.x,
            y: NEW_NOTE_ORIGIN.y,
            w: NEW_NOTE_SIZE.w,
            h: NEW_NOTE_SIZE.h,
            createdAt: now,
            updatedAt: now
          }
        }
      };

    case "type":
      return {
        ...state,
        // A finished step is still replayed at progress 1 on every later frame,
        // so the caret has to be tied to the step still running — otherwise it
        // would stay behind for the rest of the video.
        caret: progress < 1 ? step.id : null,
        notes: withNote(state.notes, step.id, step.action, { content: typedPrefix(step.text, progress) })
      };

    case "select":
      return { ...state, selection: step.target };

    case "contextMenu":
      return { ...state, contextMenu: step.at };

    case "appendQuote": {
      const note = state.notes[step.id];
      if (!note) {
        throw new Error(`unknown note id "${step.id}" in step "appendQuote"`);
      }
      // Exactly what appendBlockquote() builds: the existing content, a blank
      // line, then the selection quoted line by line. Spelling it differently
      // here would show the viewer something the product does not do.
      const quote = step.text
        .trim()
        .split(/\r?\n/)
        .map((line) => `> ${line}`)
        .join("\n");
      const content = note.content.trim().length === 0 ? quote : `${note.content.trimEnd()}\n\n${quote}`;
      return { ...state, notes: withNote(state.notes, step.id, step.action, { content }) };
    }

    case "move": {
      const note = state.notes[step.id];
      if (!note) {
        throw new Error(`unknown note id "${step.id}" in step "move"`);
      }
      const from = { x: note.x, y: note.y };
      const at = lerpPoint(from, step.to, ease(progress));
      // The pointer is holding the note's header, so it travels the same
      // distance — a note that slides out from under a parked cursor reads as
      // an animation, not as a drag.
      return {
        ...state,
        cursor: { x: state.cursor.x + (at.x - from.x), y: state.cursor.y + (at.y - from.y) },
        notes: withNote(state.notes, step.id, step.action, { x: Math.round(at.x), y: Math.round(at.y) })
      };
    }

    case "noteMenu":
      return { ...state, openMenuNoteId: step.id };

    case "setHidden":
      return { ...state, notes: withNote(state.notes, step.id, step.action, { hidden: step.hidden }) };

    case "badgeList":
      return { ...state, badgeListOpen: step.open };

    case "popup":
      return { ...state, popupOpen: step.open };

    case "zoom":
      // A null rect means "back to where this video rests", which is the whole
      // window on a wide canvas and the widest page slice on a phone-shaped one.
      return { ...state, zoom: lerpRect(state.zoom ?? home, step.rect ?? home, ease(progress)) };

    case "focus":
      return { ...state, focus: lerpFocus(state.focus, desiredFocus(step.target), ease(progress)) };

    // Sound is placed against the timeline by src/audio/cues.ts, outside the
    // scene state — nothing about the picture changes when one plays.
    case "sfx":
      return state;

    case "parallel": {
      let next = state;
      for (const child of step.steps) {
        if (child.ms > step.ms) {
          throw new Error(
            `a ${step.ms}ms parallel step holds a ${child.ms}ms "${child.action}" — it could never finish`
          );
        }
        const childProgress = clamp01((step.ms * progress) / child.ms);
        if (childProgress > 0) next = applyStep(next, child, childProgress, pageKey, now, home);
      }
      return next;
    }

    case "outro":
      return { ...state, outroProgress: progress };
  }
}

export interface StateInput {
  steps: Step[];
  timeMs: number;
  /** Notes on the stage before the first step. */
  seedNotes: NotesMap;
  /** anchorKey for page-scoped notes created during the scenario. */
  pageKey: string;
  /** The frozen clock, for notes created mid-scenario. */
  now: number;
  /** The shot this video rests in when it pulls back — homeView(). */
  home: Rect;
  /** The shot it opens on, before any step has run — initialView(). */
  initial: Rect;
}

export function stateAt(input: StateInput): SceneState {
  const initial: SceneState = {
    notes: input.seedNotes,
    cursor: { x: STAGE_WIDTH / 2, y: STAGE_HEIGHT - 120 },
    clickProgress: 0,
    zoom: input.initial,
    focus: NO_FOCUS,
    caret: null,
    selection: null,
    contextMenu: null,
    popupOpen: false,
    badgeListOpen: false,
    openMenuNoteId: null,
    outroProgress: 0
  };

  let state = initial;
  let start = 0;
  for (const step of input.steps) {
    const progress = clamp01((input.timeMs - start) / step.ms);
    // A step that has not begun leaves the scene alone; one that is over is
    // applied at progress 1, which is what makes the result order-independent.
    if (progress > 0) state = applyStep(state, step, progress, input.pageKey, input.now, input.home);
    start += step.ms;
  }
  return state;
}
