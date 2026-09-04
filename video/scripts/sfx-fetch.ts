import {mkdir, writeFile} from "node:fs/promises";
import path from "node:path";
import "dotenv/config";
import {
  MAX_SFX_SECONDS,
  SFX_ROLES,
  emptyCurated,
  isSfxRole,
  readSources,
  sfxRoleDir,
  slugify,
  writeSources,
  type SfxRole,
  type SfxSourceEntry,
} from "./lib/sfx";

/**
 * Download CC0 sound effects from Freesound into the shared library.
 *
 * Usage:
 *   npm run sfx-fetch -- --query "whoosh short swipe" --role movement --count 4
 *   npm run sfx-fetch -- --query "ui click" --role ui --count 6 --max-duration 1.5
 *
 * The license filter is locked to CC0 so the library never needs attribution
 * bookkeeping for these entries. Sounds land in `sfx/<role>/` and get a
 * `sources.json` record with the semantic layer filled from Freesound metadata;
 * `curated.use` / `curated.avoid` are left empty on purpose — a human or the
 * `sfx-librarian` agent writes those, and `sfx-manifest` flags them until then.
 */

const SEARCH_URL = "https://freesound.org/apiv2/search/text/";
/** The license URL Freesound returns for CC0. Verified per result, not trusted from the filter. */
const CC0_LICENSE_URL = "creativecommons.org/publicdomain/zero";
const FIELDS = "id,name,tags,description,duration,license,username,url,previews,ac_analysis";
const DESCRIPTION_LIMIT = 300;

type FreesoundResult = {
  id: number;
  name: string;
  tags: string[];
  description: string;
  duration: number;
  license: string;
  username: string;
  url: string;
  previews: Record<string, string>;
  ac_analysis?: Record<string, unknown>;
};

type Args = {
  query: string;
  role: SfxRole;
  count: number;
  minDuration: number;
  maxDuration: number;
};

const parseArgs = (argv: string[]): Args => {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!key.startsWith("--")) {
      throw new Error(`Unexpected argument "${key}". Expected --key value pairs.`);
    }
    values.set(key.slice(2), argv[index + 1] ?? "");
  }

  const query = values.get("query");
  const role = values.get("role");
  if (!query || !role) {
    throw new Error(
      "Usage: npm run sfx-fetch -- --query <text> --role <" +
        SFX_ROLES.join("|") +
        "> [--count 4] [--min-duration 0.05] [--max-duration 4]",
    );
  }
  if (!isSfxRole(role)) {
    throw new Error(`Unknown role "${role}". Valid roles: ${SFX_ROLES.join(", ")}`);
  }

  const numeric = (key: string, fallback: number): number => {
    const raw = values.get(key);
    if (raw === undefined || raw === "") {
      return fallback;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`--${key} must be a positive number, got "${raw}".`);
    }
    return parsed;
  };

  const maxDuration = numeric("max-duration", 4);
  if (maxDuration > MAX_SFX_SECONDS) {
    throw new Error(`--max-duration ${maxDuration} exceeds the ${MAX_SFX_SECONDS}s library ceiling.`);
  }

  return {
    query,
    role,
    count: numeric("count", 4),
    minDuration: numeric("min-duration", 0.05),
    maxDuration,
  };
};

const args = parseArgs(process.argv.slice(2));

const apiKey = process.env.FREESOUND_API_KEY;
if (!apiKey) {
  throw new Error("FREESOUND_API_KEY is not set. Add it to .env — see https://freesound.org/apiv2/apply");
}

const searchParams = new URLSearchParams({
  query: args.query,
  filter: `license:"Creative Commons 0" duration:[${args.minDuration} TO ${args.maxDuration}]`,
  fields: FIELDS,
  sort: "rating_desc",
  page_size: String(Math.min(150, args.count * 4)),
});

const response = await fetch(`${SEARCH_URL}?${searchParams.toString()}`, {
  headers: {Authorization: `Token ${apiKey}`},
});

if (!response.ok) {
  throw new Error(
    `Freesound search failed: ${response.status} ${response.statusText} — query="${args.query}" body=${await response.text()}`,
  );
}

const payload = (await response.json()) as {results: FreesoundResult[]};
const sources = await readSources();
const existingIds = new Set(
  Object.values(sources)
    .filter((entry) => entry.origin.kind === "freesound")
    .map((entry) => entry.origin.sourceId),
);

await mkdir(sfxRoleDir(args.role), {recursive: true});

const added: string[] = [];

// Files land on disk one at a time, so sources.json must be written even when a
// later download throws — otherwise the successful ones become orphans.
const downloadCandidates = async (): Promise<void> => {
  for (const result of payload.results) {
    if (added.length >= args.count) {
      break;
    }
    if (existingIds.has(result.id)) {
      console.log(`skip  ${result.id} — already in the library`);
      continue;
    }

    // The search filter is server-side; verify per result so a filter that silently
    // stops matching cannot stamp non-CC0 audio as CC0 in the library.
    if (!result.license.includes(CC0_LICENSE_URL)) {
      console.log(`skip  ${result.id} — license is "${result.license}", not CC0`);
      continue;
    }

    const previewUrl = result.previews["preview-hq-mp3"];
    if (!previewUrl) {
      console.log(`skip  ${result.id} — no preview-hq-mp3 available`);
      continue;
    }

    const key = `${args.role}_${slugify(result.name)}_${result.id}`;
    const relativeFile = `sfx/${args.role}/${key}.mp3`;
    const absoluteFile = path.join(sfxRoleDir(args.role), `${key}.mp3`);

    const download = await fetch(previewUrl, {headers: {Authorization: `Token ${apiKey}`}});
    if (!download.ok) {
      throw new Error(
        `Preview download failed for ${result.id}: ${download.status} ${download.statusText} — ${previewUrl}`,
      );
    }
    const bytes = Buffer.from(await download.arrayBuffer());
    if (bytes.length < 1024) {
      throw new Error(`Preview for ${result.id} is only ${bytes.length} bytes — refusing a truncated download.`);
    }
    await writeFile(absoluteFile, bytes);

    const entry: SfxSourceEntry = {
      file: relativeFile,
      role: args.role,
      roleSource: "freesound_query",
      origin: {
        kind: "freesound",
        sourceId: result.id,
        sourceUrl: result.url,
        author: result.username,
        license: "CC0",
        attribution: null,
        addedAt: new Date().toISOString().slice(0, 10),
      },
      semantics: {
        provider: "freesound",
        tags: result.tags.slice(0, 8),
        description: result.description.replace(/\s+/g, " ").trim().slice(0, DESCRIPTION_LIMIT),
        confidence: null,
        raw: {
          freesoundName: result.name,
          freesoundTags: result.tags,
          freesoundQuery: args.query,
          durationSeconds: result.duration,
          acAnalysis: result.ac_analysis ?? null,
        },
      },
      curated: emptyCurated(),
      needsReview: false,
    };

    sources[key] = entry;
    added.push(key);
    console.log(`added ${key}  (${result.duration.toFixed(2)}s, by ${result.username})`);
  }
};

try {
  await downloadCandidates();
} finally {
  await writeSources(sources);
}

console.log(
  `\n${added.length}/${args.count} sounds added for role "${args.role}".\n` +
    "Next: write curated.use / curated.avoid in sfx/sources.json, then run `npm run sfx-manifest`.",
);

if (added.length < args.count) {
  console.log("Fewer results than requested — widen --max-duration or try a different --query.");
}
