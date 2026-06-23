// Bundles extension entry points and copies static assets into dist/.
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const OUT = "dist";

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

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
  loader: { ".css": "text" },
  logLevel: "info"
});

cpSync("manifest.json", `${OUT}/manifest.json`);
cpSync("src/options/options.html", `${OUT}/options.html`);
cpSync("src/popup/popup.html", `${OUT}/popup.html`);
cpSync("icons", `${OUT}/icons`, { recursive: true });
cpSync("_locales", `${OUT}/_locales`, { recursive: true });

console.log(`Built into ${OUT}/`);
