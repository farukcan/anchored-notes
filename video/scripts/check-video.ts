// Static checks on a video's plan, before anything is rendered.
//
// These are the claims a scenario makes about itself that nothing else would
// catch: that its hook names a beat that exists, that a caption is on screen
// long enough to read, and that no beat has been stretched past the point where
// its motion still reads. All of them are silent failures — the video renders,
// and only a viewer finds out.

import { LANGS } from "../../store-assets/gen/i18n.mjs";
import { NEW_NOTE_SIZE, NOW, STAGE_HEIGHT, STAGE_WIDTH, demoNotes, homeView, initialView } from "../stage-url";
import { FORMATS, FPS } from "../src/Root";
import { stateAt } from "../src/driver";
import { framingDelta, framingFor, viewFor, visibleArea } from "../src/camera";
import type { Step } from "../src/types";
import { getScenario } from "../scenarios/index";
import { captionsFrom, unreadablePhrases } from "../src/captions";
import { naturalMs } from "../src/beats";
import { parseTarget, planFor } from "./lib/plan";

const target = parseTarget(process.argv.slice(2));
const scenario = getScenario(target.scenario);
const plan = planFor(target.scenario, target.lang, target.format);
const timing = plan.voice ? { beats: plan.voice.beats } : null;

const failures: string[] = [];

/**
 * A selection nobody can see being made.
 *
 * A `focus` step steps the page back behind whatever is sharp, and the browser's
 * selection highlight goes back with it — so a passage selected while the page
 * is blurred is selected invisibly, and the beat that was about taking a line
 * off the page shows nothing happening. Evaluated through the real driver at the
 * moment each drag ends, because that is the only way to be sure this agrees
 * with what will be rendered.
 */
const PAGE_BLUR_CEILING = 0.15;
const seeded =
  scenario.seed === "demo"
    ? demoNotes(LANGS[target.lang].notes, LANGS[target.lang].dir === "rtl", "page", "https://stage", NOW)
    : {};

/** Every step in the tree, with the millisecond it ends at. */
function endTimes(steps: readonly Step[], startMs: number): { step: Step; endMs: number }[] {
  const out: { step: Step; endMs: number }[] = [];
  let at = startMs;
  for (const step of steps) {
    out.push({ step, endMs: at + step.ms });
    // A parallel step's children run inside its window, from the same instant —
    // and a select is almost always one of them, so a walk that only looked at
    // the top level would check nothing at all.
    if (step.action === "parallel") out.push(...endTimes(step.steps, at));
    at += step.ms;
  }
  return out;
}

for (const { step, endMs } of endTimes(plan.steps, 0)) {
  if (step.action === "select" && step.target !== null) {
    const at = stateAt({
      steps: plan.steps,
      timeMs: endMs,
      seedNotes: seeded,
      pageKey: "page",
      now: NOW,
      home: homeView(target.format),
      initial: homeView(target.format)
    });
    if (at.focus.page > PAGE_BLUR_CEILING) {
      failures.push(
        `the selection of "#${step.target}" finishes with the page ${Math.round(at.focus.page * 100)}% ` +
          "blurred, so the highlight is not visible — lift the focus before selecting"
      );
    }
  }
}

/**
 * A camera cut nobody asked for.
 *
 * Every shot in these videos is meant to be a move, not an edit — there is one
 * continuous take from the first frame to the closing card. So a shot that
 * changes by a large fraction of the frame between two consecutive frames is a
 * defect: it reads as a glitch rather than as a cut, because nothing around it
 * is cut. Measured through the same functions the composition uses, at the same
 * frame rate, so the answer is the one the viewer gets.
 */
const MAX_FRAME_MOVE = 0.18;
const size = FORMATS[target.format];
let previous = null as ReturnType<typeof framingFor> | null;
const offScreen: string[] = [];
let worst = { at: 0, delta: 0 };
const frames = Math.round((plan.durationMs / 1000) * FPS);

/** Which beat a moment falls in, so a failure names something a scenario can fix. */
const beatAt = (ms: number): string => {
  let start = 0;
  for (const beat of plan.beats) {
    const length = timing ? (timing.beats[beat.id] ?? naturalMs(beat)) : naturalMs(beat);
    if (ms < start + length) return beat.id;
    start += length;
  }
  return plan.beats[plan.beats.length - 1].id;
};

