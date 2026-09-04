// Static rules a sound design has to satisfy, checked before anything is mixed.
//
// Nobody in this pipeline can hear the result, so the things that can be
// counted are counted: whether two sounds land close enough to smear, how many
// play at once, whether a repeated sample was varied. It also writes the cue
// sheet that audio-preflight measures, so the two agree on what will be played.
//
// Exit 1 blocks the render.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { cueSheetPath } from "./lib/paths";
import { FPS, planFor, parseTarget, resolveCues, type ResolvedCue } from "./lib/plan";
import { readManifest } from "./lib/sfx";

/** Below this two sounds are heard as one smeared event rather than as two. */
const MIN_GAP_MS = 100;

/** More than this at once and no single sound is legible. */
const MAX_CONCURRENT = 3;

/**
 * Density ceiling, counted in interactions rather than in sounds.
 *
 * Sounds this close together are heard as one thing: a click and the panel it
 * opens, or a run of keystrokes. Counting each of them separately would forbid
 * a click from ever having a consequence, which is the opposite of what the
 * ceiling is for — it exists to stop unrelated sounds piling up.
 */
const EVENT_CHAIN_MS = 500;
const DENSITY_WINDOW_MS = 10_000;
const MAX_EVENTS_PER_WINDOW = 6;

/** The same sample this many times inside REPEAT_WINDOW_MS needs its pitch varied. */
const MAX_IDENTICAL_RUN = 2;
const REPEAT_WINDOW_MS = 2500;

interface Failure {
  rule: string;
  message: string;
}

const target = parseTarget(process.argv.slice(2));
const plan = planFor(target.scenario, target.lang, target.format);
const manifest = await readManifest();
const cues = resolveCues(plan.cues);

const failures: Failure[] = [];
const warnings: string[] = [];

for (const cue of cues) {
  const entry = manifest[cue.name];
  if (!entry) {
    failures.push({ rule: "unknown-sound", message: `"${cue.name}" is not in sfx/manifest.json` });
    continue;
  }
  if (entry.needsReview) {
    failures.push({
      rule: "needs-review",
      message: `"${cue.name}" was auto-tagged and never confirmed — its role may be wrong`
    });
  }
  if (entry.needsCuration) {
    failures.push({
      rule: "needs-curation",
      message: `"${cue.name}" has no curated use/avoid, so nothing justifies choosing it`
    });
  }
  if (cue.note.trim() === "") {
    failures.push({ rule: "no-note", message: `the cue at ${cue.atMs}ms says nothing about why` });
  }
  if (cue.atMs >= plan.durationMs) {
    failures.push({
      rule: "past-the-end",
      message: `"${cue.name}" sits at ${cue.atMs}ms in a ${Math.round(plan.durationMs)}ms video`
    });
  }
  if (cue.atMs < cue.attackSeconds * 1000) {
    warnings.push(
      `"${cue.name}" at ${cue.atMs}ms starts before frame 0 once its ${Math.round(
        cue.attackSeconds * 1000
      )}ms attack is allowed for — it will peak late`
    );
  }
}

// Spacing, measured between peaks: that is where the ear places an event.
for (let index = 1; index < cues.length; index += 1) {
  const gap = cues[index].atMs - cues[index - 1].atMs;
  if (gap < MIN_GAP_MS) {
    failures.push({
      rule: "too-close",
      message:
        `"${cues[index - 1].name}" and "${cues[index].name}" peak ${Math.round(gap)}ms apart ` +
        `(minimum ${MIN_GAP_MS}ms)`
    });
  }
}

// Concurrency, measured over playback spans rather than peaks — a long whoosh
// under three short clicks is four sounds at once even though the peaks are far
// apart.
for (const cue of cues) {
  const overlapping = cues.filter((other) => other.startMs < cue.endMs && other.endMs > cue.startMs);
  if (overlapping.length > MAX_CONCURRENT) {
    failures.push({
      rule: "too-many-at-once",
      message:
        `${overlapping.length} sounds overlap around ${Math.round(cue.atMs)}ms ` +
        `(maximum ${MAX_CONCURRENT}): ${overlapping.map((c) => c.name).join(", ")}`
    });
    break;
  }
}

// A repeated sample at one pitch reads as a stuck machine.
for (const cue of cues) {
  const run = cues.filter(
    (other) =>
      other.name === cue.name &&
      other.pitch === cue.pitch &&
      Math.abs(other.atMs - cue.atMs) < REPEAT_WINDOW_MS
  );
  if (run.length > MAX_IDENTICAL_RUN) {
    failures.push({
      rule: "unvaried-repeat",
      message:
        `"${cue.name}" plays ${run.length} times at pitch ${cue.pitch} within ` +
        `${REPEAT_WINDOW_MS}ms around ${Math.round(cue.atMs)}ms`
    });
    break;
  }
}

// Density, counted over interactions: consecutive cues within EVENT_CHAIN_MS
// of one another are one event.
const events: number[] = [];
let lastCueMs = -Infinity;
for (const cue of cues) {
  if (cue.atMs - lastCueMs > EVENT_CHAIN_MS) events.push(cue.atMs);
  lastCueMs = cue.atMs;
}
for (const at of events) {
  const inWindow = events.filter((other) => other >= at && other < at + DENSITY_WINDOW_MS).length;
  if (inWindow > MAX_EVENTS_PER_WINDOW) {
    warnings.push(
      `${inWindow} distinct sounds in the ten seconds from ${Math.round(at / 1000)}s — ` +
        `silence is a design tool, and the ceiling is ${MAX_EVENTS_PER_WINDOW}`
    );
    break;
  }
}

const sheet = cues.map((cue: ResolvedCue) => ({
  name: cue.name,
  role: cue.role,
  file: cue.file,
  atMs: cue.atMs,
  startMs: Math.round(cue.startMs),
  seconds: Math.round((cue.atMs / 1000) * 100) / 100,
  gain: cue.gain ?? null,
  pitch: cue.pitch ?? 1,
  peakDb: cue.peakDb,
  note: cue.note
}));

const sheetPath = cueSheetPath(target.scenario, target.lang, target.format);
mkdirSync(dirname(sheetPath), { recursive: true });
writeFileSync(
  sheetPath,
  `${JSON.stringify(
    { contractVersion: 1, ...target, fps: FPS, durationMs: Math.round(plan.durationMs), cues: sheet },
    null,
    2
  )}\n`
);

console.table(
  sheet.map((cue) => ({
    s: cue.seconds,
    name: cue.name.slice(0, 40),
    role: cue.role,
    gain: cue.gain,
    pitch: cue.pitch,
    why: cue.note.slice(0, 46)
  }))
);
console.log(
  `${cues.length} cue(s) over ${(plan.durationMs / 1000).toFixed(1)}s → ${sheetPath}` +
    (plan.voice ? "" : "  (no narration yet — levels use the absolute reference)")
);

for (const warning of warnings) console.log(`WARN  ${warning}`);
for (const failure of failures) console.log(`FAIL  [${failure.rule}] ${failure.message}`);

if (failures.length > 0) {
  console.log(`\n${failures.length} violation(s) — fix src/audio/cues.ts or the scenario's steps.`);
  process.exit(1);
}
console.log("verdict: PASS");
