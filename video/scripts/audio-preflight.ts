// Pre-render audio gate.
//
// Rebuilds the mix the renderer is about to produce — the narration and every
// sound effect — using the same ffmpeg filter chain Remotion uses, then
// measures it. Rendering is a slow way to find out that the effects are
// inaudible or that the mix clips, and neither is something anyone here can
// hear in advance.
//
// It is not a re-derivation of the levels: those come from src/audio/cues.ts
// and are exact. What it adds is the two things arithmetic cannot answer —
// whether the narration reference the cues were levelled against still matches
// the audio on disk, and what the overlapping cues sum to.
//
// Exit 1 blocks the render.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  ANALYSIS_SAMPLE_RATE,
  CLIP_DB,
  MIX_SAMPLE_RATE,
  RISK_DB,
  SPEECH_FLOOR_DB,
  fromDb,
  medianActiveRmsDb,
  peakDb as peakDbOf,
  toDb
} from "./lib/audio-levels";
import { decodePcmMono, renderGraph } from "./lib/ffmpeg";
import { cueSheetPath, preflightPath, voiceAudioPath } from "./lib/paths";
import { readManifest, sfxAbsolutePath } from "./lib/sfx";
import { FPS, parseTarget, planFor } from "./lib/plan";
import { ROLE_OFFSET_DB, ABSOLUTE_REFERENCE_DB } from "../src/audio/cues";

const CUE_FAIL_QUIET_DB = -6;
const CUE_FAIL_LOUD_DB = 6;
const CUE_WARN_DB = 3;

/** How far the timeline's stored narration level may drift from the file's. */
const REFERENCE_DRIFT_WARN_DB = 1.5;
const REFERENCE_DRIFT_FAIL_DB = 3;

type FindingCode =
  | "cue_buried"
  | "cue_too_loud"
  | "mix_clipping"
  | "mix_headroom"
  | "stale_reference"
  | "missing_cue_sheet";

interface Finding {
  severity: "fail" | "warn";
  code: FindingCode;
  message: string;
  fix: string;
}

interface CueReport {
  name: string;
  role: string;
  seconds: number;
  gain: number;
  pitch: number;
  achievedPeakDb: number;
  targetPeakDb: number;
  deltaDb: number;
  status: "ok" | "warn" | "fail";
}

const round = (value: number, digits: number): number => Number(value.toFixed(digits));

/**
 * One sound effect's chain, matching @remotion/renderer's stringify-ffmpeg-filter:
 * format, then volume, then the tone-frequency resample, then the delay. The
 * order matters — applying volume after the resample shifts the level on
 * pitched cues, and this gate is worthless if it measures a different mix from
 * the one that ships.
 */
function cueFilter(index: number, gain: number, pitch: number, delayMs: number): string {
  const stages = [`aformat=sample_fmts=s16:sample_rates=${MIX_SAMPLE_RATE}`, `volume=${gain.toFixed(4)}`];
  if (pitch !== 1) {
    stages.push(
      `asetrate=${Math.round(MIX_SAMPLE_RATE * pitch)}`,
      `aresample=${MIX_SAMPLE_RATE}`,
      `atempo=${(1 / pitch).toFixed(6)}`
    );
  }
  stages.push(`adelay=${delayMs}|${delayMs}`, "apad");
  return `[${index}:a]${stages.join(",")}[s${index}]`;
}

const manifest = await readManifest();
const target = parseTarget(process.argv.slice(2));
const keepStems = process.argv.includes("--keep-stems");
const plan = planFor(target.scenario, target.lang, target.format);
const durationSeconds = plan.durationMs / 1000;
const findings: Finding[] = [];

