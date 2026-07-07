// Renders the marketing tiles to PNG at the exact CWS sizes and copies the
// final assets up into store-assets/. Run capture.mjs first (tiles embed the
// raw/ screenshots).
import puppeteer from "puppeteer-core";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome } from "./chrome.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const ASSETS = resolve(HERE, "..");
mkdirSync(OUT, { recursive: true });

const TILES = [
  { name: "tile1", width: 1280, height: 800, dest: "screenshot-1.png" },
  { name: "tile2", width: 1280, height: 800, dest: "screenshot-2.png" },
  { name: "tile3", width: 1280, height: 800, dest: "screenshot-3.png" },
  { name: "promo", width: 440, height: 280, dest: "promo-small-440x280.png" },
  { name: "marquee", width: 1400, height: 560, dest: "promo-marquee-1400x560.png" },
];

const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true });
const page = await browser.newPage();

for (const { name, width, height, dest } of TILES) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.goto(`file://${join(HERE, "tiles", `${name}.html`)}`, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  copyFileSync(join(OUT, `${name}.png`), join(ASSETS, dest));
  console.log(`${name}.png → store-assets/${dest}`);
}

await browser.close();
