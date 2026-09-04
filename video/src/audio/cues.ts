// Sound derived from the timeline, not written by hand.
//
// A step already says what is happening — a click is a click, a drag is contact
// with a surface — so the mapping from step to sound belongs in one table
// rather than in every scenario. A scenario that wants an extra accent adds an
// `sfx` step; it never has to think about the ordinary beats.
//
// Two rules from the source discipline are kept:
//   - A fade gets no sound. It has no acoustic counterpart, so `outro`, `focus`,
//     `zoom` and `caption` are silent. A scenario that really wants to punctuate
//     its closing card says so explicitly.
//   - Gain is arithmetic, not taste. Each cue is levelled to a target peak
//     relative to the narration, computed from the manifest's measured peak.
//     Nobody in this pipeline can hear the result, so nothing here is estimated.

import { sfxEntry, type SfxCue, type SfxName } from "./sfxTypes";
import type { Step } from "../types";

/**
 * How far above the narration each kind of sound should peak, in dB.
 *
 * The narration reference is the median of its active 50ms RMS windows, which
 * is what `audio-preflight` measures — so these offsets mean the same thing at
 * build time and at gate time.
 */
export const ROLE_OFFSET_DB: Record<string, number> = {
  impact: 10,
  transition: 10,
  movement: 9,
  ui: 6,
  feedback: 6
};

/** Stand-in narration level for a video with no voiceover yet. */
export const ABSOLUTE_REFERENCE_DB = -16;

/**
 * Keystrokes are emitted no closer than this. The library's minimum spacing is
 * 3 frames; typing at the rate a person actually types would breach it, and a
 * keystroke stream is heard as one texture rather than as separate events.
 */
const KEYSTROKE_GAP_MS = 170;

/**
 * How far a repeated sample's pitch wanders, either side of unity.
 *
 * The same sample at the same pitch, three times inside a couple of seconds,
 * reads as a stuck machine rather than as three separate events — and no real
 * click or keystroke is ever acoustically identical to the last one. A short
 * cycle of values does not solve it, it only moves the repeat a few
 * occurrences along, so the offset is stepped by the golden ratio: successive
 * multiples of it never land near each other.
 */
const PITCH_SPREAD = 0.07;
const GOLDEN_RATIO_FRACTION = 0.618033988749895;

interface CueDraft {
  name: SfxName;
  atMs: number;
  /** Only set when a scenario asked for a specific pitch; otherwise varied. */
  pitch: number | undefined;
  note: string;
}

/** Level a sound so its peak lands `ROLE_OFFSET_DB` above the narration. */
function gainFor(name: SfxName, voiceRefDb: number): number {
  const entry = sfxEntry(name);
  const offset = ROLE_OFFSET_DB[entry.role];
  if (offset === undefined) {
    throw new Error(`sound "${String(name)}" has role "${entry.role}", which has no level target`);
  }
  const targetPeakDb = voiceRefDb + offset;
  return Math.round(10 ** ((targetPeakDb - entry.peakDb) / 20) * 1000) / 1000;
}

/** The pitch the nth playback of a given sample gets. The first is unaltered. */
function pitchForOccurrence(index: number): number {
  if (index === 0) return 1;
  const wander = ((index * GOLDEN_RATIO_FRACTION) % 1) * 2 - 1;
  return Math.round((1 + PITCH_SPREAD * wander) * 1000) / 1000;
}

/** One keystroke every KEYSTROKE_GAP_MS for as long as the typing runs. */
function keystrokes(startMs: number, ms: number): CueDraft[] {
  const drafts: CueDraft[] = [];
  for (let index = 0; startMs + index * KEYSTROKE_GAP_MS < startMs + ms; index += 1) {
    drafts.push({
      name: "ui_computer_keyboard_single_key_typ_380145" as SfxName,
      atMs: startMs + index * KEYSTROKE_GAP_MS,
      pitch: undefined,
      note: `keystroke ${index + 1} of the typing run`
    });
  }
  return drafts;
}

/**
 * What one step sounds like, in absolute milliseconds.
 *
 * `parallel` recurses with the same start: its children share the parent's
 * window, so a zoom that runs alongside a blur contributes whatever its own
 * children would have contributed on their own.
 */
