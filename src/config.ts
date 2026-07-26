// The only hardcoded endpoint: the anchored-notes-backend base URL. Everything
// else (PocketBase URL, OAuth provider) is fetched at runtime from the backend's
// /api/config so deployments can change PocketBase without rebuilding the
// extension.

// anchored-notes-backend base URL (deployed).
export const BACKEND_URL = "https://anchored-notes.puhulab.com";

// Umami collect endpoint + website id. Leave either empty to disable analytics.
// Example URL: "https://analytics.example.com/api/send"
export const UMAMI_URL = "https://umami.puhulab.com/api/send";
export const UMAMI_WEBSITE_ID = "3a67c84d-2810-4b8a-9032-958f391640de";

// Public client configuration served by the backend.
export interface RuntimeConfig {
  pbUrl: string;
  oauthProvider: string;
}

let cached: Promise<RuntimeConfig> | null = null;

// Fetch the runtime config from the backend once and cache the promise so all
// callers share a single request. Throws with context on failure.
export function getRuntimeConfig(): Promise<RuntimeConfig> {
  if (cached === null) {
    cached = (async (): Promise<RuntimeConfig> => {
      const res = await fetch(`${BACKEND_URL}/api/config`);
      if (!res.ok) {
        throw new Error(`config fetch failed: ${res.status}`);
      }
      return (await res.json()) as RuntimeConfig;
    })();
  }
  return cached;
}
