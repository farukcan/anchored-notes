// Where the camera is, as a function of the scene.
//
// Extracted from the composition so it can be measured without rendering: a
// shot that jumps between two frames is the kind of defect nobody spots while
// scrubbing and everybody notices at speed, and the only way to catch it
// mechanically is to be able to ask, in Node, what the camera was doing at
// frame N and frame N+1.

import { CHROME_HEIGHT, STAGE_HEIGHT, STAGE_WIDTH } from "../stage-url";
import type { Note, Rect, SceneState } from "./types";

/** Margin left around the window so it never touches the canvas edge. */
export const BREATHING_ROOM = 0.94;

/** Clearance kept around whatever the scene is pointing at, in stage pixels. */
const SUBJECT_MARGIN = 48;

/**
 * Grow a shot until `target` fits inside it, keeping the shot's proportions.
 *
 * A scenario says where to look; it does not have to also work out how far to
 * pull back so that a note travelling across the page stays in view. Widening
 * the shot when the subject would leave it means a drag reads as one continuous
 * movement instead of the note vanishing off one edge and reappearing later.
 */
function containing(view: Rect, target: Rect): Rect {
  const left = Math.min(view.x, target.x);
  const top = Math.min(view.y, target.y);
  const right = Math.max(view.x + view.width, target.x + target.width);
  const bottom = Math.max(view.y + view.height, target.y + target.height);
  if (
    left === view.x &&
    top === view.y &&
    right === view.x + view.width &&
    bottom === view.y + view.height
  ) {
    return view;
  }

  const aspect = view.width / view.height;
  let width = right - left;
  let height = bottom - top;
  if (width / height > aspect) height = width / aspect;
  else width = height * aspect;

  return { x: (left + right) / 2 - width / 2, y: (top + bottom) / 2 - height / 2, width, height };
}

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

function lerpRect(from: Rect, to: Rect, t: number): Rect {
  return {
    x: lerp(from.x, to.x, t),
    y: lerp(from.y, to.y, t),
    width: lerp(from.width, to.width, t),
    height: lerp(from.height, to.height, t)
  };
}

/**
 * How strongly the scene is pointing at a note, from 0 to 1.
 *
 * How much clearer it is than the page behind it, which is exactly what a
 * `focus` step ramps — so the correction fades in and out with the blur instead
 * of switching on the frame the note becomes the subject. A binary rule was
 * what made the camera jump when focus handed over from a note to the badge:
 * the widening it had been applying vanished in one frame.
 *
 * A hidden note is never a subject. It has no card on screen, so there is
 * nothing for the camera to keep in view.
 */
function subjectWeight(state: SceneState, id: string): number {
  const note = state.notes[id];
  if (!note || note.hidden === true) return 0;
  return Math.max(0, Math.min(1, state.focus.page - state.focus.notes[id]));
}

/** The shot, in stage coordinates, before it is fitted to a canvas. */
export function viewFor(state: SceneState, initial: Rect): Rect {
  let view = state.zoom ?? initial;

  for (const id of Object.keys(state.focus.notes)) {
    const weight = subjectWeight(state, id);
    if (weight <= 0) continue;
    const note = state.notes[id] as Note;
    const held = containing(view, {
      x: note.x - SUBJECT_MARGIN,
      y: note.y - SUBJECT_MARGIN,
      width: note.w + SUBJECT_MARGIN * 2,
      height: note.h + SUBJECT_MARGIN * 2
    });
    view = lerpRect(view, held, weight);
  }

  return view;
}

export interface VisibleArea {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Framing {
  scale: number;
  centerX: number;
  centerY: number;
  /** Canvas y of the top of the browser window, and of the bottom of the page. */
  stageTop: number;
  stageBottom: number;
}

/**
 * Fit a shot to a canvas.
 *
 * A shot rect and what the canvas actually reveals are not the same box: the
 * canvas has its own aspect and a resting view is fitted with room to spare, so
 * the visible area is always the wider of the two. Centre on the shot, then
 * pull the centre back until nothing outside the window shows — otherwise
 * pushing in near an edge exposes the backdrop beside the page.
 */
export function framingFor(view: Rect, width: number, height: number): Framing {
  const scale = Math.min(width / view.width, height / view.height) * BREATHING_ROOM;
  const visibleWidth = width / scale;
  const visibleHeight = height / scale;
  const clamp = (value: number, low: number, high: number): number =>
    low > high ? (low + high) / 2 : Math.max(low, Math.min(high, value));

  const centerX = clamp(view.x + view.width / 2, visibleWidth / 2, STAGE_WIDTH - visibleWidth / 2);
  const centerY = clamp(
    view.y + view.height / 2,
    -CHROME_HEIGHT + visibleHeight / 2,
    STAGE_HEIGHT - visibleHeight / 2
  );

  return {
    scale,
    centerX,
    centerY,
    stageTop: height / 2 + (-CHROME_HEIGHT - centerY) * scale,
    stageBottom: height / 2 + (STAGE_HEIGHT - centerY) * scale
  };
}

/** The part of the stage a framing actually reveals, in stage coordinates. */
export function visibleArea(framing: Framing, width: number, height: number): VisibleArea {
  const halfWidth = width / framing.scale / 2;
  const halfHeight = height / framing.scale / 2;
  return {
    left: framing.centerX - halfWidth,
    top: framing.centerY - halfHeight,
    right: framing.centerX + halfWidth,
    bottom: framing.centerY + halfHeight
  };
}

/**
 * How far the camera moved between two framings, as a fraction of the frame.
 *
 * Scale and position together, because either alone can hide a cut: a shot that
 * keeps its centre and doubles its magnification in one frame is as abrupt as
 * one that leaps across the page.
 */
export function framingDelta(a: Framing, b: Framing, width: number, height: number): number {
  const zoom = Math.abs(Math.log(b.scale / a.scale));
  const dx = (Math.abs(b.centerX - a.centerX) * b.scale) / width;
  const dy = (Math.abs(b.centerY - a.centerY) * b.scale) / height;
  return Math.max(zoom, dx, dy);
}
