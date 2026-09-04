// Where it is safe to put something on screen, per format.
//
// A vertical video is not a wide one turned on its side: the platforms that
// play it draw their own interface over the frame. The insets below are
// asymmetric for that reason — the right edge loses the most because the
// like/comment/share column lives there, and the bottom loses more still to the
// title, channel name and description strip.

import type { FormatName } from "./types";

export interface SafeZone {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const SAFE_ZONES: Record<FormatName, SafeZone> = {
  /** A wide frame is played inside a player chrome, not under one. 5% is enough. */
  "16-9": { top: 80, right: 120, bottom: 80, left: 120 },
  /**
   * Shorts / Reels / TikTok overlays: search and profile bar on top, the action
   * button column on the right, the title and description block at the bottom.
   * Leaves a content box of roughly 890 × 1370, sitting slightly left of centre.
   */
  "9-16": { top: 200, right: 130, bottom: 350, left: 60 }
};

export function safeZoneFor(format: FormatName): SafeZone {
  const zone = SAFE_ZONES[format];
  if (!zone) throw new Error(`no safe zone configured for format "${format}"`);
  return zone;
}

/** The box content may occupy, in canvas pixels. */
export function safeBox(
  format: FormatName,
  width: number,
  height: number
): { left: number; top: number; width: number; height: number } {
  const zone = safeZoneFor(format);
  return {
    left: zone.left,
    top: zone.top,
    width: width - zone.left - zone.right,
    height: height - zone.top - zone.bottom
  };
}
