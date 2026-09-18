import { test } from "node:test";
import assert from "node:assert/strict";
import { httpUrl, isSafeHref } from "./safe-href.ts";

test("isSafeHref allows http(s), mailto, and relative links", () => {
  assert.equal(isSafeHref("https://example.com/"), true);
  assert.equal(isSafeHref("http://example.com/"), true);
  assert.equal(isSafeHref("mailto:a@b.c"), true);
  assert.equal(isSafeHref("/path"), true);
  assert.equal(isSafeHref("#frag"), true);
  assert.equal(isSafeHref("../up"), true);
});

test("isSafeHref rejects javascript and data URLs", () => {
  assert.equal(isSafeHref("javascript:alert(1)"), false);
  assert.equal(isSafeHref("  java\nscript:alert(1)"), false);
  assert.equal(isSafeHref("data:text/html,hi"), false);
  assert.equal(isSafeHref("vbscript:msg"), false);
});

test("httpUrl only returns absolute http(s)", () => {
  assert.equal(httpUrl("https://example.com/a"), "https://example.com/a");
  assert.equal(httpUrl("javascript:alert(1)"), undefined);
  assert.equal(httpUrl("tab-12"), undefined);
});
