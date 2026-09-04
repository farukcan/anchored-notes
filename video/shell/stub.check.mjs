// Proves the chrome stub is good enough to run the shipped content script.
//
// This is the load-bearing test of the whole video pipeline: if the extension's
// chrome.* surface grows past what shell/chrome-stub.ts implements, nothing else
// fails loudly — videos would just silently render an empty page. Run it after
// touching src/content/, src/storage.ts or src/i18n.ts.
//
// Prerequisite: node build-shell.mjs (which needs dist/ from the repo root).
import { strict as assert } from "node:assert";
import { test, before, after } from "node:test";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { findChrome } from "../chrome-path.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(HERE, "../public");
const ROOT = resolve(HERE, "../..");
const PORT = 8124;

const NOW = Date.UTC(2026, 0, 15, 9, 0, 0);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".png": "image/png" };


let server;
let browser;
let page;
/** Console errors and refused requests seen on the page; both must stay empty. */
const problems = [];

const fixtureUrl = () => {
  const params = new URLSearchParams({
    session: "test",
    role: "content",
    lang: "en",
    tabId: "1",
    now: String(NOW),
    seed: "1",
    assetBase: "/",
    version: "9.9.9",
    siteName: "Fixture Site"
  });
  // Hash, not query — see shell/entry.ts: query params would end up inside a
  // page-scoped note's anchorKey.
  return `http://localhost:${PORT}/fixture.html#${params}`;
};

before(async () => {
  if (!existsSync(join(PUBLIC, "shell.js"))) {
    throw new Error("public/shell.js missing — run `node build-shell.mjs` first");
  }

  server = createServer((req, res) => {
    const path = new URL(req.url, `http://localhost:${PORT}`).pathname;
    const file = join(PUBLIC, path === "/" ? "/fixture.html" : path);
    if (!existsSync(file)) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(PORT, r));

  browser = await puppeteer.launch({ executablePath: findChrome(), headless: true });
  page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on("console", (msg) => {
    if (msg.type() === "error") problems.push(`console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
  page.on("requestfailed", (req) => problems.push(`requestfailed: ${req.url()}`));

  await page.goto(fixtureUrl(), { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.getElementById("anchored-notes-host")?.shadowRoot != null);
});

after(async () => {
  await browser?.close();
  server?.close();
});

test("content script mounts its shadow host", async () => {
  const mounted = await page.evaluate(
    () => document.getElementById("anchored-notes-host")?.shadowRoot?.querySelector("style") != null
  );
  assert.equal(mounted, true, "shadow host should carry the injected stylesheet");
});

test("a note written to storage renders as a card", async () => {
  await page.evaluate((now) => {
    const notes = {
      seeded: {
        id: "seeded",
        content: "## Kyoto — day 3\n\n- [x] Fushimi Inari at dawn",
        color: "yellow",
        scope: "page",
        anchorKey: `${location.origin}${location.pathname}${location.search}`,
        x: 820,
        y: 120,
        w: 316,
        h: 208,
        createdAt: now - 86400000,
        updatedAt: now - 3600000
      }
    };
    return chrome.storage.local.set({ notes });
  }, NOW);

  await page.waitForFunction(
    () => document.getElementById("anchored-notes-host").shadowRoot.querySelector(".note") != null
  );

  const card = await page.evaluate(() => {
    const el = document.getElementById("anchored-notes-host").shadowRoot.querySelector(".note");
    return { className: el.className, left: el.style.left, text: el.textContent };
  });
  assert.match(card.className, /color-yellow/);
  assert.equal(card.left, "820px");
  assert.match(card.text, /Fushimi Inari/, "milkdown should have rendered the markdown");
});

test("the note header resolves the site name through the stubbed manifest fetch", async () => {
  const anchor = await page.evaluate(
    () => document.getElementById("anchored-notes-host").shadowRoot.querySelector(".note-anchor")?.textContent
  );
  assert.ok(anchor != null && anchor.length > 0, "note should show an anchor label");
});

test("CREATE_NOTE goes through the real content-script path", async () => {
  const before = await page.evaluate(() => Object.keys(window.__anStub.state.local.notes).length);

  await page.evaluate(() =>
    window.__anStub.send({ type: "CREATE_NOTE", content: "from the popup", source: "popup" })
  );
  await page.waitForFunction(
    (n) => Object.keys(window.__anStub.state.local.notes).length > n,
    {},
    before
  );

  const created = await page.evaluate(() => {
    const notes = Object.values(window.__anStub.state.local.notes);
    return notes.find((n) => n.content === "from the popup");
  });
  assert.ok(created, "CREATE_NOTE should have produced a note");
  assert.match(created.id, /^00000000-0000-4000-8000-/, "ids must come from the deterministic uuid stub");
});

test("clock, randomness and ids are pinned", async () => {
  const pinned = await page.evaluate(() => ({
    now: Date.now(),
    firstRandom: Math.random(),
    uuid: crypto.randomUUID()
  }));
  assert.equal(pinned.now, NOW, "Date.now must be frozen for stable relative timestamps");
  assert.ok(pinned.firstRandom >= 0 && pinned.firstRandom < 1);
  assert.match(pinned.uuid, /^00000000-0000-4000-8000-/);
});

test("no network escapes and no realtime connection opens", async () => {
  const blocked = await page.evaluate(async () => {
    try {
      await fetch("https://umami.puhulab.com/api/send");
      return "allowed";
    } catch (err) {
      return err.message;
    }
  });
  assert.match(blocked, /blocked network request/);

  const eventSource = await page.evaluate(() => {
    try {
      new EventSource("https://example.com/stream");
      return "opened";
    } catch (err) {
      return err.message;
    }
  });
  assert.match(eventSource, /must not be opened/);
});

test("the page stayed clean — no console errors, no failed requests", () => {
  assert.deepEqual(problems, [], `unexpected page problems:\n${problems.join("\n")}`);
});

test("the stubbed version reaches the injection guard", async () => {
  const version = await page.evaluate(() => chrome.runtime.getManifest().version);
  assert.equal(version, "9.9.9");
  assert.ok(existsSync(join(ROOT, "dist/content.js")), "public/content.js must be a copy of the shipped bundle");
});
