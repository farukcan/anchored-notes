// Composition registry: one entry per scenario × language × format.
//
// Durations come from the narration when there is one and from the scenario's
// own numbers when there is not, so a step's ms is a statement of intent rather
// than a measurement someone had to take against a waveform.

import React from "react";
import { Composition } from "remotion";
import { SCENARIOS } from "../scenarios/index";
import { VOICE_TIMELINES } from "../voice/index";
import { beatsDurationMs, flattenBeats } from "./beats";
import { stepsDurationMs } from "./driver";
import { timelineKey, timingOf } from "./voice";
import { ScenarioComposition } from "./Scenario";
import type { FormatName } from "./types";

export const FPS = 30;

/**
 * Output shapes. A scenario renders into every one of them, but not from the
 * same timeline: `build` takes the format, because a vertical cut pushes in
 * harder and drops the beats that live in browser furniture a phone-shaped
 * frame has to crop away.
 */
export const FORMATS: Record<FormatName, { width: number; height: number }> = {
  "16-9": { width: 1920, height: 1080 },
  "9-16": { width: 1080, height: 1920 }
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {SCENARIOS.flatMap((scenario) =>
        scenario.langs.flatMap((lang) =>
          (Object.keys(FORMATS) as FormatName[]).map((format) => {
            const beats = scenario.build(lang, format);
            const timeline = VOICE_TIMELINES[timelineKey(scenario.id, lang, format)];
            const timing = timingOf(timeline);
            // Flattening here as well as in the composition is deliberate: it
            // is pure, and it is what makes a beat that cannot be scaled fail
            // at registration rather than partway through a render.
            const durationMs = timing
              ? stepsDurationMs(flattenBeats(beats, timing))
              : beatsDurationMs(beats);

            const size = FORMATS[format];
            return (
              <Composition
                key={`${scenario.id}-${lang}-${format}`}
                id={`${scenario.id}-${lang}-${format}`}
                component={ScenarioComposition}
                durationInFrames={Math.max(1, Math.round((durationMs / 1000) * FPS))}
                fps={FPS}
                width={size.width}
                height={size.height}
                defaultProps={{ scenario: scenario.id, lang, format }}
              />
            );
          })
        )
      )}
    </>
  );
};
