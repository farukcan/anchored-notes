import { test } from "node:test";
import assert from "node:assert/strict";
import { anchorKeyFor, isNoteVisible, pageContextFromLocation } from "./matching.ts";
import type { Note } from "./types.ts";

const ctx = pageContextFromLocation("https://www.google.com/search?q=hi#frag", 42);

function note(over: Partial<Note>): Note {
  return {
    id: "n",
    content: "",
    color: "yellow",
    scope: "global",
    anchorKey: "",
    x: 0,
    y: 0,
    w: 200,
    h: 200,
    createdAt: 0,
    updatedAt: 0,
    ...over
  };
}

test("pageContext strips hash but keeps search", () => {
  assert.equal(ctx.origin, "https://www.google.com");
  assert.equal(ctx.urlNoHash, "https://www.google.com/search?q=hi");
  assert.equal(ctx.tabId, 42);
});

test("anchorKeyFor derives the right key per scope", () => {
  assert.equal(anchorKeyFor("global", ctx), "");
  assert.equal(anchorKeyFor("site", ctx), "https://www.google.com");
  assert.equal(anchorKeyFor("page", ctx), "https://www.google.com/search?q=hi");
  assert.equal(anchorKeyFor("tab", ctx), "42");
});

test("global notes are always visible", () => {
  assert.ok(isNoteVisible(note({ scope: "global" }), ctx));
});

test("site notes match same origin only", () => {
  assert.ok(isNoteVisible(note({ scope: "site", anchorKey: "https://www.google.com" }), ctx));
  assert.ok(!isNoteVisible(note({ scope: "site", anchorKey: "https://example.com" }), ctx));
});

test("page notes match the exact url without hash", () => {
  assert.ok(isNoteVisible(note({ scope: "page", anchorKey: "https://www.google.com/search?q=hi" }), ctx));
  assert.ok(!isNoteVisible(note({ scope: "page", anchorKey: "https://www.google.com/" }), ctx));
});

test("tab notes match the tab id", () => {
  assert.ok(isNoteVisible(note({ scope: "tab", anchorKey: "42" }), ctx));
  assert.ok(!isNoteVisible(note({ scope: "tab", anchorKey: "7" }), ctx));
});
