// Fakes shared by the `node --test` suites: an in-memory chrome.storage.local
// that emits change events like the real one, and a recording fetch. Both are
// installed as globals on import, since the extension modules under test reach
// for them directly. Tests call resetFakes() between cases.
//
// Not part of any bundle: build.mjs only pulls in the four entry points.

export interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

// Handlers may return a pending promise to hold a request in flight, so tests
// can interleave other work with an unresolved call.
export type FetchHandler = (
  url: string,
  init: RequestInit | undefined
) => Response | Promise<Response>;

// The runtime config every module fetches before talking to PocketBase.
export const PB_URL = "https://pb.test";
export const BACKEND_URL = "https://anchored-notes.puhulab.com";

export const storageLocal: Record<string, unknown> = {};
export const fetchCalls: FetchCall[] = [];

type ChangeListener = (
  changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
  area: string
) => void;

const changeListeners: ChangeListener[] = [];
let handler: FetchHandler = () => new Response("unexpected request", { status: 500 });

function emitChanges(changes: Record<string, { oldValue?: unknown; newValue?: unknown }>): void {
  for (const listener of [...changeListeners]) listener(changes, "local");
}

const fakeChrome = {
  storage: {
    local: {
      get: (key: string): Promise<Record<string, unknown>> =>
        Promise.resolve(key in storageLocal ? { [key]: storageLocal[key] } : {}),
      set: (items: Record<string, unknown>): Promise<void> => {
        const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
        for (const [key, value] of Object.entries(items)) {
          changes[key] = { oldValue: storageLocal[key], newValue: value };
          storageLocal[key] = value;
        }
        emitChanges(changes);
        return Promise.resolve();
      },
      remove: (keys: string | string[]): Promise<void> => {
        const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
        for (const key of typeof keys === "string" ? [keys] : keys) {
          changes[key] = { oldValue: storageLocal[key] };
          delete storageLocal[key];
        }
        emitChanges(changes);
        return Promise.resolve();
      },
    },
    onChanged: {
      addListener: (listener: ChangeListener): void => {
        changeListeners.push(listener);
      },
      removeListener: (listener: ChangeListener): void => {
        const index = changeListeners.indexOf(listener);
        if (index !== -1) changeListeners.splice(index, 1);
      },
    },
  },
};

const fakeFetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  // getRuntimeConfig() caches its result module-side, so always answer this one.
  if (url.endsWith("/api/config")) {
    return Promise.resolve(Response.json({ pbUrl: PB_URL, oauthProvider: "google" }));
  }
  fetchCalls.push({ url, init });
  return Promise.resolve(handler(url, init));
};

Object.assign(globalThis, { chrome: fakeChrome, fetch: fakeFetch });

export function setFetchHandler(next: FetchHandler): void {
  handler = next;
}

export function resetFakes(): void {
  for (const key of Object.keys(storageLocal)) delete storageLocal[key];
  fetchCalls.length = 0;
  changeListeners.length = 0;
  handler = () => new Response("unexpected request", { status: 500 });
}

// Authorization header a recorded call carried, whatever form its init used.
export function authHeaderOf(call: FetchCall): string | null {
  return new Headers(call.init?.headers).get("Authorization");
}

// Lets every pending microtask chain settle (all fakes resolve immediately, so
// one macrotask turn is enough).
export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
