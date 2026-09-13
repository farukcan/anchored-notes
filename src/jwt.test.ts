import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeJwtExpiryMs, shouldRefresh } from "./jwt.ts";

// Builds a JWT-shaped string with the given payload, base64url-encoded like a
// real token. The signature segment is a placeholder: decodeJwtExpiryMs never
// verifies it.
function makeJwt(payload: Record<string, unknown>): string {
  const base64url = (obj: Record<string, unknown>): string =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${base64url({ alg: "HS256", typ: "JWT" })}.${base64url(payload)}.sig`;
}

test("decodeJwtExpiryMs reads the exp claim in milliseconds", () => {
  const expSeconds = 1_800_000_000;
  const token = makeJwt({ exp: expSeconds, sub: "user1" });
  assert.equal(decodeJwtExpiryMs(token), expSeconds * 1000);
});

test("decodeJwtExpiryMs returns null when exp is missing", () => {
  const token = makeJwt({ sub: "user1" });
  assert.equal(decodeJwtExpiryMs(token), null);
});

test("decodeJwtExpiryMs returns null for a non-JWT string", () => {
  assert.equal(decodeJwtExpiryMs("not-a-jwt"), null);
  assert.equal(decodeJwtExpiryMs("only.two"), null);
  assert.equal(decodeJwtExpiryMs(""), null);
});

test("decodeJwtExpiryMs returns null when the payload segment isn't valid JSON", () => {
  const token = `${btoa(JSON.stringify({ alg: "HS256" }))}.not-base64-json.sig`;
  assert.equal(decodeJwtExpiryMs(token), null);
});

test("decodeJwtExpiryMs handles unpadded base64url payloads", () => {
  // Payload lengths that need 0-3 chars of "=" padding after base64url decode.
  for (let sub = 0; sub < 4; sub++) {
    const token = makeJwt({ exp: 1000, sub: "x".repeat(sub) });
    assert.equal(decodeJwtExpiryMs(token), 1_000_000);
  }
});

test("shouldRefresh defers to the reactive path when expiry is unknown", () => {
  assert.equal(shouldRefresh(null, Date.now(), 30 * 60 * 1000), false);
});

test("shouldRefresh is false when expiry is well beyond the margin", () => {
  const now = Date.now();
  const expiryMs = now + 60 * 60 * 1000; // 1h away
  assert.equal(shouldRefresh(expiryMs, now, 30 * 60 * 1000), false);
});

test("shouldRefresh is true when expiry is within the margin", () => {
  const now = Date.now();
  const expiryMs = now + 10 * 60 * 1000; // 10m away
  assert.equal(shouldRefresh(expiryMs, now, 30 * 60 * 1000), true);
});

test("shouldRefresh is true once expiry has already passed", () => {
  const now = Date.now();
  const expiryMs = now - 1;
  assert.equal(shouldRefresh(expiryMs, now, 30 * 60 * 1000), true);
});

test("shouldRefresh is true exactly at the margin boundary", () => {
  const now = Date.now();
  const marginMs = 30 * 60 * 1000;
  assert.equal(shouldRefresh(now + marginMs, now, marginMs), true);
});
