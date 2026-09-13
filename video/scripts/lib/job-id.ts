// One marketing video, named the same way the composition and the out/ tree
// name it. RemotionLab uses a opaque job id; here the id is the path.
//
// Accepted spellings:
//   kyoto-basics/en/16-9     ← out/<scenario>/<lang>/<format>.mp4
//   kyoto-basics-en-16-9     ← Remotion composition id
//
// Drive folder names cannot contain slashes, so the Drive leaf is the
// composition id. The slash form is the CLI contract.

import { getScenario } from "../../scenarios/index";
import type { FormatName } from "../../src/types";

export interface UploadTarget {
  scenario: string;
  lang: string;
  format: FormatName;
}

const LANG = "([a-z]{2}(?:_[A-Z]{2})?)";
const FORMAT = "(16-9|9-16)";
const SLASH = new RegExp(`^(.+)/${LANG}/${FORMAT}$`);
const DASH = new RegExp(`^(.+)-${LANG}-${FORMAT}$`);

export function compositionId(target: UploadTarget): string {
  return `${target.scenario}-${target.lang}-${target.format}`;
}

export function slashJobId(target: UploadTarget): string {
  return `${target.scenario}/${target.lang}/${target.format}`;
}

export function parseJobId(jobId: string): UploadTarget {
  const trimmed = jobId.trim();
  const slash = SLASH.exec(trimmed);
  const dash = slash ? null : DASH.exec(trimmed);
  const match = slash ?? dash;
  if (!match) {
    throw new Error(
      `jobId "${jobId}" is not <scenario>/<lang>/<format> or <scenario>-<lang>-<format>`
    );
  }

  const scenario = match[1];
  const lang = match[2];
  const format = match[3] as FormatName;
  const entry = getScenario(scenario);
  if (!entry.langs.includes(lang)) {
    throw new Error(`scenario "${scenario}" has no copy for "${lang}" — known: ${entry.langs.join(", ")}`);
  }

  return { scenario, lang, format };
}

export function parseChannelSlug(slug: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(`channel slug "${slug}" must be kebab-case (a-z, 0-9, hyphen)`);
  }
  return slug;
}
