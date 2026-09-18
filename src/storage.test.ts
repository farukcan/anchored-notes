// Behavioural tests for the notes storage layer: the serialized write queue
// (a tombstone can't be lost to an interleaved read-modify-write), import
// semantics for a signed-in account, what the sync merge may drop, and the
// quota check inside createNote.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resetFakes, storageLocal } from "./testing.ts";
import {
  applySyncResult,
  createNote,
  deleteNote,
  getAllNotes,
  getDeletedNoteIds,
  replaceAllNotes,
  saveNote,
} from "./storage.ts";
import type { Note } from "./types.ts";

function note(id: string, overrides: Partial<Note> = {}): Note {
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
    ...overrides,
  };
}

function seedNotes(...notes: Note[]): void {
  storageLocal["notes"] = Object.fromEntries(notes.map((n) => [n.id, n]));
}

function signIn(): void {
  storageLocal["auth"] = { token: "t", email: "a@b.c", plan: "free" };
}

async function storedIds(): Promise<string[]> {
  return (await getAllNotes()).map((n) => n.id).sort();
}

beforeEach(() => resetFakes());

test("concurrent deletes each leave a tombstone", async () => {
  signIn();
  seedNotes(note("a"), note("b"));

  await Promise.all([deleteNote("a"), deleteNote("b")]);

  assert.deepEqual((await getDeletedNoteIds()).sort(), ["a", "b"]);
  assert.deepEqual(await storedIds(), []);
});

test("anonymous deletes leave no tombstone", async () => {
  seedNotes(note("a"));

  await deleteNote("a");

  assert.deepEqual(await getDeletedNoteIds(), []);
  assert.deepEqual(await storedIds(), []);
});

test("switching a synced note to tab scope tombstones it but keeps it locally", async () => {
  signIn();
  seedNotes(note("a"));

  await saveNote(note("a", { scope: "tab", anchorKey: "42" }));

  assert.deepEqual(await getDeletedNoteIds(), ["a"]);
  assert.equal((await getAllNotes())[0]?.scope, "tab");
});

test("a signed-in import tombstones the notes it drops and lifts tombstones for re-imported ids", async () => {
  signIn();
  seedNotes(note("kept"), note("dropped"), note("tab", { scope: "tab", anchorKey: "7" }));
  storageLocal["deletedNoteIds"] = ["restored"];

  await replaceAllNotes([note("kept"), note("restored")]);

  assert.deepEqual(await storedIds(), ["kept", "restored"]);
  assert.deepEqual(await getDeletedNoteIds(), ["dropped"]);
});

test("an anonymous import records no tombstones", async () => {
  seedNotes(note("dropped"));

  await replaceAllNotes([note("new")]);

  assert.deepEqual(await storedIds(), ["new"]);
  assert.deepEqual(await getDeletedNoteIds(), []);
});

test("applySyncResult keeps a pushed note the server didn't return", async () => {
  seedNotes(note("local-only"), note("shared"));

  await applySyncResult({
    serverNotes: [note("shared", { content: "from server", updatedAt: 5 })],
    rejected: [],
    appliedDeletes: [],
  });

  const byId = Object.fromEntries((await getAllNotes()).map((n) => [n.id, n]));
  assert.ok(byId["local-only"]);
  assert.equal(byId["shared"]?.content, "from server");
});

test("applySyncResult drops applied deletes but never tab notes", async () => {
  seedNotes(note("gone"), note("tab", { scope: "tab", anchorKey: "7" }));

  await applySyncResult({ serverNotes: [], rejected: [], appliedDeletes: ["gone", "tab"] });

  assert.deepEqual(await storedIds(), ["tab"]);
});

test("createNote enforces the limit inside the serialized write", async () => {
  // Anonymous limit is 15: one slot left, two creates racing for it.
  seedNotes(...Array.from({ length: 14 }, (_, i) => note(`n${i}`)));

  const results = await Promise.all([createNote(note("x")), createNote(note("y"))]);

  assert.deepEqual(results.sort(), [false, true]);
  assert.equal((await getAllNotes()).length, 15);
});
