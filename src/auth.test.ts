// Behavioural tests for the token-refresh path in auth.ts, driven through the
// fake chrome.storage.local and fetch in testing.ts. Covers what the pure
// helpers in jwt.ts can't: which token each request carries, when a refresh
// fires, and what a refresh is allowed to overwrite in the stored auth state.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  BACKEND_URL,
  PB_URL,
  authHeaderOf,
  fetchCalls,
  resetFakes,
  setFetchHandler,
  storageLocal,
  type FetchCall,
} from "./testing.ts";
import {
  AuthRefreshUnavailableError,
  authFetch,
  onAuthChanged,
  refreshAuthToken,
  refreshIfExpiringSoon,
  type AuthState,
} from "./auth.ts";

const REFRESH_URL = `${PB_URL}/api/collections/users/auth-refresh`;

// Builds a JWT-shaped token whose `exp` claim sits `msFromNow` in the future.
function tokenExpiringIn(msFromNow: number, label: string): string {
  const base64url = (obj: Record<string, unknown>): string =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const payload = { exp: Math.floor((Date.now() + msFromNow) / 1000), label };
  return `${base64url({ alg: "HS256", typ: "JWT" })}.${base64url(payload)}.sig`;
}

function signIn(state: AuthState): void {
  storageLocal["auth"] = state;
}

function storedAuth(): AuthState | undefined {
  return storageLocal["auth"] as AuthState | undefined;
}

function backendCalls(): FetchCall[] {
  return fetchCalls.filter((c) => c.url.startsWith(BACKEND_URL));
}

function refreshCalls(): FetchCall[] {
  return fetchCalls.filter((c) => c.url === REFRESH_URL);
}

beforeEach(() => resetFakes());

test("authFetch sends the stored token and passes a non-401 response straight through", async () => {
  signIn({ token: "t1", email: "a@b.c", plan: "pro" });
  setFetchHandler(() => new Response("{}", { status: 200 }));

  const res = await authFetch("/api/me", {});

  assert.equal(res.status, 200);
  assert.equal(backendCalls().length, 1);
  assert.equal(backendCalls()[0].url, `${BACKEND_URL}/api/me`);
  assert.equal(authHeaderOf(backendCalls()[0]), "Bearer t1");
  assert.equal(refreshCalls().length, 0);
});

test("authFetch refreshes once on a 401 and retries with the fresh token", async () => {
  signIn({ token: "old", email: "a@b.c", plan: "pro" });
  setFetchHandler((url, init) => {
    if (url === REFRESH_URL) {
      return Response.json({ token: "new", record: { email: "a@b.c", plan: "pro" } });
    }
    return new Headers(init?.headers).get("Authorization") === "Bearer new"
      ? new Response("ok", { status: 200 })
      : new Response("expired", { status: 401 });
  });

  const res = await authFetch("/api/notes/sync", { method: "POST", body: "{}" });

  assert.equal(res.status, 200);
  assert.equal(refreshCalls().length, 1);
  assert.deepEqual(backendCalls().map(authHeaderOf), ["Bearer old", "Bearer new"]);
  assert.equal(storedAuth()?.token, "new");
});

test("authFetch returns the original 401 when PocketBase refuses the refresh too", async () => {
  signIn({ token: "dead", email: "a@b.c", plan: "pro" });
  setFetchHandler(() => new Response("", { status: 401 }));

  const res = await authFetch("/api/me", {});

  assert.equal(res.status, 401);
  assert.equal(backendCalls().length, 1);
  assert.equal(refreshCalls().length, 1);
  assert.equal(storedAuth()?.token, "dead");
});

test("authFetch retries only once when the refreshed token is also rejected", async () => {
  signIn({ token: "old", email: "a@b.c", plan: "pro" });
  setFetchHandler((url) =>
    url === REFRESH_URL
      ? Response.json({ token: "new", record: { email: "a@b.c", plan: "pro" } })
      : new Response("", { status: 401 })
  );

  const res = await authFetch("/api/notes/sync", { method: "POST", body: "{}" });

  // A 401 that survives the retry is what tells sync() the session is dead.
  assert.equal(res.status, 401);
  assert.equal(backendCalls().length, 2);
  assert.equal(refreshCalls().length, 1);
});

test("authFetch keeps caller headers whatever form they arrive in", async () => {
  signIn({ token: "t1", email: "a@b.c", plan: "pro" });
  setFetchHandler(() => new Response("{}", { status: 200 }));

  await authFetch("/api/me/encryption", {
    method: "PUT",
    headers: new Headers({ "Content-Type": "application/json" }),
    body: "{}",
  });
  await authFetch("/api/me/encryption", {
    method: "PUT",
    headers: [["Content-Type", "application/json"]],
    body: "{}",
  });

  for (const call of backendCalls()) {
    const headers = new Headers(call.init?.headers);
    assert.equal(headers.get("Content-Type"), "application/json");
    assert.equal(headers.get("Authorization"), "Bearer t1");
  }
});

