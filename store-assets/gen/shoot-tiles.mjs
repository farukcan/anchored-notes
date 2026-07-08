// Renders the marketing tiles to PNG at the exact CWS sizes for every
// supported language and copies the final assets into store-assets/:
// English at the top level, other languages under store-assets/<lang>/.
// Run capture.mjs first (tiles embed the raw/<lang>/ screenshots).
import puppeteer from "puppeteer-core";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome } from "./chrome.mjs";
import { LANGS, templateVars, renderTemplate } from "./i18n.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const ASSETS = resolve(HERE, "..");
// Rendered into tiles/ so the templates' relative img paths keep working.
const RENDER_FILE = join(HERE, "tiles", ".render.html");
mkdirSync(OUT, { recursive: true });

const TILES = [
  { name: "tile1", width: 1280, height: 800, dest: "screenshot-1.png" },
  { name: "tile2", width: 1280, height: 800, dest: "screenshot-2.png" },
  { name: "tile3", width: 1280, height: 800, dest: "screenshot-3.png" },
  { name: "promo", width: 440, height: 280, dest: "promo-small-440x280.png" },
  { name: "marquee", width: 1400, height: 560, dest: "promo-marquee-1400x560.png" },
];

const codes = process.argv.slice(2).length > 0 ? process.argv.slice(2) : Object.keys(LANGS);
for (const code of codes) {
  if (!(code in LANGS)) throw new Error(`unknown language: ${code}`);
}

const templates = Object.fromEntries(
  TILES.map(({ name }) => [name, readFileSync(join(HERE, "tiles", `${name}.html`), "utf8")])
);

const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true });
const page = await browser.newPage();

for (const code of codes) {
  const vars = templateVars(code);
  const destDir = code === "en" ? ASSETS : join(ASSETS, code);
  mkdirSync(destDir, { recursive: true });
  const outDir = join(OUT, code);
  mkdirSync(outDir, { recursive: true });

  for (const { name, width, height, dest } of TILES) {
    writeFileSync(RENDER_FILE, renderTemplate(templates[name], vars));
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(`file://${RENDER_FILE}`, { waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);
    await new Promise((r) => setTimeout(r, 400));
    await page.screenshot({ path: join(outDir, `${name}.png`) });
    copyFileSync(join(outDir, `${name}.png`), join(destDir, dest));
  }
  console.log(`${code} → ${code === "en" ? "store-assets/" : `store-assets/${code}/`}`);
}

await browser.close();
rmSync(RENDER_FILE, { force: true });
