// Captures raw product screenshots of the extension running in Chrome for
// Testing. Seeds demo notes straight into chrome.storage.local, then shoots
// the demo page. Prerequisite: `npm run build` at the repo root (needs dist/).
// Output: raw/hero.png, raw/note-closeup.png (both @2x for crisp downscaling).
import puppeteer from "puppeteer-core";
import { createServer } from "node:http";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findChrome } from "./chrome.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, "../../dist");
const EXT_ID = "dnmmgfkolmlieeempmfjghddbcehijgc"; // pinned by manifest.json "key"
const PORT = 8123;
const OUT = join(HERE, "raw");
mkdirSync(OUT, { recursive: true });

const PAGE_URL = `http://localhost:${PORT}/journal/kyoto`;
const ORIGIN = `http://localhost:${PORT}`;

const now = Date.now();
const note = (id, scope, anchorKey, color, x, y, w, h, content) => ({
  id, content, color, scope, anchorKey, x, y, w, h,
  createdAt: now - 86_400_000, updatedAt: now - 3_600_000,
});

const notes = {
  n1: note("n1", "page", PAGE_URL, "yellow", 872, 120, 316, 208,
    "## Kyoto — day 3\n\n- [x] Fushimi Inari at dawn\n- [ ] Nishiki Market lunch\n- [ ] Book the tea ceremony\n- [ ] Gion at dusk 🏮"),
  n2: note("n2", "site", ORIGIN, "pink", 948, 440, 264, 172,
    "**Gift ideas** 🎁\n\nMatcha set for Anna, *furoshiki* wraps from the shop by the station"),
  n3: note("n3", "global", "", "blue", 600, 490, 292, 208,
    "### Budget\n\n| Day | Spent |\n| --- | --- |\n| Mon | ¥8,400 |\n| Tue | ¥12,150 |"),
};

const server = createServer((req, res) => {
  if (req.url === "/manifest.json") {
    // PWA manifest so the note header's site scope shows a name, not "localhost".
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ name: "The Slow Route", short_name: "Slow Route" }));
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(readFileSync(join(HERE, "demo/kyoto.html")));
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

// Seed storage from an extension page (has chrome.storage access).
const seed = await browser.newPage();
await seed.goto(`chrome-extension://${EXT_ID}/options.html`, { waitUntil: "domcontentloaded" });
await seed.evaluate(async (map) => {
  await chrome.storage.local.set({ notes: map, lang: "en" });
}, notes);
await seed.close();

// Hero shot: demo page with the three notes rendered by the content script.
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });
await page.goto(PAGE_URL, { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 1800)); // milkdown init + fonts
await page.screenshot({ path: join(OUT, "hero.png") });

// Close-up of the yellow markdown note (padded clip, still dsf2).
await page.screenshot({
  path: join(OUT, "note-closeup.png"),
  clip: { x: 848, y: 96, width: 364, height: 260 },
});
await page.close();

await browser.close();
server.close();
console.log("raw screenshots written to", OUT);
