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

/** The steps before the camera pushes in: reach the page, click, leave a note. */
export function openingSteps(target: Point, noteId: string, format: FormatName): Step[] {
  if (format !== "9-16") {
    return [
      { action: "hold", ms: 600 },
      { action: "cursor", to: target, ms: 800 },
      { action: "click", ms: 320 },
      { action: "createNote", id: noteId, content: "", ms: 380 }
    ];
  }

  // Padded so the push-in that follows begins after the hook has gone.
  const click = 320;
  const create = 400;
  const glide = 1200;
  return [
    { action: "cursor", to: target, ms: glide },
    { action: "hold", ms: Math.max(200, HOOK_TOTAL_MS - glide - click - create) },
    { action: "click", ms: click },
    { action: "createNote", id: noteId, content: "", ms: create }
  ];
}
