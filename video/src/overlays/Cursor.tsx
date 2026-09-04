// The pointer. Lives in stage coordinates inside the zoom transform, so it
// tracks the page exactly as a real cursor would when the shot pushes in.

import React from "react";
import type { Point } from "../types";

/** What the pointer is over: an arrow everywhere, an I-beam while typing. */
export type CursorShape = "arrow" | "text";

export interface CursorProps {
  at: Point;
  /** 0 at rest; 0→1 across a click step, driving the ripple. */
  clickProgress: number;
  shape: CursorShape;
}

export const Cursor: React.FC<CursorProps> = ({ at, clickProgress, shape }) => {
  const clicking = clickProgress > 0 && clickProgress < 1;
  const ripple = clicking ? clickProgress : 0;

  return (
    <div
      style={{
        position: "absolute",
        left: at.x,
        top: at.y,
        width: 0,
        height: 0,
        pointerEvents: "none",
        zIndex: 2147483647
      }}
    >
      {ripple > 0 && (
        <div
          style={{
            position: "absolute",
            left: -30,
            top: -30,
            width: 60,
            height: 60,
            borderRadius: "50%",
            border: "2.5px solid rgba(36, 29, 19, 0.55)",
            transform: `scale(${0.25 + ripple * 0.9})`,
            opacity: 1 - ripple
          }}
        />
      )}
      {shape === "arrow" ? (
        <svg width="26" height="30" viewBox="0 0 26 30" style={{ position: "absolute", left: -2, top: -2 }}>
          <path
            d="M3 2 L3 23 L9 17.5 L12.8 26 L16.8 24.2 L13 16 L21 15.5 Z"
            fill="#ffffff"
            stroke="#241d13"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        // The I-beam is centred on the hotspot, the way a real text cursor is.
        <svg width="14" height="28" viewBox="0 0 14 28" style={{ position: "absolute", left: -7, top: -14 }}>
          <path
            d="M4 3 H10 M7 3 V25 M4 25 H10"
            fill="none"
            stroke="#ffffff"
            strokeWidth="4.5"
            strokeLinecap="round"
          />
          <path
            d="M4 3 H10 M7 3 V25 M4 25 H10"
            fill="none"
            stroke="#241d13"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      )}
    </div>
  );
};
