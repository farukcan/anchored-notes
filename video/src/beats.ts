// Beats to steps: where the narration decides how long things take.
//
// A scenario states how long each beat would take on its own — how long the
// camera needs to push in, how long the drag reads for. Those numbers are good
// enough to build and scrub against, but they are not what the finished video
// runs at: once a line is spoken, the sentence's real length is the only
// duration that matters. Cutting narration to fit a camera move is backwards,
// and letting the camera finish early leaves the beat sitting silent.
//
// So a measured beat's steps are scaled to the spoken length, proportionally,
// and the result is a plain Step[] — src/driver.ts never learns that beats
// exist and stays a pure function of a flat timeline.

import type { Beat, Step } from "./types";

/**
 * How far a beat may be stretched or squeezed before the motion inside it stops
 * reading. Past this the fix is to rewrite the line, not to scale harder: at
 * half speed a drag looks like a hesitation, and at double speed a push-in
 * becomes a jump.
 */
const SCALE_LIMITS = { low: 0.6, high: 1.8 };

/** A beat's natural length: what its steps ask for with nothing spoken over them. */
export function naturalMs(beat: Beat): number {
  return beat.steps.reduce((total, step) => total + step.ms, 0);
}

export function beatsDurationMs(beats: Beat[]): number {
  return beats.reduce((total, beat) => total + naturalMs(beat), 0);
}

/**
 * Restate a step at a new duration.
 *
 * A `parallel` step's children are scaled by the ratio the step itself was
 * given, not by the beat's overall factor: the two differ once the parent's
 * duration has been rounded to a whole millisecond, and a child left a fraction
 * longer than its parent trips the driver's "could never finish" guard.
 */
function retimeStep(step: Step, targetMs: number): Step {
  if (step.action !== "parallel") return { ...step, ms: targetMs };
  const factor = targetMs / step.ms;
  return {
    ...step,
    ms: targetMs,
    steps: step.steps.map((child) => retimeStep(child, child.ms * factor))
  };
}

/**
 * Distribute a target duration across a beat's steps without drift.
 *
 * Rounding each step independently would leave the beat a millisecond or two
 * short or long, and those errors accumulate across a video until the captions
 * no longer line up with what is on screen. Rounding the running total instead
 * makes every beat land exactly on its target.
 */
function fitSteps(steps: Step[], naturalTotal: number, targetMs: number): Step[] {
  const fitted: Step[] = [];
  let consumedNatural = 0;
  let emitted = 0;

  for (const step of steps) {
    consumedNatural += step.ms;
    const boundary = Math.round((consumedNatural / naturalTotal) * targetMs);
    fitted.push(retimeStep(step, boundary - emitted));
    emitted = boundary;
  }

  return fitted;
}

export interface BeatTiming {
  /** Beat id → measured spoken length in milliseconds. */
  beats: Record<string, number>;
}

/**
 * Flatten beats into the step timeline the driver runs.
 *
 * `timing` is null while a video has no voiceover yet — Studio scrubbing, a
 * silent preview — and then the scenario's own numbers are used unchanged.
 *
 * A beat missing from a supplied timing map is a hard error rather than a
 * fallback to its natural length: it means the narration and the scenario have
 * drifted apart, and a video that quietly renders the old timeline for one beat
 * is worse than one that refuses to render.
 */
export function flattenBeats(beats: Beat[], timing: BeatTiming | null): Step[] {
  if (beats.length === 0) {
    throw new Error("a scenario built no beats — check its build() for the requested format");
  }

  const seen = new Set<string>();
  const steps: Step[] = [];

  for (const beat of beats) {
    if (seen.has(beat.id)) {
      throw new Error(`duplicate beat id "${beat.id}" — ids key the narration and the captions`);
    }
    seen.add(beat.id);

    const natural = naturalMs(beat);
    if (natural <= 0) {
      throw new Error(`beat "${beat.id}" has no duration — every beat needs at least one step`);
    }

    if (timing === null) {
      steps.push(...beat.steps);
      continue;
    }

    const target = timing.beats[beat.id];
    if (target === undefined) {
      throw new Error(
        `beat "${beat.id}" has no measured duration — re-run \`npm run voiceover\` after changing the scenario`
      );
    }

    const factor = target / natural;
    if (factor < SCALE_LIMITS.low || factor > SCALE_LIMITS.high) {
      throw new Error(
        `beat "${beat.id}" would scale by ${factor.toFixed(2)}x (${natural}ms of motion under ${target}ms of speech). ` +
          `Rewrite the line or the steps rather than scaling past ${SCALE_LIMITS.low}-${SCALE_LIMITS.high}x.`
      );
    }

    steps.push(...fitSteps(beat.steps, natural, target));
  }

  return steps;
}