for (let frame = 0; frame <= frames; frame += 1) {
  const at = stateAt({
    steps: plan.steps,
    timeMs: (frame / FPS) * 1000,
    seedNotes: seeded,
    pageKey: "page",
    now: NOW,
    home: homeView(target.format),
    initial: initialView()
  });
  const framing = framingFor(viewFor(at, initialView()), size.width, size.height);

  // The pointer is what the viewer follows; off-screen it is a gesture nobody
  // can attribute to anything. Checked on every frame, not only during a drag.
  const area = visibleArea(framing, size.width, size.height);
  if (
    offScreen.length === 0 &&
    (at.cursor.x < area.left ||
      at.cursor.x > area.right ||
      at.cursor.y < area.top ||
      at.cursor.y > area.bottom)
  ) {
    offScreen.push(
      `the pointer leaves the frame in beat "${beatAt((frame / FPS) * 1000)}" at ` +
        `${(frame / FPS).toFixed(2)}s — it is at ` +
        `(${Math.round(at.cursor.x)}, ${Math.round(at.cursor.y)}) and the shot shows ` +
        `${Math.round(area.left)}..${Math.round(area.right)} x ${Math.round(area.top)}..${Math.round(area.bottom)}`
    );
  }

  if (previous) {
    const delta = framingDelta(previous, framing, size.width, size.height);
    if (delta > worst.delta) worst = { at: frame, delta };
  }
  previous = framing;
}

failures.push(...offScreen);

if (worst.delta > MAX_FRAME_MOVE) {
  failures.push(
    `the camera moves ${Math.round(worst.delta * 100)}% of the frame in one frame at ` +
      `${(worst.at / FPS).toFixed(2)}s — that is a cut, not a move. Ease the shot instead of switching it.`
  );
}

/**
 * A note the product would move somewhere else.
 *
 * src/content/note-card.ts keeps every card inside the viewport, so a scenario
 * that parks one past the edge gets a card at a different position from the one
 * it asked for — and every later step that aims at that card misses. It
 * surfaces hundreds of frames into a render, as a card that cannot be found.
 */
const maxX = STAGE_WIDTH - NEW_NOTE_SIZE.w;
const maxY = STAGE_HEIGHT - NEW_NOTE_SIZE.h;
for (const { step } of endTimes(plan.steps, 0)) {
  if (step.action !== "move") continue;
  if (step.to.x < 0 || step.to.x > maxX || step.to.y < 0 || step.to.y > maxY) {
    failures.push(
      `note "${step.id}" is parked at (${step.to.x}, ${step.to.y}), which the extension clamps ` +
        `into 0..${maxX} × 0..${maxY} — later steps would aim at a card that is not there`
    );
  }
}

const hook = scenario.hook(target.lang);
if (!plan.beats.some((beat) => beat.id === hook.payoffBeat)) {
  failures.push(
    `the hook promises "${hook.gap}" and says beat "${hook.payoffBeat}" delivers it, ` +
      `but this cut has no such beat — it has ${plan.beats.map((b) => b.id).join(", ")}`
  );
}
const hookWords = hook.onScreenText.split(/\s+/).length;
if (hookWords > 5) {
  failures.push(`hook text is ${hookWords} words — it has to be read in about a second, so keep it to five`);
}

const phrases = plan.voice ? plan.voice.phrases : captionsFrom(plan.beats, timing);
for (const phrase of unreadablePhrases(phrases)) {
  failures.push(
    `"${phrase.text}" is on screen for ${phrase.toMs - phrase.fromMs}ms — too short to read. ` +
      `Shorten the line or lengthen beat "${phrase.beat}".`
  );
}

for (const beat of plan.beats) {
  if (timing === null) continue;
  const factor = (timing.beats[beat.id] ?? naturalMs(beat)) / naturalMs(beat);
  if (factor < 0.6 || factor > 1.8) {
    failures.push(`beat "${beat.id}" is scaled ${factor.toFixed(2)}x by its narration`);
  }
}

console.log(
  `${target.scenario} · ${target.lang} · ${target.format} — ` +
    `${plan.beats.length} beat(s), ${phrases.length} caption(s), ` +
    `${(plan.durationMs / 1000).toFixed(1)}s${plan.voice ? " (narrated)" : " (silent)"} · ` +
    `fastest camera move ${Math.round(worst.delta * 100)}% of a frame ` +
    `at ${(worst.at / FPS).toFixed(2)}s (ceiling ${Math.round(MAX_FRAME_MOVE * 100)}%)`
);
for (const beat of plan.beats) {
  const lines = phrases.filter((phrase) => phrase.beat === beat.id).length;
  console.log(`  ${beat.id.padEnd(8)} ${String(naturalMs(beat)).padStart(6)}ms  ${lines} caption(s)`);
}
for (const failure of failures) console.log(`FAIL  ${failure}`);

if (failures.length > 0) process.exit(1);
console.log("verdict: PASS");
