import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resetFakes, storageLocal } from "./testing.ts";
import { applyAccountMerge, getPendingAccountMerge } from "./account-merge.ts";
import { getLastAccountEmail, setLastAccountEmail } from "./auth.ts";
import { getAllNotes, getDeviceOnlyNoteIds, getLastSyncedAt, saveNote } from "./storage.ts";
import type { Note } from "./types.ts";

function note(id: string, updatedAt = 10): Note {
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
    updatedAt,
  };
}

beforeEach(() => resetFakes());

test("same account as last time does not need a merge prompt", async () => {
  storageLocal["auth"] = { token: "t", email: "a@b.c", plan: "free" };
  await setLastAccountEmail("a@b.c");
  await saveNote(note("n1"));
  assert.equal(await getPendingAccountMerge(), null);
});

test("a signed-in session missing lastAccountEmail does not stall behind a prompt", async () => {
  storageLocal["auth"] = { token: "t", email: "a@b.c", plan: "free" };
  await saveNote(note("n1"));
  assert.equal(await getPendingAccountMerge(), null);
  assert.equal(await getLastAccountEmail(), "a@b.c");
});

test("leftover local notes from another account need a prompt", async () => {
  storageLocal["auth"] = { token: "t", email: "b@b.c", plan: "free" };
  await setLastAccountEmail("a@b.c");
  await saveNote(note("n1"));
  assert.deepEqual(await getPendingAccountMerge(), { email: "b@b.c", count: 1 });
});

test("no leftover notes records the new account and skips the prompt", async () => {
  storageLocal["auth"] = { token: "t", email: "b@b.c", plan: "free" };
  assert.equal(await getPendingAccountMerge(), null);
  assert.equal(await getLastAccountEmail(), "b@b.c");
});

test("keep leaves notes local and raises the sync watermark", async () => {
  storageLocal["auth"] = { token: "t", email: "b@b.c", plan: "free" };
  await saveNote(note("n1", 42));
  await applyAccountMerge("keep");
  assert.equal((await getAllNotes()).length, 1);
  assert.equal(await getLastSyncedAt(), 42);
  assert.deepEqual([...(await getDeviceOnlyNoteIds())], ["n1"]);
  assert.equal(await getLastAccountEmail(), "b@b.c");
  assert.equal(await getPendingAccountMerge(), null);
});

test("upload resets the watermark so leftover notes are pushed", async () => {
  storageLocal["auth"] = { token: "t", email: "b@b.c", plan: "free" };
  storageLocal["lastSyncedAt"] = 99;
  await saveNote(note("n1", 42));
  await applyAccountMerge("upload");
  assert.equal(await getLastSyncedAt(), 0);
  assert.equal((await getDeviceOnlyNoteIds()).size, 0);
  assert.equal(await getLastAccountEmail(), "b@b.c");
});

test("delete wipes leftover notes", async () => {
  storageLocal["auth"] = { token: "t", email: "b@b.c", plan: "free" };
  await saveNote(note("n1"));
  await applyAccountMerge("delete");
  assert.equal((await getAllNotes()).length, 0);
  assert.equal(await getLastAccountEmail(), "b@b.c");
});
