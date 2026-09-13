// Derive the YouTube sidecar from scenario + shared copy. Same shape RemotionLab
// uses (title, description, tags) — no extra keys, so upload validation stays
// unchanged. Format lives in the filename, not in the YouTube fields: both cuts
// of a scenario argue the same thing.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getScenario, SCENARIOS } from "../../scenarios/index";
import { copyFor } from "../../copy/index";
import type { FormatName } from "../../src/types";
import { parseJobId, slashJobId, type UploadTarget } from "./job-id";
import { parseUploadMetadata, type UploadMetadata } from "./upload-metadata";
import { uploadMetadataPath, videoPath } from "./paths";
import { CHANNEL_SLUG } from "./drive";

export const STORE_LISTING_URL =
  "https://chromewebstore.google.com/detail/dnmmgfkolmlieeempmfjghddbcehijgc";

export const PREPARE_UPLOAD_USAGE =
  "Usage: npm run prepare-upload -- [jobId]\n" +
  "  no jobId: every rendered out/<scenario>/<lang>/<format>.mp4\n" +
  "  jobId:    <scenario>/<lang>/<format>  or  <scenario>-<lang>-<format>";

const FORMATS: FormatName[] = ["16-9", "9-16"];

const TAGS: Record<string, string[]> = {
  en: ["chrome extension", "sticky notes", "productivity", "anchored notes"],
  tr: ["chrome eklentisi", "yapışkan notlar", "verimlilik", "anchored notes"]
};

export function youtubeTitle(hookText: string, lang: string): string {
  const locale = lang.startsWith("tr") ? "tr" : "en";
  return hookText
    .trim()
    .split(/\s+/)
    .map((word) => {
      const lower = word.toLocaleLowerCase(locale);
      if (!lower) return word;
      const chars = [...lower];
      chars[0] = chars[0].toLocaleUpperCase(locale);
      return chars.join("");
    })
    .join(" ");
}

export function tagsFor(lang: string): string[] {
  const tags = TAGS[lang] ?? TAGS.en;
  return [...tags];
}

export function buildUploadMetadata(target: UploadTarget): UploadMetadata {
  const scenario = getScenario(target.scenario);
  const hook = scenario.hook(target.lang);
  const shared = copyFor(target.lang);
  return parseUploadMetadata({
    title: youtubeTitle(hook.onScreenText, target.lang),
    description: [hook.gap, "", shared.outroTagline, "", `${shared.outroCta}: ${STORE_LISTING_URL}`].join(
      "\n"
    ),
    tags: tagsFor(target.lang)
  });
}

export function writeUploadMetadata(
  target: UploadTarget,
  file = uploadMetadataPath(target.scenario, target.lang, target.format)
): { file: string; metadata: UploadMetadata } {
  const metadata = buildUploadMetadata(target);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(metadata, null, 2)}\n`);
  return { file, metadata };
}

export function renderedTargets(): UploadTarget[] {
  const targets: UploadTarget[] = [];
  for (const scenario of SCENARIOS) {
    for (const lang of scenario.langs) {
      for (const format of FORMATS) {
        if (existsSync(videoPath(scenario.id, lang, format))) {
          targets.push({ scenario: scenario.id, lang, format });
        }
      }
    }
  }
  return targets;
}

/** `null` means every rendered cut. The old two-arg upload form is rejected. */
export function parsePrepareUploadArgs(argv: string[]): string | null {
  if (argv.length === 2) {
    throw new Error(
      `channelSlug is no longer an argument; channel is always "${CHANNEL_SLUG}".\n${PREPARE_UPLOAD_USAGE}`
    );
  }
  if (argv.length > 1) {
    throw new Error(PREPARE_UPLOAD_USAGE);
  }
  const jobId = argv[0]?.trim();
  if (argv.length === 1 && !jobId) {
    throw new Error(PREPARE_UPLOAD_USAGE);
  }
  return jobId ?? null;
}

export function resolvePrepareTargets(argv: string[]): UploadTarget[] {
  const jobId = parsePrepareUploadArgs(argv);
  if (jobId) return [parseJobId(jobId)];
  const targets = renderedTargets();
  if (targets.length === 0) {
    throw new Error("no rendered mp4 under out/; render or pass a jobId");
  }
  return targets;
}

export function prepareUpload(targets: UploadTarget[]): {
  jobId: string;
  file: string;
  title: string;
}[] {
  return targets.map((target) => {
    const { file, metadata } = writeUploadMetadata(target);
    return { jobId: slashJobId(target), file, title: metadata.title };
  });
}
