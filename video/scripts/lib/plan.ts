// One video, resolved the same way the composition resolves it.
//
// The gates have to measure what will actually be rendered, and the only way to
// guarantee that is to derive it from the same functions: the scenario's beats,
// the same flattening against the same timeline, the same cue table. Anything
// re-implemented here would drift, and the whole point of a pre-render gate is
// that it does not.

import { getScenario } from "../../scenarios/index";
import { cuesFrom } from "../../src/audio/cues";
import { sfxEntry } from "../../src/audio/sfxTypes";
import { beatsDurationMs, flattenBeats } from "../../src/beats";
import { stepsDurationMs } from "../../src/driver";
import type { SfxCue } from "../../src/audio/sfxTypes";
import type { Beat, FormatName, Step } from "../../src/types";
import { readVoiceTimeline, type VoiceTimelineFile } from "./timeline";

export const FPS = 30;

export interface VideoPlan {
  scenario: string;
  lang: string;
  format: FormatName;
  beats: Beat[];
  steps: Step[];
  cues: SfxCue[];
  durationMs: number;
  voice: VoiceTimelineFile | null;
}

export function planFor(scenario: string, lang: string, format: FormatName): VideoPlan {
  const entry = getScenario(scenario);
  if (!entry.langs.includes(lang)) {
    throw new Error(`scenario "${scenario}" has no copy for "${lang}" — known: ${entry.langs.join(", ")}`);
  }

  const beats = entry.build(lang, format);
  const voice = readVoiceTimeline(scenario, lang, format);
  const timing = voice ? { beats: voice.beats } : null;
  const steps = flattenBeats(beats, timing);

  return {
    scenario,
    lang,
    format,
    beats,
    steps,
    cues: cuesFrom(steps, { voiceRefDb: voice ? voice.voiceover.referenceDb : null }),
    durationMs: voice ? stepsDurationMs(steps) : beatsDurationMs(beats),
    voice
  };
}

/** A cue with the manifest facts the gates need, resolved once. */
export interface ResolvedCue extends SfxCue {
  role: string;
  file: string;
  peakDb: number;
  durationSeconds: number;
  attackSeconds: number;
  startMs: number;
  endMs: number;
}

export function resolveCues(cues: readonly SfxCue[]): ResolvedCue[] {
  return cues.map((cue) => {
    const entry = sfxEntry(cue.name);
    // Playback starts before the peak by the sound's measured attack, which is
    // what <Sfx> does — so overlap has to be counted from there, not from atMs.
    const startMs = Math.max(0, cue.atMs - entry.attackSeconds * 1000);
    return {
      ...cue,
      role: entry.role,
      file: entry.file,
      peakDb: entry.peakDb,
      durationSeconds: entry.durationSeconds,
      attackSeconds: entry.attackSeconds,
      startMs,
      endMs: startMs + entry.durationSeconds * 1000
    };
  });
}

/** Parse a `<scenario> <lang> <format>` argument list, with the usual defaults. */
export function parseTarget(argv: string[]): { scenario: string; lang: string; format: FormatName } {
  const [scenario, lang, format] = argv;
  if (!scenario || !lang) {
    throw new Error("usage: <scenario> <lang> [16-9|9-16]");
  }
  const resolved = (format ?? "16-9") as FormatName;
  if (resolved !== "16-9" && resolved !== "9-16") {
    throw new Error(`unknown format "${format}" — expected 16-9 or 9-16`);
  }
  return { scenario, lang, format: resolved };
}
