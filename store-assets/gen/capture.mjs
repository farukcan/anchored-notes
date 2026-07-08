// Captures raw product screenshots of the extension running in Chrome for
// Testing, once per supported language: the demo page is served localized,
// the seeded notes and the extension UI language match it. Prerequisite:
// `npm run build` at the repo root (needs dist/).
// Output: raw/<lang>/hero.png (@2x; tile2 crops its note close-up from it).
import puppeteer from "puppeteer-core";
import { createServer } from "node:http";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome } from "./chrome.mjs";
import { LANGS, templateVars, renderTemplate } from "./i18n.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, "../../dist");
const EXT_ID = "dnmmgfkolmlieeempmfjghddbcehijgc"; // pinned by manifest.json "key"
const PORT = 8123;

const PAGE_URL = `http://localhost:${PORT}/journal/kyoto`;
const ORIGIN = `http://localhost:${PORT}`;
const DEMO_TEMPLATE = readFileSync(join(HERE, "demo/kyoto.html"), "utf8");

// Only shoot the given languages when passed as CLI args (e.g. `node
// capture.mjs tr ja`); default is all of them.
const codes = process.argv.slice(2).length > 0 ? process.argv.slice(2) : Object.keys(LANGS);
for (const code of codes) {
  if (!(code in LANGS)) throw new Error(`unknown language: ${code}`);
}

const now = Date.now();
const note = (id, scope, anchorKey, color, x, y, w, h, content) => ({
  id, content, color, scope, anchorKey, x, y, w, h,
  createdAt: now - 86_400_000, updatedAt: now - 3_600_000,
});

// Note geometry is shared across languages; only the content is localized.
// On RTL pages the article text sits on the right, so the note positions are
// mirrored to the left (x' = 1280 - x - w) — the tiles mirror their crop too.
const notesFor = (code) => {
  const { n1, n2, n3 } = LANGS[code].notes;
  const rtl = LANGS[code].dir === "rtl";
  const X = (x, w) => (rtl ? 1280 - x - w : x);
  return {
    n1: note("n1", "page", PAGE_URL, "yellow", X(872, 316), 120, 316, 208, n1),
    n2: note("n2", "site", ORIGIN, "pink", X(948, 264), 440, 264, 172, n2),
    n3: note("n3", "global", "", "blue", X(600, 292), 490, 292, 208, n3),
  };
};

let currentLang = codes[0];
const server = createServer((req, res) => {
  if (req.url === "/manifest.json") {
    // PWA manifest so the note header's site scope shows a name, not "localhost".
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ name: "The Slow Route", short_name: "Slow Route" }));
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(renderTemplate(DEMO_TEMPLATE, templateVars(currentLang)));
});
await new Promise((r) => server.listen(PORT, r));

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: [
    `--disable-extensions-except=${DIST}`,
    `--load-extension=${DIST}`,
    "--window-size=1300,900",
    "--hide-scrollbars",
    "--no-first-run",
  ],
});

for (const code of codes) {
  currentLang = code;
  const out = join(HERE, "raw", code);
  mkdirSync(out, { recursive: true });

  // Seed storage from an extension page (has chrome.storage access); the
  // seeded `lang` switches the extension UI to match the demo page.
  const seed = await browser.newPage();
  await seed.goto(`chrome-extension://${EXT_ID}/options.html`, { waitUntil: "domcontentloaded" });
  await seed.evaluate(async (map, ext) => {
    await chrome.storage.local.set({ notes: map, lang: ext });
  }, notesFor(code), LANGS[code].ext);
  await seed.close();

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
  await page.goto(PAGE_URL, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 1800)); // milkdown init + fonts
  await page.screenshot({ path: join(out, "hero.png") });
  await page.close();
  console.log(`raw/${code} done`);
}

await browser.close();
server.close();
