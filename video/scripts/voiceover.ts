// Narration for one video: synthesis, pacing, and the timeline everything else
// is measured against.
//
// One request covers the whole script rather than one per beat. Text-to-speech
// reads a paragraph better than it reads a sentence in isolation — the model
// has no run-up on a fifty-character line — and the character timestamps that
// come back are what let the result be cut into beats afterwards without
// losing that continuity.
//
// Pacing is done from those timestamps rather than with voice activity
// detection. A gap between two words is already known exactly, so shortening
// the long ones needs nothing but ffmpeg, is deterministic, and cannot disagree
// with the alignment the way a separately-detected speech boundary can.
//
// Output is committed: the same text does not come back as the same audio
// twice, so a render consumes these files rather than producing them.

import "dotenv/config";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { ANALYSIS_SAMPLE_RATE, SPEECH_FLOOR_DB, medianActiveRmsDb } from "./lib/audio-levels";
import { decodePcmMono } from "./lib/ffmpeg";
import { voiceAudioPath, voiceRoot, voiceTimelinePath } from "./lib/paths";
import { parseTarget } from "./lib/plan";
import { getScenario } from "../scenarios/index";
import { naturalMs } from "../src/beats";
import type { VoicePhrase } from "../src/voice";

/**
 * The longest pause left between two words. Anything more is dead air: on a
 * feed it is where people leave, and the beats it belongs to would stretch the
 * camera to cover silence.
 */
const MAX_GAP_MS = 260;

/** Breath left at the very start, so the first word is not clipped by the encode. */
const LEAD_IN_MS = 80;

/** Caption phrases are cut at this many words unless the sentence ends first. */
const MAX_PHRASE_WORDS = 6;

/**
 * Playback level for the narration. Deliberately under 1: a master peaking near
 * 0 dBFS leaves nothing for the first sound effect, and the mix would clip on a
 * beat nobody thought was loud.
 */
const VOICE_VOLUME = 0.82;

