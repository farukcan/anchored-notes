// The extension popup, hanging off the toolbar icon.
//
// This is the shipped popup.html running against the same chrome stub — and the
// same session, so it counts the very notes the stage is showing.
//
// It boots per frame (the caller keys it by frame while open) because that is
// what a real popup does: it is rebuilt every time it opens, reading storage as
// it is right then. Mounting it once and hiding it would freeze its note counts
// at whatever storage held on the frame it happened to load.

import React, { useCallback, useRef, useState } from "react";
import { cancelRender, continueRender, delayRender } from "remotion";
import { POPUP_WIDTH, STAGE_WIDTH } from "../../stage-url";
import { loadFonts } from "../stage";

/** Distance below the chrome, matching how a real popup hangs off its icon. */
const GAP = 10;

/** Used for the first paint only; replaced by the measured content height. */
const ASSUMED_HEIGHT = 420;

export interface PopupProps {
  src: string;
}

export const Popup: React.FC<PopupProps> = ({ src }) => {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(ASSUMED_HEIGHT);
  const [handle] = useState(() => delayRender("popup boot"));

  // The popup sizes itself to its content, so measure it rather than guess a
  // height that would clip it or leave a white margin below it.
  const onLoad = useCallback(async () => {
    const win = ref.current?.contentWindow;
    if (!win) {
      cancelRender(new Error("popup iframe fired load with no contentWindow"));
      return;
    }
    // The measured height depends on the family the text lands in, so the fonts
    // have to be in before it is read — see loadFonts.
    await loadFonts(win);
    setHeight(Math.ceil(win.document.body.scrollHeight));
    // Let the new height commit before the frame is captured.
    win.requestAnimationFrame(() => continueRender(handle));
  }, [handle]);

  return (
    <div
      style={{
        position: "absolute",
        left: STAGE_WIDTH - 16 - POPUP_WIDTH,
        top: GAP,
        width: POPUP_WIDTH,
        height,
        borderRadius: 10,
        overflow: "hidden",
        backgroundColor: "#ffffff",
        boxShadow: "0 16px 40px -8px rgba(0, 0, 0, 0.35)",
        zIndex: 2147483646
      }}
    >
      <iframe
        ref={ref}
        src={src}
        onLoad={onLoad}
        width={POPUP_WIDTH}
        height={height}
        style={{ border: "none", display: "block" }}
      />
    </div>
  );
};
