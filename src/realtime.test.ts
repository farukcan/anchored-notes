// Behavioural tests for the realtime subscribe handshake: which token the POST
// carries, that a 401 is retried once behind a token refresh, and that giving
// up on a dead session releases the caller's handle instead of leaving it
// pointing at a closed connection.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  PB_URL,
  fetchCalls,
  flush,
  resetFakes,
  setFetchHandler,
  storageLocal,
} from "./testing.ts";
import { connectRealtime } from "./realtime.ts";

const REALTIME_URL = `${PB_URL}/api/realtime`;
const REFRESH_URL = `${PB_URL}/api/collections/users/auth-refresh`;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  closed = false;
  private readonly listeners = new Map<string, ((event: { data: string }) => void)[]>();

  constructor() {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: { data: string }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
}

Object.assign(globalThis, { EventSource: FakeEventSource });

interface Deferred {
  promise: Promise<Response>;
  resolve: (res: Response) => void;
}

// A response the test resolves by hand, to hold a subscribe POST in flight.
function deferredResponse(): Deferred {
  let resolve!: (res: Response) => void;
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function subscriptionCalls(): string[] {
  return fetchCalls
    .filter((c) => c.url === REALTIME_URL)
    .map((c) => new Headers(c.init?.headers).get("Authorization") ?? "");
}

// Opens a subscription and drives the PB_CONNECT handshake the server would.
async function handshake(): Promise<{
  source: FakeEventSource;
  disconnect: () => void;
  closures: number[];
}> {
  const closures: number[] = [];
  const disconnect = connectRealtime(
    () => undefined,
    () => closures.push(1)
  );
  await flush();
  const source = FakeEventSource.instances[FakeEventSource.instances.length - 1];
  source.emit("PB_CONNECT", JSON.stringify({ clientId: "client-1" }));
  await flush();
  return { source, disconnect, closures };
}

beforeEach(() => {
  resetFakes();
  FakeEventSource.instances = [];
  storageLocal["auth"] = { token: "old", email: "a@b.c", plan: "pro" };
});

test("realtime subscribes with the stored token and stays open", async () => {
  setFetchHandler(() => new Response(null, { status: 204 }));

  const { source, disconnect, closures } = await handshake();

  assert.deepEqual(subscriptionCalls(), ["old"]);
  assert.equal(fetchCalls.filter((c) => c.url === REFRESH_URL).length, 0);
  assert.equal(source.closed, false);
  assert.deepEqual(closures, []);
  disconnect();
});

test("realtime refreshes once and retries the subscription on a 401", async () => {
  setFetchHandler((url, init) => {
    if (url === REFRESH_URL) {
      return Response.json({ token: "new", record: { email: "a@b.c", plan: "pro" } });
    }
    return new Headers(init?.headers).get("Authorization") === "new"
      ? new Response(null, { status: 204 })
      : new Response("", { status: 401 });
  });

  const { source, disconnect, closures } = await handshake();

  assert.deepEqual(subscriptionCalls(), ["old", "new"]);
  assert.equal(source.closed, false);
  assert.deepEqual(closures, []);
  disconnect();
});

test("realtime gives up and reports closure when the refreshed token is rejected too", async () => {
  setFetchHandler((url) =>
    url === REFRESH_URL
      ? Response.json({ token: "new", record: { email: "a@b.c", plan: "pro" } })
      : new Response("", { status: 401 })
  );

  const { source, closures } = await handshake();

  assert.deepEqual(subscriptionCalls(), ["old", "new"]);
  assert.equal(source.closed, true);
  // The caller drops its handle here, so a later auth change can reconnect.
  assert.deepEqual(closures, [1]);
});

test("realtime reports no closure for a connection the caller already disconnected", async () => {
  const retry = deferredResponse();
  let subscribeCount = 0;
  setFetchHandler((url) => {
    if (url === REFRESH_URL) {
      return Response.json({ token: "new", record: { email: "a@b.c", plan: "pro" } });
    }
    subscribeCount++;
    // The first POST looks like an expired token; the retry stays in flight so
    // the caller can disconnect (tab hidden, auth change) underneath it.
    return subscribeCount === 1 ? new Response("", { status: 401 }) : retry.promise;
  });

  const { source, disconnect, closures } = await handshake();
  assert.deepEqual(subscriptionCalls(), ["old", "new"]);

  disconnect();
  retry.resolve(new Response("", { status: 401 }));
  await flush();

  // Reporting a closure here would clear the caller's handle on the connection
  // it opened after this one, leaking a second EventSource.
  assert.equal(source.closed, true);
  assert.deepEqual(closures, []);
});

test("realtime gives up without retrying when the refresh itself fails", async () => {
  setFetchHandler(() => new Response("", { status: 401 }));

  const { source, closures } = await handshake();

  assert.deepEqual(subscriptionCalls(), ["old"]);
  assert.equal(source.closed, true);
  assert.deepEqual(closures, [1]);
});
