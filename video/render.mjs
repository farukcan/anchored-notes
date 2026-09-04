// Renders scenarios to MP4.
//
//   node render.mjs                        # everything registered in src/Root.tsx
//   node render.mjs kyoto-basics           # one scenario, every language and format
//   node render.mjs kyoto-basics tr        # one scenario, one language
//   node render.mjs kyoto-basics tr 9-16   # one video
//
// Output: out/<scenario>/<lang>/<format>.mp4
//
// The composition list comes from Remotion itself rather than from importing
// scenarios/ here: the scenario modules are written for Remotion's bundler
// (extensionless imports), which Node's ESM resolver will not follow.
//
// Prerequisite: node build-shell.mjs (which needs dist/ from the repo root).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(HERE, "src/index.ts");

if (!existsSync(join(HERE, "public/shell.js"))) {
  throw new Error("public/ is not built — run `node build-shell.mjs` first");
}

/** Composition ids are `<scenario>-<lang>-<format>`; lang and format never contain a dash except the format's own. */
function parseId(id) {
  const match = /^(.+)-([a-z]{2}(?:_[A-Z]{2})?)-(.+)$/.exec(id);
  if (!match) throw new Error(`composition id "${id}" does not match <scenario>-<lang>-<format>`);
  return { scenario: match[1], lang: match[2], format: match[3] };
}

function listCompositions() {
  const output = execFileSync("npx", ["remotion", "compositions", ENTRY], {
    cwd: HERE,
    encoding: "utf8"
  });
  return output
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((id) => /^[a-z0-9-]+-[a-z]{2}(_[A-Z]{2})?-/.test(id));
}

const [scenarioFilter, langFilter, formatFilter] = process.argv.slice(2);

const targets = listCompositions()
  .map((id) => ({ id, ...parseId(id) }))
  .filter((t) => (scenarioFilter ? t.scenario === scenarioFilter : true))
  .filter((t) => (langFilter ? t.lang === langFilter : true))
  .filter((t) => (formatFilter ? t.format === formatFilter : true));

if (targets.length === 0) {
  throw new Error(
    `nothing to render for scenario=${scenarioFilter ?? "*"} lang=${langFilter ?? "*"} ` +
      `format=${formatFilter ?? "*"} — check scenarios/index.ts`
  );
}

for (const target of targets) {
  const outDir = join(HERE, "out", target.scenario, target.lang);
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `${target.format}.mp4`);

  console.log(`\n→ ${target.id}`);
  execFileSync("npx", ["remotion", "render", ENTRY, target.id, outFile], {
    cwd: HERE,
    stdio: "inherit"
  });
}

console.log(`\nRendered ${targets.length} video(s) into out/`);
