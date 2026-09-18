// Behavioural test for sync()'s in-flight handling: a trigger that lands while
// a run is in progress must produce one more run afterwards, carrying the edits
// made during the round-trip, instead of being dropped.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  BACKEND_URL,
  fetchCalls,
  flush,
  resetFakes,
  setFetchHandler,
  storageLocal,
  type FetchCall,
} from "./testing.ts";
import { encryptContent, exportKeyB64, importKeyB64, makeEncCheck } from "./crypto.ts";
import { saveNote } from "./storage.ts";
import { sync } from "./sync.ts";
import type { Note } from "./types.ts";

const SYNC_URL = `${BACKEND_URL}/api/notes/sync`;

// Signs in with a ready default-mode key (a random AES key stands in for the
// PBKDF2-derived one) and returns the account's encCheck.
async function signInWithKey(): Promise<string> {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
  const encCheck = await makeEncCheck(key);
  storageLocal["auth"] = { token: "t", email: "a@b.c", plan: "free" };
  storageLocal["lastAccountEmail"] = "a@b.c";
  storageLocal["encKeyState"] = { rawKeyB64: await exportKeyB64(key), encCheck, mode: "default" };
  return encCheck;
}

function note(id: string): Note {
  return {
    id,
    content: `note ${id}`,
    color: "yellow",
    scope: "page",
    anchorKey: "https://example.com/",
    x: 0,
    y: 0,
    w: 220,
    h: 200,
    createdAt: 1,
    updatedAt: 1,
  };
}

function syncCalls(): FetchCall[] {
  return fetchCalls.filter((c) => c.url === SYNC_URL);
}

function pushedIds(call: FetchCall): string[] {
  const body = JSON.parse(String(call.init?.body)) as { upserts: { clientId: string }[] };
  return body.upserts.map((u) => u.clientId);
}

// Web Crypto work runs off the microtask queue, so settle in macrotask turns.
async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !condition(); i++) await flush();
  assert.ok(condition(), "condition not met in time");
}

beforeEach(() => resetFakes());

test("a sync requested mid-run re-runs afterwards with the edits made meanwhile", async () => {
  const encCheck = await signInWithKey();
  const okResponse = (): Response =>
    Response.json({ notes: [], rejected: [], failed: [], plan: "free", limit: 30, encCheck });

  let release!: (res: Response) => void;
  const held = new Promise<Response>((r) => {
    release = r;
  });
  setFetchHandler((url) => {
    if (url !== SYNC_URL) return new Response("unexpected", { status: 500 });
    return syncCalls().length === 1 ? held : okResponse();
  });

  const running = sync();
  await waitFor(() => syncCalls().length === 1);

  await saveNote(note("edited-mid-run"));
  await sync(); // lands while the first POST is in flight

  release(okResponse());
  await running;

  assert.equal(syncCalls().length, 2);
  assert.deepEqual(pushedIds(syncCalls()[0]), []);
  assert.deepEqual(pushedIds(syncCalls()[1]), ["edited-mid-run"]);
});

test("a sync with no pending trigger runs once", async () => {
  const encCheck = await signInWithKey();
  setFetchHandler(() =>
    Response.json({ notes: [], rejected: [], failed: [], plan: "free", limit: 30, encCheck }),
  );

  await sync();

  assert.equal(syncCalls().length, 1);
});

test("a second sync does not re-push an unchanged note", async () => {
  const encCheck = await signInWithKey();
  const local = note("stable");
  await saveNote(local);
  const key = await importKeyB64(
    (storageLocal["encKeyState"] as { rawKeyB64: string }).rawKeyB64,
  );
  const content = await encryptContent(key, local.content);
  setFetchHandler(() =>
    Response.json({
      notes: [
        {
          clientId: local.id,
          content,
          color: local.color,
          scope: local.scope,
          anchorKey: local.anchorKey,
          x: local.x,
          y: local.y,
          w: local.w,
          h: local.h,
          hidden: false,
          deleted: false,
          noteCreatedAt: local.createdAt,
          noteUpdatedAt: local.updatedAt,
        },
      ],
      rejected: [],
      failed: [],
      plan: "free",
      limit: 30,
      encCheck,
    }),
  );

  await sync();
  await sync();

  assert.equal(syncCalls().length, 2);
  assert.deepEqual(pushedIds(syncCalls()[0]), ["stable"]);
  assert.deepEqual(pushedIds(syncCalls()[1]), []);
});

test("pushed notes encrypt content only", async () => {
  const encCheck = await signInWithKey();
  await saveNote(note("enc"));
  setFetchHandler(() =>
    Response.json({ notes: [], rejected: [], failed: [], plan: "free", limit: 30, encCheck }),
  );

  await sync();

  const body = JSON.parse(String(syncCalls()[0]!.init?.body)) as {
    upserts: { content: string; scope: string; anchorKey: string }[];
  };
  const dto = body.upserts[0]!;
  assert.match(dto.content, /^enc:v1:/);
  assert.equal(dto.scope, "page");
  assert.equal(dto.anchorKey, "https://example.com/");
});
