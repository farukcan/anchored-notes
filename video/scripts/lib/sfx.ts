import {spawnSync} from "node:child_process";
import {readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {sfxRoot, videoRoot} from "./paths";

export const SFX_ROLES = ["ui", "movement", "impact", "transition", "feedback"] as const;

export type SfxRole = (typeof SFX_ROLES)[number];

/** Hard ceiling for a single sound effect. Anything longer is music or ambience. */
export const MAX_SFX_SECONDS = 30;

/**
 * Target peak level every sound is normalized towards via `defaultGain`.
 *
 * `defaultGain` is clamped at 1.0 — the library never boosts, so a sound quieter
 * than the target stays quieter. Those entries surface as `defaultGain: 1`.
 */
const TARGET_PEAK_DB = -14;

/** Decode sample rate for measurement. High enough for attack precision, cheap to process. */
const ANALYSIS_SAMPLE_RATE = 22050;

/** Envelope smoothing window. Raw argmax latches onto single-sample clicks. */
const SMOOTHING_SECONDS = 0.005;

export const sfxInboxDir = path.join(sfxRoot, "inbox");
export const sfxSourcesPath = path.join(sfxRoot, "sources.json");
export const sfxManifestPath = path.join(sfxRoot, "manifest.json");
export const sfxAttributionsPath = path.join(sfxRoot, "ATTRIBUTIONS.md");
export const sfxRoleDir = (role: SfxRole) => path.join(sfxRoot, role);

export {sfxRoot};

/**
 * Resolve a manifest `file` value to an absolute path.
 *
 * The value is written public-relative (`sfx/ui/click.mp3`) because that is the
 * string `staticFile()` takes at render time. On disk the library lives at
 * video/sfx/, which is the same suffix — so the two agree without a second
 * spelling of every path.
 */
export const sfxAbsolutePath = (file: string) => path.join(videoRoot, file);

/** How the semantic layer (role/tags/description) was produced. */
export type SfxSemanticsProvider = "freesound" | "clap" | "manual";

export type SfxOrigin = {
  kind: "freesound" | "manual";
  sourceId: number | null;
  sourceUrl: string | null;
  author: string | null;
  license: string;
  attribution: string | null;
  addedAt: string;
};

export type SfxSemantics = {
  provider: SfxSemanticsProvider;
  tags: string[];
  description: string;
  /** CLAP top1-top2 margin. `null` when the provider does not score its output. */
  confidence: number | null;
  /** Provider-specific evidence, kept for auditing. Shape varies by provider. */
  raw: Record<string, unknown>;
};

export type SfxCurated = {
  tags: string[];
  use: string;
  avoid: string;
  pairsWith: string[];
};

/**
 * One entry of `public/sfx/sources.json` — the hand/agent-editable input layer.
 *
 * Both feeding paths (Freesound API and manual drop + CLAP tagging) write this
 * exact shape; they differ only in `semantics.provider` and `roleSource`.
 */
export type SfxSourceEntry = {
  file: string;
  role: SfxRole;
  roleSource: "freesound_query" | "clap" | "manual";
  origin: SfxOrigin;
  semantics: SfxSemantics;
  curated: SfxCurated;
  needsReview: boolean;
};

export type SfxSources = Record<string, SfxSourceEntry>;

/** One entry of the generated `public/sfx/manifest.json` — provider differences flattened away. */
export type SfxManifestEntry = {
  file: string;
  role: SfxRole;
  tags: string[];
  description: string;
  use: string;
  avoid: string;
  pairsWith: string[];
  durationSeconds: number;
  attackSeconds: number;
  peakDb: number;
  rmsDb: number;
  sampleRate: number;
  defaultGain: number;
  license: string;
  attribution: string | null;
  sourceUrl: string | null;
  provider: SfxSemanticsProvider;
  confidence: number | null;
  needsReview: boolean;
  needsCuration: boolean;
};

export type SfxManifest = Record<string, SfxManifestEntry>;

export type AudioMeasurement = {
  durationSeconds: number;
  attackSeconds: number;
  peakDb: number;
  rmsDb: number;
  sampleRate: number;
  defaultGain: number;
};

export const isSfxRole = (value: string): value is SfxRole =>
  (SFX_ROLES as readonly string[]).includes(value);

export const readSources = async (): Promise<SfxSources> => {
  const raw = await readFile(sfxSourcesPath, "utf8").catch(() => "{}");
  return JSON.parse(raw) as SfxSources;
};

export const writeSources = async (sources: SfxSources): Promise<void> => {
  const ordered = Object.fromEntries(
    Object.entries(sources).sort(([a], [b]) => a.localeCompare(b)),
  );
  await writeFile(sfxSourcesPath, `${JSON.stringify(ordered, null, 2)}\n`, "utf8");
};

export const readManifest = async (): Promise<SfxManifest> => {
  const raw = await readFile(sfxManifestPath, "utf8");
  return JSON.parse(raw) as SfxManifest;
};

/** Slugify a source name into a manifest key segment. */
export const slugify = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32) || "sound";

