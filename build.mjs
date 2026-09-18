// Bundles extension entry points and copies static assets into dist/.
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const OUT = "dist";

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const sourcemap = !process.argv.includes("--no-sourcemap");

await build({
  entryPoints: {
    background: "src/background.ts",
    content: "src/content/index.ts",
    options: "src/options/options.ts",
    popup: "src/popup/popup.ts"
  },
  bundle: true,
  format: "iife",
  target: "chrome110",
  outdir: OUT,
  minify: true,
  // Local/dev builds get maps; store packages pass --no-sourcemap (see package.mjs).
  sourcemap,
  loader: { ".css": "text" },
  logLevel: "info"
});

// Milkdown editor is a separate ESM chunk loaded on first card mount so
// content.js stays small at document_start.
await build({
  entryPoints: { editor: "src/content/editor.ts" },
  bundle: true,
  format: "esm",
  target: "chrome110",
  outfile: `${OUT}/editor.js`,
  minify: true,
  sourcemap,
  logLevel: "info"
});

cpSync("manifest.json", `${OUT}/manifest.json`);
cpSync("src/options/options.html", `${OUT}/options.html`);
cpSync("src/popup/popup.html", `${OUT}/popup.html`);
cpSync("icons", `${OUT}/icons`, { recursive: true });
cpSync("_locales", `${OUT}/_locales`, { recursive: true });

console.log(`Built into ${OUT}/`);
