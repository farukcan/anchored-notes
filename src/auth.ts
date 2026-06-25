// Account/auth layer. Authentication runs directly against PocketBase using the
// Google OAuth2 authorization-code flow, driven by chrome.identity. The
// resulting token + plan are persisted in chrome.storage.local so any context
// (popup, content, background) can read the current account state synchronously
// after an initial async load.

import { BACKEND_URL, getRuntimeConfig } from "./config.js";

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

interface OAuth2AuthResponse {
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

  const auth = (await exchangeRes.json()) as OAuth2AuthResponse;
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
}

// Hard-delete the account and all synced notes on the backend, then sign out.
// A 401 means the token/account is already gone, so we still clear local auth.
// Callers clear local notes afterwards (storage isn't imported here to avoid a
// circular import: storage.ts depends on this module).
export async function deleteAccount(): Promise<void> {
  const auth = await getAuthState();
  if (!auth) return;
  const res = await fetch(`${BACKEND_URL}/api/account`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  if (!res.ok && res.status !== 401) {
    throw new Error(`account deletion failed: ${res.status} ${await res.text()}`);
  }
  await setAuthState(null);
}

// Persist a refreshed plan (e.g. after the backend reports an upgrade) without
// changing the token.
export async function updatePlan(plan: Plan): Promise<void> {
  const current = await getAuthState();
  if (!current) return;
  await setAuthState({ ...current, plan });
}

// Subscribe to account state changes across contexts. Returns an unsubscribe fn.
export function onAuthChanged(listener: (state: AuthState | null) => void): () => void {
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string
  ): void => {
    if (area !== "local" || !(AUTH_KEY in changes)) return;
    listener((changes[AUTH_KEY].newValue as AuthState | undefined) ?? null);
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
