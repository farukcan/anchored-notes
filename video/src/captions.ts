// Captions without a recording.
//
// A beat already carries the sentence it is about; turning that into timed
// phrases needs no audio, only the beat's own duration. So the ordinary video
// is silent apart from its sound effects and still says everything it has to
// say — which is how most people watch anyway.
//
// When a narration has been recorded, its measured phrases are used instead:
// speech has its own rhythm and text laid out against an estimate would drift
// from it. The two paths produce the same shape, so nothing downstream knows
// which one it got.

import { naturalMs } from "./beats";
import type { BeatTiming } from "./beats";
import type { Beat } from "./types";
import type { VoicePhrase } from "./voice";

/** Phrases are cut here unless a sentence ends first. Longer lines stop scanning. */
const MAX_PHRASE_WORDS = 6;

/**
 * How long a phrase needs to be read, per character.
 *
 * About 200 words a minute at five characters a word. Used only to divide a
 * beat between its phrases, never to decide the beat's length — the camera
 * owns that.
 */
const MS_PER_CHAR = 60;

/** A phrase is never held for less than this, however short it is. */
const MIN_PHRASE_MS = 900;

function splitPhrases(text: string): string[] {
  const phrases: string[] = [];
  let current: string[] = [];

  for (const word of text.split(/\s+/).filter((word) => word.length > 0)) {
    current.push(word);
    // A colon or a comma is not the end of a thought — breaking there leaves
    // two words on screen while the sentence carries on.
    if (/[.!?]$/.test(word) || current.length >= MAX_PHRASE_WORDS) {
      phrases.push(current.join(" "));
      current = [];
    }
  }
  if (current.length > 0) phrases.push(current.join(" "));

  return phrases;
}

/**
 * Timed caption phrases for a whole scenario.
 *
 * A beat's phrases divide its duration in proportion to their length, so a long
 * clause is not snatched away after the same interval as a short one. The last
 * phrase runs to the end of its beat: a caption that disappears before the beat
 * does leaves the viewer looking at an unexplained picture.
 */
export function captionsFrom(beats: Beat[], timing: BeatTiming | null): VoicePhrase[] {
  const out: VoicePhrase[] = [];
  let beatStart = 0;

  for (const beat of beats) {
    const beatMs = timing === null ? naturalMs(beat) : (timing.beats[beat.id] ?? naturalMs(beat));
    if (beat.narration === null) {
      beatStart += beatMs;
      continue;
    }

    const phrases = splitPhrases(beat.narration);
    const weights = phrases.map((phrase) => Math.max(MIN_PHRASE_MS, phrase.length * MS_PER_CHAR));
    const total = weights.reduce((sum, weight) => sum + weight, 0);

    let consumed = 0;
    phrases.forEach((text, index) => {
      consumed += weights[index];
      const end = index === phrases.length - 1 ? beatMs : Math.round((consumed / total) * beatMs);
      out.push({
        text,
        fromMs: beatStart + (index === 0 ? 0 : out[out.length - 1].toMs - beatStart),
        toMs: beatStart + end,
        beat: beat.id
      });
    });

    beatStart += beatMs;
  }

  return out;
}

/**
 * Whether the beats can be read at the pace they run at.
 *
 * Captions are the only voice a silent video has, so a line that is on screen
 * for less time than it takes to read is the same defect as a narrator talking
 * over themselves — and it is one nobody notices while scrubbing.
 */
export function unreadablePhrases(phrases: VoicePhrase[]): VoicePhrase[] {
  return phrases.filter((phrase) => phrase.toMs - phrase.fromMs < phrase.text.length * MS_PER_CHAR);
}
