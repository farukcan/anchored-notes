// Burned-in captions, one spoken phrase at a time.
//
// Most people watch a marketing video with the sound off, so the narration has
// to survive on screen or it may as well not exist. Phrases rather than words:
// a word-at-a-time karaoke track is read as a stream of tokens instead of as
// prose, and prose is what carries an argument.
//
// Shares the "editorial stationery" look of the store tiles
// (store-assets/gen/tiles/base.css) so a video and the screenshots read as one
// campaign.

import React from "react";
import { safeZoneFor } from "../safeZones";
import type { FormatName } from "../types";
import type { VoicePhrase } from "../voice";

export interface CaptionProps {
  phrases: readonly VoicePhrase[];
  timeMs: number;
  /**
   * Where the band sits, in canvas pixels. `top` is the normal case — the upper
   * part of the frame is the part a feed does not cover with its own interface
   * — and `bottom` is used only when something else has claimed the top.
   */
  anchor: { top: number } | { bottom: number };
  format: FormatName;
  dir: string;
  fontFamily: string;
  fontSize: number;
}

/** How long a phrase stays up once it has been spoken, so it is not snatched away. */
const HOLD_MS = 220;

export const Caption: React.FC<CaptionProps> = ({
  phrases,
  timeMs,
  anchor,
  format,
  dir,
  fontFamily,
  fontSize
}) => {
  const active = phrases.find((phrase) => timeMs >= phrase.fromMs && timeMs < phrase.toMs + HOLD_MS);
  if (!active) return null;

  const zone = safeZoneFor(format);
  // A phrase fades in over its first moments; it never fades out, because the
  // next one replaces it and a gap between the two reads as a dropped line.
  const fade = Math.min(1, Math.max(0, (timeMs - active.fromMs) / 120));

  return (
    <div
      dir={dir}
      style={{
        position: "absolute",
        left: zone.left,
        right: zone.right,
        ...anchor,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
        opacity: fade
      }}
    >
      <div
        style={{
          padding: `${Math.round(fontSize * 0.5)}px ${Math.round(fontSize * 0.95)}px`,
          borderRadius: 14,
          backgroundColor: "rgba(246, 240, 227, 0.96)",
          color: "#241d13",
          fontFamily,
          fontSize,
          lineHeight: 1.28,
          textAlign: "center",
          textWrap: "balance",
          boxShadow: "0 18px 40px -14px rgba(0, 0, 0, 0.55)"
        }}
      >
        {active.text}
      </div>
    </div>
  );
};
