// The engine. Hosts the stage frame, drives it from the scenario timeline, and
// draws the marketing layer on top.
//
// The scene inside the frame is the real extension; everything Remotion adds
// (pointer, captions, zoom) sits outside it and never fakes product UI.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AbsoluteFill,
  Audio,
  cancelRender,
  continueRender,
  delayRender,
  staticFile,
  useCurrentFrame,
  useVideoConfig
} from "remotion";
import { LANGS } from "../../store-assets/gen/i18n.mjs";
import { CHROME_HEIGHT, NOW, STAGE_HEIGHT, STAGE_WIDTH, demoNotes, frameHash, homeView, initialView, siteFor, stagePath } from "../stage-url";
import { stateAt, stepsDurationMs } from "./driver";
import { framingFor, viewFor } from "./camera";
import { getScenario } from "../scenarios/index";
import { copyFor } from "../copy/index";
import { applyState, pageKeyOf, stubWindow, waitForStage } from "./stage";
import { beatsDurationMs, flattenBeats } from "./beats";
import { captionsFrom } from "./captions";
import { cuesFrom } from "./audio/cues";
import { SfxTrack } from "./audio/SfxTrack";
import { VOICE_TIMELINES } from "../voice/index";
import { timelineKey, timingOf } from "./voice";
import { HOOK_SETTLE_MS, hookProgressAt } from "./layout";
import { safeZoneFor } from "./safeZones";
import { BrowserChrome } from "./overlays/BrowserChrome";
import { Popup } from "./overlays/Popup";
import { ContextMenu } from "./overlays/ContextMenu";
import { Cursor } from "./overlays/Cursor";
import { Caption } from "./overlays/Caption";
import { HookText } from "./overlays/HookText";
import { Outro } from "./overlays/Outro";
import { popupPath } from "../stage-url";
import type { FormatName, NotesMap } from "./types";

/** Clearance the hook leaves around the browser chrome and the window's edge. */
const HOOK_MARGIN = 24;

/** The share of the frame height the hook may claim once it sits over the page. */
const HOOK_HEIGHT_SHARE = 0.32;

/** Less clear space than this above the window is not worth setting type in. */
const MIN_HOOK_BAND = 260;

/** Clearance the captions keep from the chrome, the hook, and the window's edge. */
const CAPTION_MARGIN = 26;

export type ScenarioProps = {
  /** Scenario id, resolved through scenarios/index.ts. */
  scenario: string;
  lang: string;
  format: FormatName;
};

interface StageAnchor {
  pageKey: string;
  origin: string;
  /** The stage's own <title> — what a real tab would be labelled with. */
  title: string;
}

