import { test } from "node:test";
import assert from "node:assert/strict";
import { ANCHOR_SCOPES, NOTE_COLORS, isAnchorScope, isNoteColor } from "./types.ts";

test("isAnchorScope accepts only the shared scope list", () => {
  for (const scope of ANCHOR_SCOPES) assert.equal(isAnchorScope(scope), true);
  assert.equal(isAnchorScope("folder"), false);
});

test("isNoteColor accepts only the shared color list", () => {
  for (const color of NOTE_COLORS) assert.equal(isNoteColor(color), true);
  assert.equal(isNoteColor("red"), false);
});