const sheetPath = cueSheetPath(target.scenario, target.lang, target.format);
let sheetCueCount: number | null = null;
try {
  const sheet = JSON.parse(readFileSync(sheetPath, "utf8")) as { cues: unknown[] };
  sheetCueCount = sheet.cues.length;
} catch {
  findings.push({
    severity: "warn",
    code: "missing_cue_sheet",
    message: "no cue sheet on disk, so the static rules were never checked",
    fix: `Run: npm run sfx-check -- ${target.scenario} ${target.lang} ${target.format}`
  });
}
if (sheetCueCount !== null && sheetCueCount !== plan.cues.length) {
  findings.push({
    severity: "warn",
    code: "missing_cue_sheet",
    message: `the cue sheet lists ${sheetCueCount} cues but the timeline now derives ${plan.cues.length}`,
    fix: `Re-run: npm run sfx-check -- ${target.scenario} ${target.lang} ${target.format}`
  });
}

const stemDir = join(dirname(sheetPath), `.preflight-${target.format}`);
mkdirSync(stemDir, { recursive: true });
const stemPath = (name: string): string => join(stemDir, `${name}.wav`);

// The narration stem, at the level the composition plays it.
let referenceDb = ABSOLUTE_REFERENCE_DB;
let referenceMode: "voiceover" | "absolute" = "absolute";
let voStem: string | null = null;

if (plan.voice) {
  voStem = stemPath("vo");
  renderGraph(
    [voiceAudioPath(target.scenario, target.lang, target.format)],
    `[0:a]aformat=sample_fmts=s16:sample_rates=${MIX_SAMPLE_RATE},` +
      `volume=${plan.voice.voiceover.volume.toFixed(4)},apad[out]`,
    "out",
    durationSeconds,
    voStem
  );
  const measured = medianActiveRmsDb(
    decodePcmMono(voStem, ANALYSIS_SAMPLE_RATE),
    ANALYSIS_SAMPLE_RATE,
    SPEECH_FLOOR_DB
  );
  if (measured !== null) {
    referenceDb = measured;
    referenceMode = "voiceover";

    // The cues were levelled against the number stored in the timeline. If the
    // audio no longer measures that, every gain in the video is wrong by the
    // same amount — and no amount of re-reading the cue table would show it.
    const drift = Math.abs(measured - plan.voice.voiceover.referenceDb);
    if (drift > REFERENCE_DRIFT_FAIL_DB) {
      findings.push({
        severity: "fail",
        code: "stale_reference",
        message:
          `the timeline says the narration sits at ${round(plan.voice.voiceover.referenceDb, 1)} dBFS ` +
          `but it measures ${round(measured, 1)} dBFS — every cue is levelled against the stale value`,
        fix: `Re-run: npm run voiceover -- ${target.scenario} ${target.lang} ${target.format}`
      });
    } else if (drift > REFERENCE_DRIFT_WARN_DB) {
      findings.push({
        severity: "warn",
        code: "stale_reference",
        message: `narration level has drifted ${round(drift, 1)} dB from the stored reference`,
        fix: "Harmless at this size, but re-running the voiceover would resync it."
      });
    }
  }
}

// The sound effect stem: every cue, at its own gain, delayed to its own start.
let sfxStem: string | null = null;
if (plan.cues.length > 0) {
  const inputs: string[] = [];
  const filters: string[] = [];
  plan.cues.forEach((cue, index) => {
    const entry = manifest[cue.name];
    inputs.push(sfxAbsolutePath(entry.file));
    // Quantised to a frame exactly as <Sfx> does it. Measuring the unquantised
    // ideal would make this gate agree with the cue table and disagree with the
    // render, which is the one thing it cannot afford.
    const startMs = Math.max(
      0,
      Math.round((Math.floor(((cue.atMs - entry.attackSeconds * 1000) / 1000) * FPS) / FPS) * 1000)
    );
    filters.push(cueFilter(index, cue.gain ?? 1, cue.pitch ?? 1, startMs));
  });
  sfxStem = stemPath("sfx");
  const labels = inputs.map((_, index) => `[s${index}]`).join("");
  renderGraph(
    inputs,
    `${filters.join(";")};${labels}amix=inputs=${inputs.length}:dropout_transition=0:normalize=0[out]`,
    "out",
    durationSeconds,
    sfxStem
  );
}