export const ScenarioComposition: React.FC<ScenarioProps> = ({ scenario: scenarioId, lang, format }) => {
  const scenario = getScenario(scenarioId);
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const timeMs = (frame / fps) * 1000;

  const frameRef = useRef<HTMLIFrameElement>(null);
  const [anchor, setAnchor] = useState<StageAnchor | null>(null);
  const [bootHandle] = useState(() => delayRender("stage boot"));

  // One session per composition instance keeps sibling frames (stage, popup)
  // sharing storage without leaking state between compositions in Studio.
  const session = useMemo(() => `${scenarioId}-${lang}-${format}`, [scenarioId, lang, format]);

  // Remotion serves public/ under /public/, not at the root. Derive the base
  // from staticFile itself rather than hardcoding a prefix that differs between
  // the dev server and a bundled render.
  const assetBase = useMemo(() => staticFile("_").slice(0, -1), []);

  const onLoad = useCallback(async () => {
    const el = frameRef.current;
    if (!el) {
      // Returning here would leave bootHandle open and surface as an anonymous
      // delayRender timeout a minute later, with nothing pointing at the cause.
      cancelRender(new Error("stage iframe fired load with no element attached"));
      return;
    }
    try {
      await waitForStage(el);
      const win = stubWindow(el);
      setAnchor({ pageKey: pageKeyOf(win), origin: win.location.origin, title: win.document.title });
      continueRender(bootHandle);
    } catch (error) {
      cancelRender(error as Error);
    }
  }, [bootHandle]);


  const seedNotes: NotesMap = useMemo(() => {
    if (!anchor || scenario.seed === "none") return {};
    return demoNotes(LANGS[lang].notes, LANGS[lang].dir === "rtl", anchor.pageKey, anchor.origin, NOW);
  }, [anchor, lang, scenario.seed]);

  const beats = useMemo(() => scenario.build(lang, format), [scenario, lang, format]);
  const voice = VOICE_TIMELINES[timelineKey(scenarioId, lang, format)];
  const timing = useMemo(() => timingOf(voice), [voice]);
  const steps = useMemo(() => flattenBeats(beats, timing), [beats, timing]);

  const durationMs = useMemo(
    () => (timing ? stepsDurationMs(steps) : beatsDurationMs(beats)),
    [timing, steps, beats]
  );

  // Sound is a function of the timeline, like everything else on screen: the
  // same steps always produce the same cues at the same levels, which is what
  // lets the pre-render gate measure exactly what will be rendered.
  const cues = useMemo(
    () => cuesFrom(steps, { voiceRefDb: voice ? voice.voiceover.referenceDb : null }),
    [steps, voice]
  );

  const hook = useMemo(() => scenario.hook(lang), [scenario, lang]);

  // A recorded narration times its own phrases; without one the beats do it.
  const phrases = useMemo(
    () => (voice ? voice.phrases : captionsFrom(beats, timing)),
    [voice, beats, timing]
  );

  const home = useMemo(() => homeView(format), [format]);
  const initial = useMemo(() => initialView(), []);

  const state = useMemo(() => {
    return stateAt({
      steps,
      timeMs,
      seedNotes,
      pageKey: anchor?.pageKey ?? "",
      now: NOW,
      home,
      initial
    });
  }, [steps, timeMs, seedNotes, anchor, home, initial]);

  // Every frame gets its own delayRender: Remotion must not capture until the
  // extension has finished reacting to the state we just pushed.
  useEffect(() => {
    const el = frameRef.current;
    if (!el || !anchor) return;
    const handle = delayRender(`stage frame ${frame}`);
    applyState(el, state).then(
      () => continueRender(handle),
      // Throwing from a rejection handler would only produce an unhandled
      // rejection and stall the render; cancelRender reports the real cause.
      (error: Error) => cancelRender(error)
    );
  }, [frame, state, anchor]);

  // Frame the shot. The view rect is in stage coordinates (the chrome sits at
  // negative y), so resting on the whole window and pushing into a note are the
  // same computation. Because the stage is a live document rather than a bitmap,
  // a zoom re-rasterises — text stays sharp at any magnification.
  const view = viewFor(state, initial);
  const { scale, centerX, centerY, stageTop } = framingFor(view, width, height);

  // The overlays are laid out against the window rather than against the frame:
  // on a vertical canvas the window is a band with room above and below it, and
  // type placed by frame alone ends up on top of the address bar.
  const zone = safeZoneFor(format);
  // The hook never covers the address bar — that strip is what tells the viewer
  // this is a real browser rather than a mockup. While the shot is wide enough
  // to leave clear space above the window, the hook goes there; once the camera
  // has pushed in and there is none, it sits over the page, below the chrome.
  const chromeBottom = stageTop + CHROME_HEIGHT * scale;
  const roomAbove = stageTop - zone.top;
  const aboveWindow = roomAbove >= MIN_HOOK_BAND;
  const hookTop = aboveWindow ? zone.top : Math.max(zone.top, chromeBottom + HOOK_MARGIN);
  // Inset a little from the safe box so the panel has visible margin rather
  // than running edge to edge like a banner.
  const hookInset = Math.round((width - zone.left - zone.right) * 0.04);
  const hookProgress = hookProgressAt(timeMs);
  const hookBand = {
    left: zone.left + hookInset,
    top: hookTop,
    width: width - zone.left - zone.right - hookInset * 2,
    height: aboveWindow
      ? roomAbove - HOOK_MARGIN
      : Math.max(
          MIN_HOOK_BAND,
          Math.min(height - zone.bottom, hookTop + height * HOOK_HEIGHT_SHARE) - hookTop
        )
  };

  // Captions live in the upper part of the frame: on a feed the bottom strip
  // belongs to the platform's own title and buttons, and a line parked there is
  // read late or not at all. Three things can already own the top, and each one
  // outranks the caption — the address bar, because it is the proof this is a
  // real browser; the hook, because it is the only thing worth reading in the
  // first seconds; and the popup, which hangs from the toolbar and covers the
  // whole upper right. Only the popup pushes the captions back down.
  const captionAnchor: { top: number } | { bottom: number } = state.popupOpen
    ? { bottom: zone.bottom }
    : {
        top: Math.max(
          chromeBottom + CAPTION_MARGIN,
          // Interpolated on the hook's own fade rather than switched when it
          // ends: the wide cut's camera is not moving at that moment, so a
          // caption that changed height in one frame would read as a glitch.
          // It slides up into the space the hook is vacating instead.
          zone.top +
            (hookBand.top + hookBand.height + CAPTION_MARGIN - zone.top) * hookProgress
        )
      };

  return (
    <AbsoluteFill style={{ background: "linear-gradient(160deg, #2f2618 0%, #1b160e 100%)", overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          transform: `translate(${width / 2}px, ${height / 2}px) scale(${scale}) translate(${-centerX}px, ${-centerY}px)`,
          transformOrigin: "0 0",
          width: STAGE_WIDTH,
          height: STAGE_HEIGHT,
          // The window is drawn upward from the stage origin, into negative y.
          boxShadow: "0 40px 90px -20px rgba(0, 0, 0, 0.6)"
        }}
      >
        {/* Never blurred: the address bar is what tells the viewer this is a
            real browser. Only what is inside the stage frame steps back, and
            src/stage.ts does that element by element. */}
        <div style={{ position: "absolute", left: 0, top: -CHROME_HEIGHT }}>
          <BrowserChrome
            url={siteFor(scenario.stage)}
            title={anchor?.title ?? ""}
            iconSrc={staticFile("icons/icon-128.png")}
            iconActive={state.popupOpen}
          />
        </div>

        <iframe
          ref={frameRef}
          src={`${staticFile(stagePath(scenario.stage, lang))}#${frameHash("content", lang, session, assetBase, scenario.stage)}`}
          onLoad={onLoad}
          width={STAGE_WIDTH}
          height={STAGE_HEIGHT}
          style={{ border: "none", display: "block", backgroundColor: "#f8f4ec" }}
        />

        {anchor && state.popupOpen && (
          // Gated on `anchor` because the popup reads storage as it boots: mount
          // it before the stage has seeded its notes and it reports an empty
          // page. Keyed by frame so it is rebuilt against the notes that frame
          // wrote — the same thing a real popup does on every open.
          <Popup
            key={frame}
            src={`${staticFile(popupPath)}#${frameHash("popup", lang, session, assetBase, scenario.stage)}`}
          />
        )}

        {/* Above the page and the notes, below the pointer — where the browser
            draws it. Inside the transformed layer, so it scales with the window
            the way the page does. */}
        <ContextMenu
          at={state.contextMenu}
          cursor={state.cursor}
          lang={lang}
          copy={copyFor(lang)}
          iconSrc={staticFile("icons/icon-128.png")}
          dir={LANGS[lang].dir}
        />

        <Cursor
          at={state.cursor}
          clickProgress={state.clickProgress}
          shape={state.caret === null ? "arrow" : "text"}
        />
      </AbsoluteFill>

      <Caption
          phrases={phrases}
          timeMs={timeMs}
          anchor={captionAnchor}
          format={format}
          dir={LANGS[lang].dir}
          fontFamily={LANGS[lang].fontBody}
          fontSize={Math.round(height * (format === "9-16" ? 0.028 : 0.032))}
        />

      <HookText
        text={hook.onScreenText}
        progress={hookProgress}
        timeMs={timeMs}
        settleMs={HOOK_SETTLE_MS}
        format={format}
        left={hookBand.left}
        top={hookBand.top}
        width={hookBand.width}
        height={hookBand.height}
        dir={LANGS[lang].dir}
        fontFamily={LANGS[lang].fontHead}
      />

      <Outro
        progress={state.outroProgress}
        wordmark="Anchored Notes"
        tagline={copyFor(lang).outroTagline}
        cta={copyFor(lang).outroCta}
        iconSrc={staticFile("icons/icon-128.png")}
        dir={LANGS[lang].dir}
        fontHead={LANGS[lang].fontHead}
        fontBody={LANGS[lang].fontBody}
        box={{
          left: zone.left,
          top: zone.top,
          width: width - zone.left - zone.right,
          height: height - zone.top - zone.bottom
        }}
      />

      {/* Audio lives at the composition root, never inside a transformed or
          sequenced subtree: a nested <Sequence>'s frames are parent-relative,
          so a track one level down plays everything late by that subtree's
          start — silent to whoever built it, obvious to a viewer. */}
      {voice && (
        // A flat level, not a curve: the pre-render gate models a constant gain
        // and a per-frame volume here would not match what it measured.
        // eslint-disable-next-line @remotion/volume-callback
        <Audio src={staticFile(voice.voiceover.file)} volume={voice.voiceover.volume} />
      )}
      <SfxTrack cues={cues} durationMs={durationMs} />
    </AbsoluteFill>
  );
};