test("authFetch throws when signed out", async () => {
  await assert.rejects(() => authFetch("/api/me", {}), /not signed in/);
  assert.equal(fetchCalls.length, 0);
});

test("a refresh replaces the token without touching the stored plan", async () => {
  signIn({ token: "old", email: "a@b.c", plan: "pro" });
  // A refresh response whose record omits `plan` must not downgrade the account.
  setFetchHandler(() => Response.json({ token: "new", record: { email: "a@b.c" } }));

  const refreshed = await refreshAuthToken();

  assert.deepEqual(refreshed, {
    status: "refreshed",
    state: { token: "new", email: "a@b.c", plan: "pro" },
  });
  assert.deepEqual(storedAuth(), { token: "new", email: "a@b.c", plan: "pro" });
});

test("a refresh does not resurrect an account signed out while it was in flight", async () => {
  signIn({ token: "old", email: "a@b.c", plan: "pro" });
  setFetchHandler(() => {
    delete storageLocal["auth"];
    return Response.json({ token: "new", record: { email: "a@b.c", plan: "pro" } });
  });

  // Not "rejected": nobody's session was refused, there is simply no account
  // left to refresh, and a caller must not read that as a dead session.
  assert.deepEqual(await refreshAuthToken(), { status: "unavailable" });
  assert.equal(storedAuth(), undefined);
});

test("a refresh does not adopt a different account signed in while it was in flight", async () => {
  signIn({ token: "old", email: "a@b.c", plan: "pro" });
  setFetchHandler(() => {
    // The first account signs out and a second signs in mid-request. Writing
    // this refresh's token now would attach account one's token to account two.
    signIn({ token: "second", email: "second@b.c", plan: "free" });
    return Response.json({ token: "new", record: { email: "a@b.c", plan: "pro" } });
  });

  // "unavailable", never "rejected": reporting a dead session here would sign
  // the second account out over the first account's refresh.
  assert.deepEqual(await refreshAuthToken(), { status: "unavailable" });
  assert.deepEqual(storedAuth(), { token: "second", email: "second@b.c", plan: "free" });
});

test("a refresh PocketBase couldn't serve is unavailable and leaves the token alone", async () => {
  signIn({ token: "old", email: "a@b.c", plan: "free" });
  setFetchHandler(() => new Response("", { status: 500 }));

  assert.deepEqual(await refreshAuthToken(), { status: "unavailable" });
  assert.equal(storedAuth()?.token, "old");
});

test("an unreachable PocketBase is unavailable, not a rejected session", async () => {
  signIn({ token: "old", email: "a@b.c", plan: "pro" });
  setFetchHandler(() => Promise.reject(new Error("net::ERR_INTERNET_DISCONNECTED")));

  assert.deepEqual(await refreshAuthToken(), { status: "unavailable" });
  assert.equal(storedAuth()?.token, "old");
});

test("PocketBase refusing the token is a rejected session", async () => {
  for (const status of [401, 403]) {
    resetFakes();
    signIn({ token: "dead", email: "a@b.c", plan: "pro" });
    setFetchHandler(() => new Response("", { status }));

    assert.deepEqual(await refreshAuthToken(), { status: "rejected" });
    assert.equal(storedAuth()?.token, "dead");
  }
});

test("a refresh adopts the token another context obtained for the same account", async () => {
  signIn({ token: "old", email: "a@b.c", plan: "pro" });
  setFetchHandler(() => {
    // The background alarm renews the same account while this request is out.
    signIn({ token: "fromOtherContext", email: "a@b.c", plan: "pro" });
    return Response.json({ token: "mine", record: { email: "a@b.c", plan: "pro" } });
  });

  // The winner's token is live, so the loser reports success with it rather
  // than discarding a working session — and does not write a second token.
  assert.deepEqual(await refreshAuthToken(), {
    status: "refreshed",
    state: { token: "fromOtherContext", email: "a@b.c", plan: "pro" },
  });
  assert.equal(storedAuth()?.token, "fromOtherContext");
  assert.equal(refreshCalls().length, 1);
});

test("concurrent refreshes share one auth-refresh request", async () => {
  signIn({ token: "old", email: "a@b.c", plan: "pro" });
  setFetchHandler(() => Response.json({ token: "new", record: { email: "a@b.c", plan: "pro" } }));

  const [first, second] = await Promise.all([refreshAuthToken(), refreshAuthToken()]);

  assert.equal(refreshCalls().length, 1);
  assert.deepEqual(first, second);

  // The in-flight slot clears afterwards, so a later refresh really refreshes.
  await refreshAuthToken();
  assert.equal(refreshCalls().length, 2);
});

