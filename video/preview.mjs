// Screenshots a stage with seeded notes — the quick visual check while building
// stages, without booting Remotion. Renders exactly what a composition's iframe
// will show at frame 0.
//
//   node preview.mjs                 # article, en
//   node preview.mjs article ar tr   # one PNG per language
//
// Output: preview/<stage>.<lang>.png
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { LANGS } from "../store-assets/gen/i18n.mjs";
import { findChrome } from "./chrome-path.mjs";
import { demoNotes, NOW, STAGE_HEIGHT, STAGE_WIDTH, stageUrl } from "./stage-url.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "public");
const OUT = join(HERE, "preview");
const PORT = 8126;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".map": "application/json"
};

const [stage = "article", ...codes] = process.argv.slice(2);
const languages = codes.length > 0 ? codes : ["en"];
for (const code of languages) {
  if (!(code in LANGS)) throw new Error(`unknown language: ${code}`);
}

mkdirSync(OUT, { recursive: true });

const server = createServer((req, res) => {
  const path = new URL(req.url, `http://localhost:${PORT}`).pathname;
  const file = join(PUBLIC, path);
  if (!existsSync(file) || !file.startsWith(PUBLIC)) {
    res.writeHead(404).end("not found");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(PORT, r));

const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true });

for (const lang of languages) {
  const page = await browser.newPage();
  await page.setViewport({ width: STAGE_WIDTH, height: STAGE_HEIGHT, deviceScaleFactor: 2 });
  await page.goto(stageUrl(`http://localhost:${PORT}`, stage, lang, "preview"), {
    waitUntil: "networkidle0"
  });
  await page.waitForFunction(() => document.getElementById("anchored-notes-host")?.shadowRoot != null);

  // Note geometry is computed here, in Node; the frame only receives data.
  const { pageKey, origin } = await page.evaluate(() => ({
    pageKey: location.origin + location.pathname + location.search,
    origin: location.origin
  }));
  const notes = demoNotes(LANGS[lang].notes, LANGS[lang].dir === "rtl", pageKey, origin, NOW);
  await page.evaluate((seeded) => chrome.storage.local.set({ notes: seeded }), notes);
  await page.waitForFunction(
    () => document.getElementById("anchored-notes-host").shadowRoot.querySelectorAll(".note").length === 3
  );
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 600)); // milkdown finishes its first paint

  await page.screenshot({ path: join(OUT, `${stage}.${lang}.png`) });
  await page.close();
  console.log(`preview/${stage}.${lang}.png`);
}

await browser.close();
server.close();