const toDb = (value: number): number => Math.round(20 * Math.log10(value + 1e-9) * 10) / 10;

/**
 * Measure a sound file by decoding it to mono float PCM with ffmpeg.
 *
 * `attackSeconds` is the load-bearing output: `<Sfx>` shifts each cue earlier by
 * this amount so the sound's peak lands on the animation's peak instead of its
 * start. Measured on a 5 ms smoothed envelope — a raw argmax latches onto a
 * single-sample transient and reports an attack of 0, which plays early.
 */
export const measureAudio = (filePath: string): AudioMeasurement => {
  const result = spawnSync(
    "ffmpeg",
    ["-v", "error", "-i", filePath, "-ac", "1", "-ar", String(ANALYSIS_SAMPLE_RATE), "-f", "f32le", "-"],
    {encoding: "buffer", maxBuffer: 256 * 1024 * 1024},
  );

  if (result.error || result.status !== 0) {
    throw new Error(
      `ffmpeg failed to decode ${filePath} (status ${result.status}): ` +
        `${result.error?.message ?? ""} ${result.stderr?.toString() ?? ""}`.trim(),
    );
  }

  // Copy before viewing as Float32Array: a Buffer's byteOffset is not guaranteed
  // to be 4-byte aligned, and an unaligned view throws.
  const pcm = Uint8Array.prototype.slice.call(result.stdout);
  const samples = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 4));
  if (samples.length === 0) {
    throw new Error(`Decoded no audio samples from ${filePath} — file is empty or corrupt.`);
  }

  let peak = 0;
  let sumOfSquares = 0;
  for (const sample of samples) {
    const magnitude = Math.abs(sample);
    if (magnitude > peak) {
      peak = magnitude;
    }
    sumOfSquares += sample * sample;
  }

  const window = Math.max(1, Math.round(ANALYSIS_SAMPLE_RATE * SMOOTHING_SECONDS));
  let running = 0;
  let smoothedPeak = -1;
  let smoothedPeakIndex = 0;
  for (let index = 0; index < samples.length; index += 1) {
    running += Math.abs(samples[index]);
    if (index >= window) {
      running -= Math.abs(samples[index - window]);
    }
    const average = running / Math.min(index + 1, window);
    if (average > smoothedPeak) {
      smoothedPeak = average;
      smoothedPeakIndex = index;
    }
  }

  const peakDb = toDb(peak);
  const rmsDb = toDb(Math.sqrt(sumOfSquares / samples.length));
  const attackCenter = Math.max(0, smoothedPeakIndex - Math.floor(window / 2));

  return {
    durationSeconds: Math.round((samples.length / ANALYSIS_SAMPLE_RATE) * 1000) / 1000,
    attackSeconds: Math.round((attackCenter / ANALYSIS_SAMPLE_RATE) * 1000) / 1000,
    peakDb,
    rmsDb,
    sampleRate: probeSampleRate(filePath),
    defaultGain: Math.round(Math.min(1, 10 ** ((TARGET_PEAK_DB - peakDb) / 20)) * 100) / 100,
  };
};

const probeSampleRate = (filePath: string): number => {
  const result = spawnSync(
    "ffprobe",
    [
      "-v", "error",
      "-select_streams", "a:0",
      "-show_entries", "stream=sample_rate",
      "-of", "default=nw=1:nk=1",
      filePath,
    ],
    {encoding: "utf8"},
  );

  if (result.error || result.status !== 0) {
    throw new Error(
      `ffprobe failed on ${filePath}: ${result.error?.message ?? ""} ${result.stderr ?? ""}`.trim(),
    );
  }

  const sampleRate = Number.parseInt(result.stdout.trim(), 10);
  if (!Number.isFinite(sampleRate)) {
    throw new Error(
      `ffprobe reported no usable sample rate for ${filePath} (got "${result.stdout.trim()}").`,
    );
  }

  return sampleRate;
};

export const emptyCurated = (): SfxCurated => ({tags: [], use: "", avoid: "", pairsWith: []});
