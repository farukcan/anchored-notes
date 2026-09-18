import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resetFakes, storageSession } from "./testing.ts";
import {
  holdLeadership,
  releaseLeadership,
  REALTIME_LEADER_KEY,
} from "./realtime-leader.ts";

beforeEach(() => resetFakes());

test("an empty lease is acquired", async () => {
  assert.equal(await holdLeadership(1), true);
  const lease = storageSession[REALTIME_LEADER_KEY] as { tabId: number };
  assert.equal(lease.tabId, 1);
});

test("a live lease from another tab is not stolen", async () => {
  assert.equal(await holdLeadership(1), true);
  assert.equal(await holdLeadership(2), false);
});

test("an expired lease can be taken over", async () => {
  storageSession[REALTIME_LEADER_KEY] = {
    tabId: 1,
    token: "old",
    expiresAt: 1,
  };
  assert.equal(await holdLeadership(2), true);
  const lease = storageSession[REALTIME_LEADER_KEY] as { tabId: number };
  assert.equal(lease.tabId, 2);
});

test("the current leader can renew", async () => {
  assert.equal(await holdLeadership(1), true);
  assert.equal(await holdLeadership(1), true);
});

test("release lets another tab become leader", async () => {
  assert.equal(await holdLeadership(1), true);
  await releaseLeadership(1);
  assert.equal(await holdLeadership(2), true);
});

test("a negative tab id never becomes leader", async () => {
  assert.equal(await holdLeadership(-1), false);
});
