// Renders the YouTube channel branding to PNG at the exact sizes YouTube
// accepts, straight into youtube-assets/. Sibling of store-assets/gen, which
// does the same for the Chrome Web Store stills.
import puppeteer from "puppeteer-core";
import { mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome } from "./chrome.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(HERE, "templates");
const ASSETS = resolve(HERE, "..");

// `maxBytes` is YouTube's upload limit for that slot; exceeding it is an error
// rather than a warning, because the file would simply be rejected.
const SHOTS = [
  { name: "banner", width: 2560, height: 1440, dest: "banner-2560x1440.png", transparent: false, maxBytes: 6 * 1024 * 1024 },
  { name: "profile", width: 800, height: 800, dest: "profile-800x800.png", transparent: false, maxBytes: 4 * 1024 * 1024 },
  { name: "watermark", width: 150, height: 150, dest: "watermark-150x150.png", transparent: true, maxBytes: 1024 * 1024 }
];

mkdirSync(ASSETS, { recursive: true });

const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true });
const page = await browser.newPage();

for (const { name, width, height, dest, transparent, maxBytes } of SHOTS) {
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.goto(`file://${join(TEMPLATES, `${name}.html`)}`, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);
  const out = join(ASSETS, dest);
  await page.screenshot({ path: out, omitBackground: transparent });
  const { size } = statSync(out);
  if (size > maxBytes) {
    throw new Error(`${dest} is ${size} bytes, over YouTube's ${maxBytes}-byte limit for this slot`);
  }
  console.log(`${dest} — ${width}×${height}, ${(size / 1024).toFixed(1)} KB`);
}

await browser.close();