test("authFetch retries with the token another context obtained for the same account", async () => {
  signIn({ token: "old", email: "a@b.c", plan: "pro" });
  setFetchHandler((url, init) => {
    if (url === REFRESH_URL) {
      signIn({ token: "good", email: "a@b.c", plan: "pro" });
      return Response.json({ token: "mine", record: { email: "a@b.c", plan: "pro" } });
    }
    return new Headers(init?.headers).get("Authorization") === "Bearer good"
      ? new Response("ok", { status: 200 })
      : new Response("expired", { status: 401 });
  });

  // Losing the refresh race must not cost the caller its retry: sync() reads a
  // surviving 401 as a dead session and would sign this live account out.
  const res = await authFetch("/api/notes/sync", { method: "POST", body: "{}" });

  assert.equal(res.status, 200);
  assert.deepEqual(backendCalls().map(authHeaderOf), ["Bearer old", "Bearer good"]);
  assert.equal(storedAuth()?.token, "good");
});

test("authFetch raises instead of surfacing a 401 it could not get a verdict on", async () => {
  signIn({ token: "old", email: "a@b.c", plan: "pro" });
  setFetchHandler((url) => {
    // The backend answers, PocketBase doesn't: a transient outage must not
    // reach sync() as a 401, which it would answer with logout() + key wipe.
    if (url === REFRESH_URL) return Promise.reject(new Error("offline"));
    return new Response("expired", { status: 401 });
  });

  await assert.rejects(
    () => authFetch("/api/notes/sync", { method: "POST", body: "{}" }),
    AuthRefreshUnavailableError
  );
  assert.equal(backendCalls().length, 1);
  assert.deepEqual(storedAuth(), { token: "old", email: "a@b.c", plan: "pro" });
});

test("authFetch raises rather than reporting a 401 for an account that changed underneath", async () => {
  signIn({ token: "old", email: "a@b.c", plan: "pro" });
  setFetchHandler((url) => {
    if (url === REFRESH_URL) {
      signIn({ token: "second", email: "second@b.c", plan: "free" });
      return Response.json({ token: "mine", record: { email: "a@b.c", plan: "pro" } });
    }
    return new Response("expired", { status: 401 });
  });

  // Handing back the 401 would have sync() sign the second account out over
  // the first account's request.
  await assert.rejects(
    () => authFetch("/api/notes/sync", { method: "POST", body: "{}" }),
    AuthRefreshUnavailableError
  );
  assert.deepEqual(storedAuth(), { token: "second", email: "second@b.c", plan: "free" });
});

test("refreshIfExpiringSoon renews a token inside the 30-minute margin", async () => {
  signIn({ token: tokenExpiringIn(10 * 60 * 1000, "old"), email: "a@b.c", plan: "pro" });
  setFetchHandler(() =>
    Response.json({ token: "renewed", record: { email: "a@b.c", plan: "pro" } })
  );

  await refreshIfExpiringSoon();

  assert.equal(refreshCalls().length, 1);
  assert.equal(storedAuth()?.token, "renewed");
});

test("refreshIfExpiringSoon leaves a token that isn't close to expiring", async () => {
  const token = tokenExpiringIn(6 * 24 * 60 * 60 * 1000, "fresh");
  signIn({ token, email: "a@b.c", plan: "pro" });

  await refreshIfExpiringSoon();

  assert.equal(fetchCalls.length, 0);
  assert.equal(storedAuth()?.token, token);
});

test("refreshIfExpiringSoon defers to the reactive path for an undecodable token", async () => {
  signIn({ token: "not-a-jwt", email: "a@b.c", plan: "pro" });

  await refreshIfExpiringSoon();

  assert.equal(fetchCalls.length, 0);
});

test("refreshIfExpiringSoon is a no-op when signed out", async () => {
  await refreshIfExpiringSoon();
  assert.equal(fetchCalls.length, 0);
});

test("onAuthChanged reports the previous state, so a token refresh is not a sign-in", async () => {
  const seen: { email: string | null; previousEmail: string | null; token: string | null }[] = [];
  const unsubscribe = onAuthChanged((state, previous) => {
    seen.push({
      email: state?.email ?? null,
      previousEmail: previous?.email ?? null,
      token: state?.token ?? null,
    });
  });

  signIn({ token: "old", email: "a@b.c", plan: "pro" });
  setFetchHandler(() => Response.json({ token: "new", record: { email: "a@b.c", plan: "pro" } }));
  await refreshAuthToken();
  unsubscribe();

  // background.ts skips its eager encryption setup + sync on exactly this shape:
  // same account, new token.
  assert.deepEqual(seen, [{ email: "a@b.c", previousEmail: "a@b.c", token: "new" }]);
});
