// The first words on screen, set as large as the frame allows.
//
// On a feed there is no thumbnail: the first frame is the thumbnail and the
// title at once, and the decision to keep watching is made in about a second
// and a half. So this is the one piece of type in the video sized to be read
// at arm's length on a phone, and it has to carry the promise on its own —
// most people watching have the sound off.
//
// It is fully legible on the very first frame and already settling rather than
// arriving: a frame that fades up from nothing is a frame nobody waits for. It
// leaves before the product does anything worth looking at, because a hook that
// stays becomes furniture.

import React from "react";
import type { FormatName } from "../types";

export interface HookTextProps {
  text: string;
  /** 1 while it is up, falling to 0 as it leaves. */
  progress: number;
  /** How far into the video, for the settle that runs under the first frames. */
  timeMs: number;
  /** Milliseconds the settle takes. */
  settleMs: number;
  format: FormatName;
  /** The band it may occupy, in canvas pixels. */
  left: number;
  top: number;
  width: number;
  height: number;
  dir: string;
  fontFamily: string;
}

/**
 * Rough advance width of a capital letter, as a fraction of the font size, in
 * the display face the closing card and the store tiles share. Deliberately on
 * the generous side: overestimating costs a few points of size, while
 * underestimating puts a line of display type across the browser window.
 */
const CAP_WIDTH_RATIO = 0.84;
const LINE_HEIGHT = 1.08;
const PADDING_RATIO = 0.34;

/**
 * How many lines the text takes at a given line length.
 *
 * Words, not characters: a character count says "NOTLAR YERİNDE" is fourteen
 * characters and fits in fifteen, while the browser breaks it in two because
 * the second word does not fit. That difference is a line of display type
 * landing on top of the page.
 */
function wrapLines(words: string[], perLine: number): number {
  let lines = 1;
  let used = 0;
  for (const word of words) {
    const needed = used === 0 ? word.length : used + 1 + word.length;
    if (needed <= perLine) {
      used = needed;
      continue;
    }
    lines += 1;
    used = word.length;
  }
  return lines;
}

/**
 * Largest size at which the whole block — text and its padding — fits the band.
 *
 * The padding is part of the fit, not something added afterwards: leaving it
 * out is how a block that was measured to fit ends up an inch taller than the
 * space it was measured against.
 */
function fitFontSize(text: string, width: number, height: number, maxLines: number): number {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const longest = Math.max(...words.map((word) => word.length));

  for (let size = Math.floor(height / LINE_HEIGHT); size > 24; size -= 1) {
    const perLine = Math.floor((width - 2 * size * PADDING_RATIO) / (size * CAP_WIDTH_RATIO));
    // A word too long for one line would be broken mid-word, which reads as a
    // mistake at this size.
    if (perLine < longest) continue;
    const lines = wrapLines(words, perLine);
    if (lines > maxLines) continue;
    if (size * (lines * LINE_HEIGHT + 2 * PADDING_RATIO) <= height) return size;
  }
  throw new Error(
    `hook text "${text}" cannot be set legibly in ${Math.round(width)}x${Math.round(height)}px — shorten it`
  );
}

export const HookText: React.FC<HookTextProps> = ({
  text,
  progress,
  timeMs,
  settleMs,
  format,
  left,
  top,
  width,
  height,
  dir,
  fontFamily
}) => {
  if (progress <= 0) return null;

  // Vertical leaves room for three lines of display type; wide has a shallow
  // band above the window and reads better on one or two.
  const maxLines = format === "9-16" ? 3 : 2;
  const fontSize = fitFontSize(text, width, height, maxLines);

  // Opacity is full from the first frame; the motion is the settle, so nothing
  // has to fade in before the viewer can read it.
  const settle = Math.min(1, Math.max(0, timeMs / settleMs));
  const eased = settle * settle * (3 - 2 * settle);

  return (
    <div
      dir={dir}
      style={{
        position: "absolute",
        left,
        top,
        width,
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        opacity: progress
      }}
    >
      <div
        style={{
          // A hard ceiling as well as a fitted size: the fit is an estimate of
          // how wide capitals run, and an estimate that is a few percent low
          // puts display type outside the safe box on a phone.
          maxWidth: width,
          boxSizing: "border-box",
          padding: `${Math.round(fontSize * PADDING_RATIO)}px ${Math.round(fontSize * 0.6)}px`,
          borderRadius: 18,
          backgroundColor: "rgba(36, 29, 19, 0.94)",
          color: "#f6f0e3",
          fontFamily,
          fontSize,
          fontWeight: 700,
          lineHeight: LINE_HEIGHT,
          letterSpacing: "-0.015em",
          textAlign: "center",
          textWrap: "balance",
          boxShadow: "0 24px 60px -18px rgba(0, 0, 0, 0.7)",
          transform: `translateY(${(1 - eased) * -26}px) scale(${1.04 - 0.04 * eased})`
        }}
      >
        {text}
      </div>
    </div>
  );
};
