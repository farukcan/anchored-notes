// The voiceover contract: what a rendered narration measured out to.
//
// Written by scripts/voiceover.ts, read by the composition. It exists because
// the spoken length of a line is not knowable from the scenario — only from the
// audio — and every other clock in the video is derived from it: beat
// durations, caption spans, sound effect placement.

import type { BeatTiming } from "./beats";

export interface VoicePhrase {
  /** Verbatim from the narration. Three to six words reads best on screen. */
  text: string;
  fromMs: number;
  toMs: number;
  /** The beat this phrase was spoken in — captions are placed per beat. */
  beat: string;
}

export interface VoiceTimeline {
  contractVersion: 1;
  scenario: string;
  lang: string;
  format: string;
  /** Total spoken length. The composition's duration comes from here. */
  totalMs: number;
  voiceover: {
    /** Public-relative, the same string staticFile() takes. */
    file: string;
    /**
     * Flat playback level. Kept under 1 so the first sound effect cannot push
     * the mix over — narration masters peak near 0 dBFS.
     */
    volume: number;
    wordCount: number;
    /**
     * Median of the narration's active 50ms RMS windows, in dBFS. Every sound
     * effect is levelled against this, so the mix scales with the voice rather
     * than against a fixed number that happens to suit one recording.
     */
    referenceDb: number;
  };
  /** Beat id → measured spoken length in milliseconds. */
  beats: Record<string, number>;
  phrases: VoicePhrase[];
}

export function timelineKey(scenario: string, lang: string, format: string): string {
  return `${scenario}-${lang}-${format}`;
}

/**
 * The timing src/beats.ts needs, or null when this video has no narration yet.
 * A missing timeline is not an error: Studio has to be able to scrub a scenario
 * before anyone has spent money on text-to-speech.
 */
export function timingOf(timeline: VoiceTimeline | undefined): BeatTiming | null {
  return timeline ? { beats: timeline.beats } : null;
}
