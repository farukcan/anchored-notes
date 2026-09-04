import {access, readdir, writeFile} from "node:fs/promises";
import {
  MAX_SFX_SECONDS,
  SFX_ROLES,
  measureAudio,
  readSources,
  sfxAbsolutePath,
  sfxAttributionsPath,
  sfxManifestPath,
  sfxRoleDir,
  type SfxManifest,
  type SfxManifestEntry,
} from "./lib/sfx";

/**
 * Build `sfx/manifest.json` from `sources.json` + ffmpeg measurements.
 *
 * The manifest is the single source of truth every consumer reads: the `<Sfx>`
 * component, the `SfxName` type, `sfx-check`, and the `sfx-designer` agent. It
 * flattens away the difference between the two feeding paths (Freesound
 * metadata vs. CLAP-generated tags) so selection code never branches on
 * provenance.
 *
 * Usage: npm run sfx-manifest
 */

const NON_COMMERCIAL = /\bnc\b|noncommercial|non-commercial/i;
const REQUIRES_ATTRIBUTION = /\bby\b/i;

const sources = await readSources();
const keys = Object.keys(sources).sort();

if (keys.length === 0) {
  throw new Error(
    "sfx/sources.json is empty. Run `npm run sfx-fetch -- --query \"ui click\" --role ui` to add sounds.",
  );
}

const manifest: SfxManifest = {};
const needsCuration: string[] = [];
const needsReview: string[] = [];

for (const key of keys) {
  const entry = sources[key];
  const absolute = sfxAbsolutePath(entry.file);

  await access(absolute).catch(() => {
    throw new Error(`sources.json lists "${key}" but public/${entry.file} does not exist on disk.`);
  });

  if (NON_COMMERCIAL.test(entry.origin.license)) {
    throw new Error(
      `"${key}" is licensed "${entry.origin.license}". Non-commercial sounds must never enter the library — remove the entry and the file.`,
    );
  }
  if (REQUIRES_ATTRIBUTION.test(entry.origin.license) && !entry.origin.attribution) {
    throw new Error(
      `"${key}" is licensed "${entry.origin.license}" but origin.attribution is empty. Fill it as "Author — Sound Name (CC BY 4.0)".`,
    );
  }

  const measurement = measureAudio(absolute);
  if (measurement.durationSeconds > MAX_SFX_SECONDS) {
    throw new Error(
      `"${key}" is ${measurement.durationSeconds}s long — over the ${MAX_SFX_SECONDS}s ceiling. That is music or ambience, not a sound effect.`,
    );
  }

  const curationMissing = entry.curated.use.trim() === "" || entry.curated.avoid.trim() === "";
  if (curationMissing) {
    needsCuration.push(key);
  }
  if (entry.needsReview) {
    needsReview.push(key);
  }

  const manifestEntry: SfxManifestEntry = {
    file: entry.file,
    role: entry.role,
    tags: entry.curated.tags.length > 0 ? entry.curated.tags : entry.semantics.tags,
    description: entry.semantics.description,
    use: entry.curated.use,
    avoid: entry.curated.avoid,
    pairsWith: entry.curated.pairsWith,
    ...measurement,
    license: entry.origin.license,
    attribution: entry.origin.attribution,
    sourceUrl: entry.origin.sourceUrl,
    provider: entry.semantics.provider,
    confidence: entry.semantics.confidence,
    needsReview: entry.needsReview,
    needsCuration: curationMissing,
  };

  manifest[key] = manifestEntry;
}

await writeFile(sfxManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const attributed = keys.filter((key) => sources[key].origin.attribution);
const licenseCounts = new Map<string, number>();
for (const key of keys) {
  const license = sources[key].origin.license;
  licenseCounts.set(license, (licenseCounts.get(license) ?? 0) + 1);
}

const lines = ["# Sound Effect Attributions", ""];
if (attributed.length > 0) {
  lines.push("These sounds require attribution in the video description:", "");
  for (const key of attributed) {
    const entry = sources[key];
    lines.push(`- **${key}** — ${entry.origin.attribution} — [source](${entry.origin.sourceUrl ?? "n/a"})`);
  }
} else {
  lines.push("Every sound in the library is CC0 or otherwise attribution-free.");
}
lines.push("", "## License distribution", "");
for (const [license, count] of [...licenseCounts.entries()].sort((a, b) => b[1] - a[1])) {
  lines.push(`- ${license}: ${count}`);
}
await writeFile(sfxAttributionsPath, `${lines.join("\n")}\n`, "utf8");

const orphans: string[] = [];
const registeredFiles = new Set(keys.map((key) => sources[key].file));
for (const role of SFX_ROLES) {
  const files = await readdir(sfxRoleDir(role)).catch(() => [] as string[]);
  for (const file of files) {
    const relative = `sfx/${role}/${file}`;
    if (!registeredFiles.has(relative)) {
      orphans.push(relative);
    }
  }
}

const roleCounts = new Map<string, number>();
for (const key of keys) {
  roleCounts.set(sources[key].role, (roleCounts.get(sources[key].role) ?? 0) + 1);
}

console.log(`manifest: ${keys.length} sounds → sfx/manifest.json`);
console.log(
  `roles: ${SFX_ROLES.map((role) => `${role}=${roleCounts.get(role) ?? 0}`).join("  ")}`,
);
if (needsCuration.length > 0) {
  console.log(
    `\nneedsCuration (${needsCuration.length}) — unusable until curated.use/avoid are written:\n  ${needsCuration.join("\n  ")}`,
  );
}
if (needsReview.length > 0) {
  console.log(
    `\nneedsReview (${needsReview.length}) — low-confidence CLAP tagging, confirm the role by ear:\n  ${needsReview.join("\n  ")}`,
  );
}
if (orphans.length > 0) {
  console.log(
    `\nUnregistered files (${orphans.length}) — add them to sfx/sources.json or delete them:\n  ${orphans.join("\n  ")}`,
  );
}