const stems = [voStem, sfxStem].filter((value): value is string => value !== null);
let mixPeak: number | null = null;
if (stems.length > 0) {
  const mixStem = stemPath("mix");
  renderGraph(
    stems,
    `${stems.map((_, index) => `[${index}:a]`).join("")}` +
      `amix=inputs=${stems.length}:dropout_transition=0:normalize=0[out]`,
    "out",
    durationSeconds,
    mixStem
  );
  mixPeak = round(peakDbOf(decodePcmMono(mixStem, ANALYSIS_SAMPLE_RATE)), 1);

  if (mixPeak >= CLIP_DB) {
    findings.push({
      severity: "fail",
      code: "mix_clipping",
      message: `the summed mix peaks at ${mixPeak} dBFS — it clips`,
      fix: "Spread the overlapping cues apart in the scenario, or lower the narration volume."
    });
  } else if (mixPeak > RISK_DB) {
    findings.push({
      severity: "warn",
      code: "mix_headroom",
      message: `mix peaks at ${mixPeak} dBFS, leaving nothing for the encoder`,
      fix: "Trim the loudest overlap by a decibel or two."
    });
  }
}

const cueReports: CueReport[] = plan.cues.map((cue) => {
  const entry = manifest[cue.name];
  const achievedPeakDb = entry.peakDb + toDb(cue.gain ?? 1);
  const targetPeakDb = referenceDb + (ROLE_OFFSET_DB[entry.role] ?? 6);
  const deltaDb = achievedPeakDb - targetPeakDb;
  const status: CueReport["status"] =
    deltaDb < CUE_FAIL_QUIET_DB || deltaDb > CUE_FAIL_LOUD_DB
      ? "fail"
      : Math.abs(deltaDb) > CUE_WARN_DB
        ? "warn"
        : "ok";
  return {
    name: cue.name,
    role: entry.role,
    seconds: round(cue.atMs / 1000, 2),
    gain: round(cue.gain ?? 1, 3),
    pitch: cue.pitch ?? 1,
    achievedPeakDb: round(achievedPeakDb, 1),
    targetPeakDb: round(targetPeakDb, 1),
    deltaDb: round(deltaDb, 1),
    status
  };
});

for (const cue of cueReports) {
  if (cue.status !== "fail") continue;
  const buried = cue.deltaDb < 0;
  findings.push({
    severity: "fail",
    code: buried ? "cue_buried" : "cue_too_loud",
    message:
      `${cue.name} at ${cue.seconds}s peaks at ${cue.achievedPeakDb} dBFS, ` +
      `${Math.abs(cue.deltaDb)} dB ${buried ? "under" : "over"} its ${cue.targetPeakDb} dBFS target`,
    fix:
      "Levels are computed in src/audio/cues.ts from the manifest — a miss here means the " +
      "manifest and the cue table disagree, not that this cue needs a hand-set gain."
  });
}

const verdict: "pass" | "warn" | "fail" = findings.some((f) => f.severity === "fail")
  ? "fail"
  : findings.length > 0
    ? "warn"
    : "pass";

const reportPath = preflightPath(target.scenario, target.lang, target.format);
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(
  reportPath,
  `${JSON.stringify(
    {
      contractVersion: 1,
      ...target,
      checkedAt: new Date().toISOString(),
      durationMs: Math.round(plan.durationMs),
      reference: { mode: referenceMode, referenceDb: round(referenceDb, 1) },
      mix: { peakDb: mixPeak, clipping: mixPeak !== null && mixPeak >= CLIP_DB },
      cues: cueReports,
      findings,
      verdict
    },
    null,
    2
  )}\n`
);

if (!keepStems) rmSync(stemDir, { recursive: true, force: true });

const offTarget = cueReports.filter((cue) => cue.status !== "ok");
if (offTarget.length > 0) console.table(offTarget);

console.log(
  `narration reference: ${round(referenceDb, 1)} dBFS (${referenceMode}) · ` +
    `mix peak: ${mixPeak ?? "n/a"} dBFS · ${cueReports.length} cue(s)`
);
for (const finding of findings) {
  console.log(`${finding.severity.toUpperCase()}  ${finding.message}\n      → ${finding.fix}`);
}
console.log(`\n${reportPath}\nverdict: ${verdict.toUpperCase()}`);

if (verdict === "fail") process.exit(1);
