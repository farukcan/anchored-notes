import {spawnSync} from "node:child_process";

/**
 * Shared ffmpeg/ffprobe access.
 *
 * Before this module existed every script shelled out in its own style —
 * `spawnSync`, `execFileSync`, and in one case `execSync` with an interpolated
 * shell string that broke on paths containing spaces. Duration probing was
 * written twice with two different `-of` spellings. New audio work needs all of
 * these, so they live in one place with array arguments (no shell) instead of a
 * sixth copy.
 */

const MAX_BUFFER_BYTES = 256 * 1024 * 1024;

export type CommandResult = {
  stdout: string;
  stderr: string;
};

export const run = (bin: string, args: readonly string[]): CommandResult => {
  const result = spawnSync(bin, [...args], {encoding: "utf8", maxBuffer: MAX_BUFFER_BYTES});
  if (result.error) {
    throw new Error(`${bin} failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `${bin} exited with ${result.status}\n` +
        `args: ${args.join(" ")}\n` +
        `stderr: ${(result.stderr ?? "").slice(-2000)}`,
    );
  }
  return {stdout: result.stdout ?? "", stderr: result.stderr ?? ""};
};

export const probeDurationSeconds = (filePath: string): number => {
  const {stdout} = run("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  const seconds = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(seconds)) {
    throw new Error(`ffprobe returned no usable duration for ${filePath}`);
  }
  return seconds;
};

/** `volumedetect` writes to stderr; both values are absent for a silent input. */
export const volumeDetect = (filePath: string): {maxDb: number | null; meanDb: number | null} => {
  const {stderr} = run("ffmpeg", [
    "-nostdin", "-v", "info",
    "-i", filePath,
    "-vn", "-af", "volumedetect",
    "-f", "null", "-",
  ]);
  const read = (label: string): number | null => {
    const match = new RegExp(`${label}:\\s*(-?[\\d.]+) dB`).exec(stderr);
    return match ? Number.parseFloat(match[1] as string) : null;
  };
  return {maxDb: read("max_volume"), meanDb: read("mean_volume")};
};

export type Band = {
  lowHz: number | null;
  highHz: number | null;
};

const bandFilter = (band: Band): string => {
  const stages: string[] = [];
  // Two passes of a 2-pole filter give a steeper skirt, so neighbouring bands
  // do not smear into each other and the tilt measurement stays meaningful.
  if (band.lowHz !== null) {
    stages.push(`highpass=f=${band.lowHz}:poles=2`, `highpass=f=${band.lowHz}:poles=2`);
  }
  if (band.highHz !== null) {
    stages.push(`lowpass=f=${band.highHz}:poles=2`, `lowpass=f=${band.highHz}:poles=2`);
  }
  return stages.length > 0 ? stages.join(",") : "anull";
};

/** RMS of one frequency band, in dBFS. Returns null when the band is silent. */
export const bandRmsDb = (filePath: string, band: Band): number | null => {
  const {stderr} = run("ffmpeg", [
    "-nostdin", "-v", "info",
    "-i", filePath,
    "-vn", "-af", `${bandFilter(band)},astats=metadata=1:reset=0`,
    "-f", "null", "-",
  ]);
  const match = /RMS level dB:\s*(-?[\d.inf]+)/i.exec(stderr);
  if (!match) {
    return null;
  }
  const value = Number.parseFloat(match[1] as string);
  return Number.isFinite(value) ? value : null;
};

/** Decode to mono float samples for windowed analysis in JS. */
export const decodePcmMono = (filePath: string, sampleRate: number): Float32Array => {
  const result = spawnSync(
    "ffmpeg",
    [
      "-nostdin", "-v", "error",
      "-i", filePath,
      "-vn", "-ac", "1", "-ar", String(sampleRate),
      "-f", "f32le", "-",
    ],
    {encoding: "buffer", maxBuffer: MAX_BUFFER_BYTES},
  );
  if (result.status !== 0) {
    throw new Error(`ffmpeg decode failed for ${filePath}: ${result.stderr?.toString().slice(-2000)}`);
  }
  const buffer = result.stdout;
  return new Float32Array(buffer.buffer, buffer.byteOffset, Math.floor(buffer.length / 4));
};

/**
 * Render a filter graph to a wav file.
 *
 * `durationSeconds` is applied with `-t` so every stem is exactly as long as the
 * composition, which lets them be summed without any length bookkeeping.
 *
 * Output is 32-bit float on purpose. A summed mix can exceed full scale, and an
 * integer format silently clamps it — the measurement would then read exactly
 * 0 dBFS for a mix that is 0.1 dB over and one that is 10 dB over, which is the
 * difference between "fine" and "unlistenable". Float keeps the overshoot
 * measurable.
 */
export const renderGraph = (
  inputs: readonly string[],
  filterComplex: string,
  outLabel: string,
  durationSeconds: number,
  outPath: string,
): void => {
  const args = ["-nostdin", "-v", "error", "-y"];
  for (const input of inputs) {
    args.push("-i", input);
  }
  args.push(
    "-filter_complex", filterComplex,
    "-map", `[${outLabel}]`,
    "-t", durationSeconds.toFixed(3),
    "-c:a", "pcm_f32le",
    outPath,
  );
  run("ffmpeg", args);
};
