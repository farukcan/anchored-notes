// A generic browser window around the stage. Deliberately not a copy of any
// real browser's UI: it reads as "a browser" without borrowing anyone's brand,
// and it gives the extension's toolbar icon a believable place to live.

import React from "react";
import { CHROME_HEIGHT, STAGE_WIDTH } from "../../stage-url";

const TAB_WIDTH = 300;

export interface BrowserChromeProps {
  /** Address-bar text — the fictional page the stage represents. */
  url: string;
  /** Tab title. */
  title: string;
  /** Extension icon, so the popup can be anchored under it. */
  iconSrc: string;
  /** Highlight the extension icon while the popup is open. */
  iconActive: boolean;
}

const dot = (color: string): React.CSSProperties => ({
  width: 12,
  height: 12,
  borderRadius: "50%",
  backgroundColor: color
});

export const BrowserChrome: React.FC<BrowserChromeProps> = ({ url, title, iconSrc, iconActive }) => {
  return (
    <div
      style={{
        width: STAGE_WIDTH,
        height: CHROME_HEIGHT,
        backgroundColor: "#e4ddd0",
        borderBottom: "1px solid #cdc3b2",
        fontFamily: '-apple-system, "Helvetica Neue", sans-serif',
        color: "#3c3327",
        position: "relative",
        overflow: "hidden"
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px 0" }}>
        <div style={dot("#e5665c")} />
        <div style={dot("#e5b04c")} />
        <div style={dot("#63c164")} />

        <div
          style={{
            marginLeft: 14,
            width: TAB_WIDTH,
            height: 32,
            borderRadius: "9px 9px 0 0",
            backgroundColor: "#f8f4ec",
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "0 14px",
            fontSize: 13,
            whiteSpace: "nowrap",
            overflow: "hidden"
          }}
        >
          <div style={{ width: 13, height: 13, borderRadius: 3, backgroundColor: "#a4552e", flex: "none" }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 16px 0" }}>
        <span style={{ fontSize: 17, opacity: 0.5, letterSpacing: -1 }}>←&nbsp;&nbsp;→&nbsp;&nbsp;⟳</span>
        <div
          style={{
            flex: 1,
            height: 30,
            borderRadius: 15,
            backgroundColor: "#f8f4ec",
            border: "1px solid #cdc3b2",
            display: "flex",
            alignItems: "center",
            padding: "0 14px",
            fontSize: 13,
            color: "#5c5346"
          }}
        >
          <span style={{ marginRight: 8, opacity: 0.55 }}>🔒</span>
          {url}
        </div>
        <img
          src={iconSrc}
          alt=""
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            flex: "none",
            padding: 3,
            boxSizing: "content-box",
            backgroundColor: iconActive ? "#00000014" : "transparent"
          }}
        />
      </div>
    </div>
  );
};
