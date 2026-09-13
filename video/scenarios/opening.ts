// How a video opens, which is the one part every scenario does the same way.
//
// The first seconds have two jobs at once: say what the viewer is looking at,
// and start doing something. A wide frame gets both for free — the whole
// browser is on screen anyway. A phone frame does not: it has to hold the
// establishing shot long enough to register a browser, and it has to do it
// without a warm-up, because a feed decides in about a second and a half.
//
// So vertical opens with the pointer already travelling across the whole window
// and only pushes in once the hook has left. The camera move and the hook never
// overlap, which is what keeps the hook from shifting under the viewer as the
// window grows past it.

import { HOOK_TOTAL_MS } from "../src/layout";
import type { FormatName, Point, Step } from "../src/types";

/** Default opening is unhurried. `snappy` gets to the first click sooner. */
export type OpeningPace = "default" | "snappy";

/** The steps before the camera pushes in: reach the page, click, leave a note. */
export function openingSteps(
  target: Point,
  noteId: string,
  format: FormatName,
  pace: OpeningPace = "default"
): Step[] {
  const snappy = pace === "snappy";

  if (format !== "9-16") {
    return [
      { action: "hold", ms: snappy ? 180 : 600 },
      { action: "cursor", to: target, ms: snappy ? 420 : 800 },
      { action: "click", ms: snappy ? 280 : 320 },
      { action: "createNote", id: noteId, content: "", ms: snappy ? 320 : 380 }
    ];
  }

  const click = snappy ? 280 : 320;
  const create = snappy ? 320 : 400;
  const glide = snappy ? 700 : 1200;
  // Wait until the hook has left before the following push-in. Snappy spends
  // that wait after the click, so the pointer is already doing something.
  const wait = Math.max(200, HOOK_TOTAL_MS - glide - click - create);

  if (snappy) {
    return [
      { action: "cursor", to: target, ms: glide },
      { action: "click", ms: click },
      { action: "createNote", id: noteId, content: "", ms: create },
      { action: "hold", ms: wait }
    ];
  }

  return [
    { action: "cursor", to: target, ms: glide },
    { action: "hold", ms: wait },
    { action: "click", ms: click },
    { action: "createNote", id: noteId, content: "", ms: create }
  ];
}
