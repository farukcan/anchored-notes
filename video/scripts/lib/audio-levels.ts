/**
 * Level arithmetic shared by the pre-render gate and the post-render waveform
 * check, so the two can never disagree about what counts as clipping.
 */

/** Sample rate Remotion's renderer mixes at (`@remotion/renderer` options/sample-rate). */
export const MIX_SAMPLE_RATE = 48_000;

/** Rate for windowed analysis in JS — plenty for level envelopes, cheap to decode. */
export const ANALYSIS_SAMPLE_RATE = 22_050;

/** A summed mix at or above this is clipping outright. */
export const CLIP_DB = 0;

/** Above this there is no headroom left for the lossy encode that follows. */
export const RISK_DB = -1;

/** Windows quieter than this are treated as pauses, not speech. */
export const SPEECH_FLOOR_DB = -40;

/** Envelope window for "how loud is this, moment to moment". */
export const RMS_WINDOW_SECONDS = 0.05;

export const toDb = (amplitude: number): number => 20 * Math.log10(amplitude + 1e-9);

export const fromDb = (db: number): number => 10 ** (db / 20);

/** Gain that moves a source peaking at `peakDb` to `targetPeakDb`. */
export const gainForTargetPeak = (peakDb: number, targetPeakDb: number): number =>
  fromDb(targetPeakDb - peakDb);

/** Sliding-window RMS in dBFS, one value per window. */
export const windowRmsDb = (
  samples: Float32Array,
  sampleRate: number,
  windowSeconds: number,
): readonly number[] => {
  const windowSize = Math.max(1, Math.round(sampleRate * windowSeconds));
  const values: number[] = [];
  for (let start = 0; start + windowSize <= samples.length; start += windowSize) {
    let sum = 0;
    for (let index = start; index < start + windowSize; index += 1) {
      const sample = samples[index] as number;
      sum += sample * sample;
    }
    values.push(toDb(Math.sqrt(sum / windowSize)));
  }
  return values;
};

export const peakDb = (samples: Float32Array): number => {
  let peak = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const magnitude = Math.abs(samples[index] as number);
    if (magnitude > peak) {
      peak = magnitude;
    }
  }
  return toDb(peak);
};

/**
 * The level a voice actually sits at while speaking.
 *
 * Deliberately the median of the *active* windows rather than `mean_volume`:
 * a mean is dragged down by every pause and a max is set by a single emphatic
 * word. What the gate needs is "when a cue fires, how loud is the narration
 * likely to be right then" — which is the middle of the speaking distribution.
 */
export const medianActiveRmsDb = (
  samples: Float32Array,
  sampleRate: number,
  floorDb: number,
): number | null => {
  const active = windowRmsDb(samples, sampleRate, RMS_WINDOW_SECONDS)
    .filter((value) => value > floorDb)
    .sort((a, b) => a - b);
  if (active.length === 0) {
    return null;
  }
  return active[Math.floor(active.length / 2)] as number;
};