function draftsFor(step: Step, startMs: number): CueDraft[] {
  switch (step.action) {
    case "click":
      // The contact is the moment the button goes down, not the end of the ripple.
      return [
        {
          name: "ui_ui_click_839832" as SfxName,
          atMs: startMs,
          pitch: undefined,
          note: "pointer click — the library's default interface click"
        }
      ];

    case "createNote":
      return [
        {
          name: "ui_pop_sfx_neutral_776016" as SfxName,
          atMs: startMs,
          pitch: undefined,
          note: "the note card popping into existence in place"
        }
      ];

    case "type":
      return keystrokes(startMs, step.ms);

    case "move":
      // The friction is audible as soon as the card starts travelling; a quarter
      // of the way in is where the drag reads as underway rather than as a nudge.
      return [
        {
          name: "movement_glass_slide_9_323421" as SfxName,
          atMs: startMs + step.ms * 0.25,
          pitch: undefined,
          note: "the card dragging across the page — contact, not free flight"
        }
      ];

    case "setHidden":
      return step.hidden
        ? [
            {
              name: "movement_swoosh_v2_786514" as SfxName,
              atMs: startMs + step.ms * 0.3,
              pitch: undefined,
              note: "the note leaving for the badge — the falling pitch reads as closure"
            }
          ]
        : [
            {
              name: "ui_pop_sfx_neutral_776016" as SfxName,
              atMs: startMs + step.ms * 0.3,
              pitch: undefined,
              note: "the note coming back into place"
            }
          ];

    case "appendQuote":
      return [
        {
          name: "ui_ppop_wav_527522" as SfxName,
          atMs: startMs,
          pitch: undefined,
          note: "the quoted selection arriving in the note — small, in place, no travel"
        }
      ];

    case "contextMenu":
      return step.at === null
        ? []
        : [
            {
              name: "ui_click_basic_220197" as SfxName,
              atMs: startMs,
              pitch: undefined,
              note: "the right-click that opens the browser's context menu"
            }
          ];

    case "noteMenu":
      return step.id === null
        ? []
        : [
            {
              name: "ui_ppop_wav_527522" as SfxName,
              atMs: startMs,
              pitch: undefined,
              note: "the small options menu appearing"
            }
          ];

    case "badgeList":
      return step.open
        ? [
            {
              name: "ui_pop_sfx_neutral_776016" as SfxName,
              atMs: startMs,
              pitch: undefined,
              note: "the badge's list of hidden notes opening"
            }
          ]
        : [];

    case "popup":
      return step.open
        ? [
            {
              name: "ui_pop_sfx_neutral_776016" as SfxName,
              atMs: startMs,
              pitch: undefined,
              note: "the toolbar popup appearing"
            }
          ]
        : [];

    case "sfx":
      return [{ name: step.name, atMs: startMs, pitch: step.pitch, note: step.note }];

    case "parallel":
      return step.steps.flatMap((child) => draftsFor(child, startMs));

    // Silent on purpose. A fade has no acoustic counterpart, the camera and the
    // blur are the viewer's attention being directed rather than an event, and
    // dragging a cursor through a sentence makes no sound.
    case "hold":
    case "cursor":
    case "select":
    case "zoom":
    case "focus":
    case "outro":
      return [];
  }
}

export interface CueOptions {
  /**
   * Measured narration level in dBFS, from the voice timeline. `null` on a
   * video with no voiceover, which falls back to an absolute reference.
   */
  voiceRefDb: number | null;
}

/**
 * Every sound in a video, derived from its steps.
 *
 * Pure: the same timeline always yields the same cues at the same levels, which
 * is what lets the pre-render gate measure exactly what will be rendered.
 */
export function cuesFrom(steps: Step[], options: CueOptions): SfxCue[] {
  const voiceRefDb = options.voiceRefDb ?? ABSOLUTE_REFERENCE_DB;

  const drafts: CueDraft[] = [];
  let startMs = 0;
  for (const step of steps) {
    drafts.push(...draftsFor(step, startMs));
    startMs += step.ms;
  }
  drafts.sort((a, b) => a.atMs - b.atMs);

  // Pitch is assigned after ordering, by how many times that sample has already
  // been heard — so the variation follows the ear rather than the source step.
  const heard = new Map<string, number>();

  return drafts.map((draft) => {
    const key = String(draft.name);
    const occurrence = heard.get(key) ?? 0;
    heard.set(key, occurrence + 1);
    return {
      name: draft.name,
      atMs: Math.round(draft.atMs),
      gain: gainFor(draft.name, voiceRefDb),
      pitch: draft.pitch ?? pitchForOccurrence(occurrence),
      note: draft.note
    };
  });
}