interface Word {
  text: string;
  startMs: number;
  endMs: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — copy video/.env.example to video/.env and fill it in`);
  }
  return value;
}

/** Character timestamps folded into words. Whitespace ends a word and is dropped. */
function toWords(characters: string[], starts: number[], ends: number[]): Word[] {
  const words: Word[] = [];
  let text = "";
  let startMs = 0;

  const flush = (endMs: number): void => {
    if (text.length === 0) return;
    words.push({ text, startMs, endMs });
    text = "";
  };

  characters.forEach((char, index) => {
    if (/\s/.test(char)) {
      flush(ends[index - 1] * 1000);
      return;
    }
    if (text.length === 0) startMs = starts[index] * 1000;
    text += char;
  });
  flush(ends[ends.length - 1] * 1000);

  return words;
}

/**
 * Shorten every over-long pause and report where each word ends up.
 *
 * Returns the ffmpeg segments to keep, in source time, plus the words rewritten
 * onto the shortened timeline. The two are produced together on purpose: a
 * remap derived separately from the cut is how audio and captions drift apart.
 */
function tighten(words: Word[]): { keep: { fromMs: number; toMs: number }[]; paced: Word[] } {
  const keep: { fromMs: number; toMs: number }[] = [];
  const paced: Word[] = [];
  let outMs = LEAD_IN_MS;
  let cursorMs = Math.max(0, words[0].startMs - LEAD_IN_MS);

  words.forEach((word, index) => {
    const next = words[index + 1];
    const gapAfter = next ? next.startMs - word.endMs : 0;
    const trimmed = Math.min(gapAfter, MAX_GAP_MS);
    const segmentEnd = word.endMs + trimmed;

    paced.push({
      text: word.text,
      startMs: outMs + (word.startMs - cursorMs),
      endMs: outMs + (word.endMs - cursorMs)
    });

    if (next && gapAfter > MAX_GAP_MS) {
      keep.push({ fromMs: cursorMs, toMs: segmentEnd });
      outMs += segmentEnd - cursorMs;
      cursorMs = next.startMs;
    }
  });

  const last = words[words.length - 1];
  keep.push({ fromMs: cursorMs, toMs: last.endMs + LEAD_IN_MS });

  return { keep, paced };
}

/** Group words into caption-sized phrases, breaking on sentence ends first. */
function toPhrases(words: Word[], beat: string): VoicePhrase[] {
  const phrases: VoicePhrase[] = [];
  let current: Word[] = [];

  const flush = (): void => {
    if (current.length === 0) return;
    phrases.push({
      text: current.map((word) => word.text).join(" "),
      fromMs: Math.round(current[0].startMs),
      toMs: Math.round(current[current.length - 1].endMs),
      beat
    });
    current = [];
  };

  for (const word of words) {
    current.push(word);
    // A colon or a comma is not the end of a thought — breaking there leaves a
    // caption of two words on screen while the sentence carries on.
    if (/[.!?]$/.test(word.text) || current.length >= MAX_PHRASE_WORDS) flush();
  }
  flush();

  return phrases;
}

const target = parseTarget(process.argv.slice(2));
const scenario = getScenario(target.scenario);
const beats = scenario.build(target.lang, target.format);
const spoken = beats.filter((beat) => beat.narration !== null);

if (spoken.length === 0) {
  throw new Error(`${target.scenario} has no narration in "${target.lang}" — nothing to synthesise`);
}
// Speech has to be contiguous to be cut out of one recording. A silent beat in
// the middle would need silence spliced back in, which is a different job from
// the one this script does — and no scenario needs it yet.
const firstSilentIndex = beats.findIndex((beat) => beat.narration === null);
if (firstSilentIndex !== -1 && beats.slice(firstSilentIndex).some((beat) => beat.narration !== null)) {
  throw new Error(
    `${target.scenario} has a silent beat before a spoken one — narration must run without a break`
  );
}

const voiceId =
  (target.lang === "en" ? process.env.ELEVENLABS_VOICE_ID_EN : undefined) ??
  requireEnv("ELEVENLABS_VOICE_ID");
const modelId = process.env.ELEVENLABS_MODEL_ID ?? "eleven_v3";

const client = new ElevenLabsClient({ apiKey: requireEnv("ELEVENLABS_API_KEY") });
const script = spoken.map((beat) => beat.narration).join(" ");

console.log(`${target.scenario} · ${target.lang} · ${target.format}`);
console.log(`  ${spoken.length} spoken beat(s), ${script.split(/\s+/).length} words, voice ${voiceId}`);

const result = await client.textToSpeech.convertWithTimestamps(voiceId, {
  text: script,
  modelId,
  outputFormat: "mp3_44100_128",
  languageCode: target.lang
});

if (!result.alignment) {
  throw new Error("the model returned audio with no character alignment — beats cannot be measured");
}

const words = toWords(
  result.alignment.characters,
  result.alignment.characterStartTimesSeconds,
  result.alignment.characterEndTimesSeconds
);

// The words have to line up with the script one for one, or the beat
// boundaries below would be placed against the wrong syllables.
const scriptWords = script.split(/\s+/).filter((word) => word.length > 0);
if (words.length !== scriptWords.length) {
  throw new Error(
    `the model returned ${words.length} words for a ${scriptWords.length}-word script — ` +
      "beat boundaries cannot be derived from a mismatched alignment"
  );
}

const { keep, paced } = tighten(words);

const workDir = mkdtempSync(join(tmpdir(), "anchored-vo-"));
const rawPath = join(workDir, "raw.mp3");
writeFileSync(rawPath, Buffer.from(result.audioBase64, "base64"));

mkdirSync(voiceRoot, { recursive: true });
const outPath = voiceAudioPath(target.scenario, target.lang, target.format);

// One filter graph rather than one file per segment: concat demuxing a pile of
// re-encoded fragments would add a codec-delay seam at every join.
const trims = keep
  .map(
    (segment, index) =>
      `[0:a]atrim=start=${(segment.fromMs / 1000).toFixed(4)}:end=${(segment.toMs / 1000).toFixed(4)},` +
      `asetpts=PTS-STARTPTS[t${index}]`
  )
  .join(";");
const labels = keep.map((_, index) => `[t${index}]`).join("");

execFileSync(
  "ffmpeg",
  [
    "-y", "-v", "error",
    "-i", rawPath,
    "-filter_complex", `${trims};${labels}concat=n=${keep.length}:v=0:a=1[out]`,
    "-map", "[out]",
    "-c:a", "libmp3lame", "-q:a", "2",
    outPath
  ],
  { stdio: "inherit" }
);
rmSync(workDir, { recursive: true, force: true });

// Beat boundaries land in the middle of the breath between two beats, so
// neither one clips the other's first or last syllable.
const beatMs: Record<string, number> = {};
const phrases: VoicePhrase[] = [];
let consumed = 0;
let startMs = 0;

spoken.forEach((beat, index) => {
  const count = (beat.narration as string).split(/\s+/).filter((word) => word.length > 0).length;
  const beatWords = paced.slice(consumed, consumed + count);
  const next = paced[consumed + count];
  const endMs = next ? (beatWords[beatWords.length - 1].endMs + next.startMs) / 2 : null;
  const boundary =
    endMs === null ? beatWords[beatWords.length - 1].endMs + LEAD_IN_MS : endMs;

  beatMs[beat.id] = Math.round(boundary - startMs);
  phrases.push(...toPhrases(beatWords, beat.id));

  startMs = boundary;
  consumed += count;
  if (index === spoken.length - 1 && consumed !== paced.length) {
    throw new Error(`${paced.length - consumed} word(s) were not claimed by any beat`);
  }
});

// Silent beats keep the length their own steps ask for: there is no speech to
// measure them against, and the closing card should not be hurried.
for (const beat of beats) {
  if (beat.narration === null) beatMs[beat.id] = naturalMs(beat);
}

const referenceDb = medianActiveRmsDb(
  decodePcmMono(outPath, ANALYSIS_SAMPLE_RATE).map((sample) => sample * VOICE_VOLUME),
  ANALYSIS_SAMPLE_RATE,
  SPEECH_FLOOR_DB
);
if (referenceDb === null) {
  throw new Error("the narration has no measurable speech — every sound effect level derives from it");
}

const totalMs = beats.reduce((total, beat) => total + beatMs[beat.id], 0);

writeFileSync(
  voiceTimelinePath(target.scenario, target.lang, target.format),
  `${JSON.stringify(
    {
      contractVersion: 1,
      scenario: target.scenario,
      lang: target.lang,
      format: target.format,
      totalMs,
      voiceover: {
        file: `voice/${target.scenario}-${target.lang}-${target.format}.mp3`,
        volume: VOICE_VOLUME,
        wordCount: paced.length,
        referenceDb: Number(referenceDb.toFixed(1))
      },
      beats: beatMs,
      phrases
    },
    null,
    2
  )}\n`
);

const spokenMs = paced[paced.length - 1].endMs;
console.log(`  narration ${(spokenMs / 1000).toFixed(1)}s, video ${(totalMs / 1000).toFixed(1)}s`);
console.log(`  ${(paced.length / (spokenMs / 1000)).toFixed(2)} words/sec · reference ${referenceDb.toFixed(1)} dBFS`);
for (const beat of beats) {
  const natural = naturalMs(beat);
  const factor = beatMs[beat.id] / natural;
  const flag = factor < 0.6 || factor > 1.8 ? "  ← out of range, rewrite the line or the steps" : "";
  console.log(`  ${beat.id.padEnd(8)} ${String(beatMs[beat.id]).padStart(6)}ms  ${factor.toFixed(2)}x${flag}`);
}
console.log(`\n${voiceTimelinePath(target.scenario, target.lang, target.format)}`);
