import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ENC_PREFIX,
  decryptContent,
  deriveKey,
  encryptContent,
  exportKeyB64,
  generateSaltB64,
  importKeyB64,
  isEncrypted,
  makeEncCheck,
  verifyEncCheck,
} from "./crypto.ts";

const salt = generateSaltB64();

test("encrypt/decrypt round-trips content", async () => {
  const key = await deriveKey("secret", salt);
  const plaintext = "# Note\n\nSome **markdown** with ünïcödé 🙂";
  const payload = await encryptContent(key, plaintext);
  assert.ok(isEncrypted(payload));
  assert.equal(await decryptContent(key, payload), plaintext);
});

test("same plaintext produces distinct ciphertexts (random IV)", async () => {
  const key = await deriveKey("secret", salt);
  const a = await encryptContent(key, "same");
  const b = await encryptContent(key, "same");
  assert.notEqual(a, b);
});

test("decrypt fails on wrong key", async () => {
  const key = await deriveKey("secret", salt);
  const other = await deriveKey("different", salt);
  const payload = await encryptContent(key, "hello");
  await assert.rejects(() => decryptContent(other, payload), /decryption failed/);
});

test("decrypt fails on tampered payload", async () => {
  const key = await deriveKey("secret", salt);
  const payload = await encryptContent(key, "hello");
  // Flip a character in the base64 body.
  const body = payload.slice(ENC_PREFIX.length);
  const flipped = body[10] === "A" ? "B" : "A";
  const tampered = ENC_PREFIX + body.slice(0, 10) + flipped + body.slice(11);
  await assert.rejects(() => decryptContent(key, tampered));
});

test("decrypt rejects plaintext without prefix", async () => {
  const key = await deriveKey("secret", salt);
  await assert.rejects(() => decryptContent(key, "just some text"), /prefix/);
});

test("same secret and salt derive the same key", async () => {
  const a = await deriveKey("secret", salt);
  const b = await deriveKey("secret", salt);
  assert.equal(await exportKeyB64(a), await exportKeyB64(b));
});

test("exported key re-imports and decrypts", async () => {
  const key = await deriveKey("secret", salt);
  const payload = await encryptContent(key, "persisted");
  const restored = await importKeyB64(await exportKeyB64(key));
  assert.equal(await decryptContent(restored, payload), "persisted");
});

test("encCheck verifies the matching key and rejects others", async () => {
  const key = await deriveKey("secret", salt);
  const other = await deriveKey("different", salt);
  const check = await makeEncCheck(key);
  assert.equal(await verifyEncCheck(key, check), true);
  assert.equal(await verifyEncCheck(other, check), false);
  assert.equal(await verifyEncCheck(key, "garbage"), false);
});
