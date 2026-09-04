// Closing card. Shares the "editorial stationery" system of the store tiles
// (store-assets/gen/tiles/base.css) so a video ends looking like the listing it
// links to.

import React from "react";

export interface OutroProps {
  /** 0 → not started, 1 → fully covering the frame. */
  progress: number;
  wordmark: string;
  tagline: string;
  /** What the viewer is asked to do. The only claim the card makes. */
  cta: string;
  iconSrc: string;
  dir: string;
  fontHead: string;
  fontBody: string;
  /** The box the card may occupy, in canvas pixels. */
  box: { left: number; top: number; width: number; height: number };
}

export const Outro: React.FC<OutroProps> = ({
  progress,
  wordmark,
  tagline,
  cta,
  iconSrc,
  dir,
  fontHead,
  fontBody,
  box
}) => {
  if (progress <= 0) return null;

  // The card fades in and settles upward; the page behind it stays visible
  // through the first moments, so the product is the last thing still on screen.
  const eased = progress * progress * (3 - 2 * progress);

  // Sized from the narrower dimension, not the taller one. Scaling by height
  // makes a vertical frame — which is no wider than a wide one is tall — set
  // the wordmark half again too large, and it runs straight off both edges.
  // Two ceilings, not one: width decides how large the wordmark can be before
  // it runs off a phone, height stops a tall frame from inflating everything
  // just because it has room to spare.
  const unit = Math.min(box.width / 820, box.height / 900);

  return (
    <>
      {/* The card covers the whole frame, but its contents stay inside the safe
          box — on a feed the corners belong to the platform's own interface. */}
      <div style={{ position: "absolute", inset: 0, backgroundColor: "#f6f0e3", opacity: eased }} />
      <div
      dir={dir}
      style={{
        position: "absolute",
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 26 * unit,
        opacity: eased,
        transform: `translateY(${(1 - eased) * 24}px)`
      }}
    >
      <img
        src={iconSrc}
        alt=""
        style={{ width: 132 * unit, height: 132 * unit, borderRadius: 28 * unit }}
      />
      <div style={{ fontFamily: fontHead, fontSize: 82 * unit, fontWeight: 700, color: "#241d13" }}>
        {wordmark}
      </div>
      <div
        style={{
          fontFamily: fontBody,
          fontSize: 36 * unit,
          color: "#6f6350",
          maxWidth: "76%",
          textAlign: "center",
          textWrap: "balance"
        }}
      >
        {tagline}
      </div>
      {/* An instruction, not a badge. The card claims nothing it cannot back:
          no rating, no install count, and no feature the video did not show. */}
      <div
        style={{
          marginTop: 14 * unit,
          padding: `${16 * unit}px ${34 * unit}px`,
          borderRadius: 12 * unit,
          backgroundColor: "#fcee5f",
          boxShadow: `0 ${6 * unit}px 0 #e3d340`,
          fontFamily: fontBody,
          fontSize: 27 * unit,
          fontWeight: 600,
          color: "#241d13"
        }}
      >
        {cta}
      </div>
      </div>
    </>
  );
};
