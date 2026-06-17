import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveManifestUrl, siteNameFromManifest } from "./site-manifest.ts";

test("siteNameFromManifest prefers short_name over name", () => {
  assert.equal(siteNameFromManifest({ short_name: "App", name: "Application" }), "App");
  assert.equal(siteNameFromManifest({ name: "Application" }), "Application");
  assert.equal(siteNameFromManifest({ short_name: "  " }), undefined);
});

test("resolveManifestUrl uses link rel=manifest when present", () => {
  const doc = {
    querySelector: () => ({ getAttribute: () => "/app.webmanifest" }),
    location: { href: "https://example.com/page" }
  } as unknown as Document;

  assert.equal(resolveManifestUrl(doc), "https://example.com/app.webmanifest");
});

test("resolveManifestUrl falls back to /manifest.json", () => {
  const doc = {
    querySelector: () => null,
    location: { href: "https://example.com/page" }
  } as unknown as Document;

  assert.equal(resolveManifestUrl(doc), "https://example.com/manifest.json");
});
