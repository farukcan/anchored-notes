// Where things live, resolved from this file rather than from process.cwd().
//
// The scripts are run through npm from video/, but a stray `cd` would silently
// point them at the wrong tree — anchoring on import.meta.url makes that
// impossible.

import path from "node:path";
import {fileURLToPath} from "node:url";

/** video/ — the root of the video toolchain, not the extension repo. */
export const videoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The committed sound library. `public/` is generated and gitignored, so the
 * sources live here and build-shell.mjs copies them into public/sfx/.
 */
export const sfxRoot = path.join(videoRoot, "sfx");

/** Voiceover renders and their timelines. Committed: TTS is not reproducible. */
export const voiceRoot = path.join(videoRoot, "voice");

/** Where build-shell.mjs assembles what Remotion serves. */
export const publicRoot = path.join(videoRoot, "public");

export const outRoot = path.join(videoRoot, "out");

/**
 * One voiceover render: the audio and the timeline that indexes it.
 *
 * Keyed by format as well as language, because the two cuts of a scenario say
 * different things — the vertical one drops whole beats — so they cannot share
 * a recording.
 */
export const voiceStem = (scenario: string, lang: string, format: string): string =>
  `${scenario}-${lang}-${format}`;

export const voiceAudioPath = (scenario: string, lang: string, format: string): string =>
  path.join(voiceRoot, `${voiceStem(scenario, lang, format)}.mp3`);

export const voiceTimelinePath = (scenario: string, lang: string, format: string): string =>
  path.join(voiceRoot, `${voiceStem(scenario, lang, format)}.json`);

/** Cue sheet and level report, written next to the video they describe. */
export const cueSheetPath = (scenario: string, lang: string, format: string): string =>
  path.join(outRoot, scenario, lang, `${format}.cues.json`);

export const preflightPath = (scenario: string, lang: string, format: string): string =>
  path.join(outRoot, scenario, lang, `${format}.audio-preflight.json`);

export const videoPath = (scenario: string, lang: string, format: string): string =>
  path.join(outRoot, scenario, lang, `${format}.mp4`);
