// Account/auth layer. Authentication runs directly against PocketBase using the
// Google OAuth2 authorization-code flow, driven by chrome.identity. The
// resulting token + plan are persisted in chrome.storage.local so any context
// (popup, content, background) can read the current account state synchronously
// after an initial async load.
//
// PocketBase auth tokens expire (~7 days). Two mechanisms keep a device signed
// in across that boundary: background.ts calls refreshIfExpiringSoon() on its
// periodic alarm to renew the token ahead of expiry, and authFetch() catches
// any 401 that slips through (token expired between checks) by refreshing once
// and retrying the request. Only a 401 that survives a refresh means the
// session is genuinely invalid.

import { BACKEND_URL, getRuntimeConfig } from "./config.js";
import { wipeEncryptionState } from "./crypto.js";
import { decodeJwtExpiryMs, shouldRefresh } from "./jwt.js";

export type Plan = "free" | "pro";

export interface AuthState {
  token: string;
  email: string;
  plan: Plan;
}

const AUTH_KEY = "auth";

// Shape of the PocketBase auth-methods OAuth2 provider entry we rely on.
interface OAuth2Provider {
  name: string;
  state: string;
  authURL: string;
  codeVerifier: string;
}

interface AuthMethodsResponse {
  oauth2: { enabled: boolean; providers: OAuth2Provider[] };
}

// Shape shared by every PocketBase auth endpoint we call (auth-with-oauth2,
// auth-refresh): a fresh token plus the current user record.
interface PBAuthResponse {
  token: string;
  record: { email: string; plan: string };
}

export async function getAuthState(): Promise<AuthState | null> {
  const result = await chrome.storage.local.get(AUTH_KEY);
  return (result[AUTH_KEY] as AuthState | undefined) ?? null;
}

async function setAuthState(state: AuthState | null): Promise<void> {
  if (state === null) {
    await chrome.storage.local.remove(AUTH_KEY);
    return;
  }
  await chrome.storage.local.set({ [AUTH_KEY]: state });
}

function normalizePlan(plan: string): Plan {
  return plan === "pro" ? "pro" : "free";
}

// Run the Google OAuth2 code flow and persist the resulting account state.
// Throws with context on failure; callers surface a localized message.
export async function login(): Promise<AuthState> {
  const { pbUrl, oauthProvider } = await getRuntimeConfig();
  const methodsRes = await fetch(`${pbUrl}/api/collections/users/auth-methods`);
  if (!methodsRes.ok) {
    throw new Error(`auth-methods failed: ${methodsRes.status}`);
  }
  const methods = (await methodsRes.json()) as AuthMethodsResponse;
  const provider = methods.oauth2.providers.find((p) => p.name === oauthProvider);
  if (!provider) {
    throw new Error(`OAuth provider "${oauthProvider}" not enabled in PocketBase`);
  }

  const redirectUrl = chrome.identity.getRedirectURL();
  // PocketBase's authURL ends with `redirect_uri=`; append the extension's
  // redirect target so the provider returns the code to chrome.identity.
  const authUrl = provider.authURL + encodeURIComponent(redirectUrl);

  const responseUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl,
    interactive: true,
  });
  if (!responseUrl) {
    throw new Error("OAuth flow returned no redirect URL");
  }

  const returned = new URL(responseUrl);
  const code = returned.searchParams.get("code");
  const state = returned.searchParams.get("state");
  if (!code) {
    throw new Error("OAuth redirect missing authorization code");
  }
  if (state !== provider.state) {
    throw new Error("OAuth state mismatch");
  }

  const exchangeRes = await fetch(`${pbUrl}/api/collections/users/auth-with-oauth2`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: oauthProvider,
      code,
      codeVerifier: provider.codeVerifier,
      redirectUrl,
    }),
  });
  if (!exchangeRes.ok) {
    const body = await exchangeRes.text();
    throw new Error(`token exchange failed: ${exchangeRes.status} ${body}`);
  }

  const auth = (await exchangeRes.json()) as PBAuthResponse;
  const state2: AuthState = {
    token: auth.token,
    email: auth.record.email,
    plan: normalizePlan(auth.record.plan),
  };
  await setAuthState(state2);
  return state2;
}

export async function logout(): Promise<void> {
  await setAuthState(null);
  // The encryption key is account-bound; never leave it on a signed-out device.
  await wipeEncryptionState();
}

// Refresh happens this long before the token's `exp` claim, and is also
// roughly how much slack a device has if it's offline right at that point.
const REFRESH_MARGIN_MS = 30 * 60 * 1000; // 30 minutes

// Concurrent refresh attempts within the same JS context (the periodic check
// and a 401 retry landing at the same time) share one in-flight request
// instead of racing two token exchanges. Other contexts (popup, options —
// each their own realm) may still issue a parallel refresh; PocketBase's
// auth-refresh endpoint tolerates that, it just costs an extra round trip.
let refreshInFlight: Promise<AuthState | null> | null = null;

// Exchanges the current token for a fresh one via PocketBase's auth-refresh
// endpoint and persists it. Returns null when there's no signed-in account,
// the refresh endpoint rejects the token (session is genuinely over), or the
// attempt fails for any other reason (e.g. offline) — callers fall back to
// whatever they had rather than throw.
export function refreshAuthToken(): Promise<AuthState | null> {
  if (refreshInFlight === null) {
    refreshInFlight = performRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function performRefresh(): Promise<AuthState | null> {
  const auth = await getAuthState();
  if (!auth) return null;
  try {
    const { pbUrl } = await getRuntimeConfig();
    const res = await fetch(`${pbUrl}/api/collections/users/auth-refresh`, {
      method: "POST",
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as PBAuthResponse;
    // A refresh replaces the token and nothing else: plan/email stay under the
    // stored state's control (sync() is the authority on plan changes), so a
    // refresh response without a `plan` field can never silently downgrade a
    // pro account.
    //
    // Re-reading also lets whatever happened mid-request win. The stored token
    // must still be the one this refresh was issued against: a logout clears it
    // and an account switch replaces it, and in both cases writing our token
    // onto the state stored now would attach it to the wrong account.
    const current = await getAuthState();
    if (!current || current.token !== auth.token) return null;
    const refreshed: AuthState = { ...current, token: data.token };
    await setAuthState(refreshed);
    return refreshed;
  } catch {
    // Network failure reaching the config/refresh endpoint: degrade to "no
    // refresh" instead of throwing out of authFetch/refreshIfExpiringSoon.
    return null;
  }
}

// Called from background.ts's periodic alarm. Renews the stored token ahead
// of expiry so normal requests never have to hit the reactive 401-retry path.
// No-op when signed out or the token isn't close to expiring.
export async function refreshIfExpiringSoon(): Promise<void> {
  const auth = await getAuthState();
  if (!auth) return;
  const expiryMs = decodeJwtExpiryMs(auth.token);
  if (!shouldRefresh(expiryMs, Date.now(), REFRESH_MARGIN_MS)) return;
  await refreshAuthToken();
}

// Adds the bearer token to a request's headers. Goes through Headers so a
// caller's own headers survive whatever form they're in (plain object, Headers
// instance or entry array).
function withBearer(init: RequestInit, token: string): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return { ...init, headers };
}

// Authenticated fetch against the backend. A 401 means the token may simply
// have expired since the last proactive refresh: refresh once and retry the
// request. A 401 that survives the retry means the session is genuinely
// invalid, and callers should treat it as a real auth failure (e.g. logout).
// The retry is safe for the non-idempotent calls here because a 401 means the
// backend rejected the request before acting on it.
export async function authFetch(path: string, init: RequestInit): Promise<Response> {
  const auth = await getAuthState();
  if (!auth) throw new Error("authFetch: not signed in");
  const res = await fetch(`${BACKEND_URL}${path}`, withBearer(init, auth.token));
  if (res.status !== 401) return res;
  const refreshed = await refreshAuthToken();
  if (!refreshed) return res;
  return fetch(`${BACKEND_URL}${path}`, withBearer(init, refreshed.token));
}

// Hard-delete the account and all synced notes on the backend, then sign out.
// A 401 means the token/account is already gone, so we still clear local auth.
// Callers clear local notes afterwards (storage isn't imported here to avoid a
// circular import: storage.ts depends on this module).
export async function deleteAccount(): Promise<void> {
  const auth = await getAuthState();
  if (!auth) return;
  const res = await authFetch("/api/account", { method: "DELETE" });
  if (!res.ok && res.status !== 401) {
    throw new Error(`account deletion failed: ${res.status} ${await res.text()}`);
  }
  await setAuthState(null);
  await wipeEncryptionState();
}

// Ask the backend to create a Polar session (checkout or customer portal) and
// open the returned hosted URL in a new tab. The user id comes from the verified
// token server-side, so a user can only act on their own subscription. Plan
// changes arrive asynchronously via the Polar webhook; callers re-sync to pick
// them up. Throws with context on failure.
async function openPolarSession(path: string): Promise<void> {
  const res = await authFetch(path, { method: "POST" });
  if (!res.ok) {
    throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
  }
  const { url } = (await res.json()) as { url: string };
  await chrome.tabs.create({ url });
}

// Open the Pro checkout (free users).
export function startUpgrade(): Promise<void> {
  return openPolarSession("/api/checkout");
}

// Open the Polar customer portal to manage/cancel the subscription (pro users).
export function openBilling(): Promise<void> {
  return openPolarSession("/api/portal");
}

// Persist a refreshed plan (e.g. after the backend reports an upgrade) without
// changing the token.
export async function updatePlan(plan: Plan): Promise<void> {
  const current = await getAuthState();
  if (!current) return;
  await setAuthState({ ...current, plan });
}

// Subscribe to account state changes across contexts. Returns an unsubscribe fn.
// The previous state comes along so listeners can tell a real account change
// from a rewrite of the same account (a token refresh, a plan update).
export function onAuthChanged(
  listener: (state: AuthState | null, previous: AuthState | null) => void
): () => void {
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string
  ): void => {
    if (area !== "local" || !(AUTH_KEY in changes)) return;
    const change = changes[AUTH_KEY];
    listener(
      (change.newValue as AuthState | undefined) ?? null,
      (change.oldValue as AuthState | undefined) ?? null
    );
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
