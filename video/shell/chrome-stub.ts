// Minimal `chrome.*` implementation that lets the real extension bundles
// (content.js, popup.js) run inside an ordinary page — specifically inside the
// iframes a Remotion composition renders. Nothing here mocks the note UI: the
// extension code is untouched, only the browser APIs beneath it are replaced.
//
// One StubState is shared by every frame (stage + popup) so the flows that cross
// contexts stay real: the popup's "add note" goes through tabs.sendMessage into
// the content script's own onMessage listener, exactly as in the browser.
//
// Determinism is part of the contract — Date.now, Math.random, crypto.randomUUID
// and fetch are pinned so two renders of the same frame produce the same pixels.

export interface StubConfig {
  /** Extension UI language seeded into storage (drives i18n.ts). */
  lang: string;
  /** Tab id handed to GET_TAB_ID; tab-scoped notes anchor to it. */
  tabId: number;
  /** Frozen wall clock. Keeps relative timestamps ("2 hours ago") stable. */
  now: number;
  /** Seed for the deterministic PRNG behind Math.random. */
  seed: number;
  /** Prefix chrome.runtime.getURL() resolves against (icons live here). */
  assetBase: string;
  /** Value returned by chrome.runtime.getManifest().version. */
  version: string;
  /** Site name served to fetchSiteNameFromManifest() (note header scope label). */
  siteName: string;
}

export interface StorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

export type StorageArea = "local" | "session";
export type StorageListener = (changes: Record<string, StorageChange>, area: StorageArea) => void;
export type MessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void
) => boolean | undefined;

export interface StubState {
  config: StubConfig;
  local: Record<string, unknown>;
  session: Record<string, unknown>;
  storageListeners: StorageListener[];
  /** Listeners registered by the content script; the popup and the driver target these. */
  contentMessageListeners: MessageListener[];
  /**
   * The page the "active tab" is showing, recorded by the content frame when it
   * installs. chrome.tabs.query must answer with this and not with the caller's
   * own location: the popup derives its PageContext from the tab URL
   * (src/popup/popup.ts), so handing it popup.html would make every page-scoped
   * note fail isNoteVisible and vanish from the popup's list.
   */
  activeTab: { url: string; title: string } | null;
  random: () => number;
  uuid: () => string;
}

/**
 * Replace a global, whichever way the engine allows. `window.chrome` is writable
 * but non-configurable in a real browser, so defineProperty throws on it;
 * `crypto.randomUUID` lives on the prototype and needs defineProperty to be
 * shadowed. Try both and fail loudly rather than render with a live global.
 */
function override(target: object, key: string, value: unknown): void {
  try {
    Object.defineProperty(target, key, { value, writable: true, configurable: true });
    return;
  } catch {
    // Non-configurable: fall through to plain assignment.
  }
  (target as Record<string, unknown>)[key] = value;
  if ((target as Record<string, unknown>)[key] !== value) {
    throw new Error(`stub: could not override "${key}"`);
  }
}

/** Deterministic PRNG (mulberry32) — replaces Math.random inside stubbed frames. */
function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Counter-backed UUIDs so note ids are identical across renders. */
function makeUuid(): () => string {
  let n = 0;
  return (): string => {
    n += 1;
    const hex = n.toString(16).padStart(12, "0");
    return `00000000-0000-4000-8000-${hex}`;
  };
}

export function createStubState(config: StubConfig): StubState {
  return {
    config,
    local: {},
    session: {},
    storageListeners: [],
    contentMessageListeners: [],
    activeTab: null,
    random: makeRandom(config.seed),
    uuid: makeUuid()
  };
}

/** chrome.storage.local.get accepts a key, a key list, or null for everything. */
function readKeys(store: Record<string, unknown>, keys: string | string[] | null): Record<string, unknown> {
  if (keys === null) return { ...store };
  const list = typeof keys === "string" ? [keys] : keys;
  const out: Record<string, unknown> = {};
  for (const key of list) {
    if (key in store) out[key] = store[key];
  }
  return out;
}

/** Fires storage listeners synchronously so a set() settles reconcile in the same tick. */
function emitChanges(
  state: StubState,
  area: StorageArea,
  changes: Record<string, StorageChange>
): void {
  if (Object.keys(changes).length === 0) return;
  for (const listener of [...state.storageListeners]) listener(changes, area);
}

function makeStorageArea(state: StubState, area: StorageArea): chrome.storage.StorageArea {
  const store = (): Record<string, unknown> => (area === "local" ? state.local : state.session);

  return {
    get: (keys: string | string[] | null): Promise<Record<string, unknown>> =>
      Promise.resolve(readKeys(store(), keys)),

    set: (items: Record<string, unknown>): Promise<void> => {
      const target = store();
      const changes: Record<string, StorageChange> = {};
      for (const [key, value] of Object.entries(items)) {
        changes[key] = { oldValue: target[key], newValue: value };
        target[key] = value;
      }
      emitChanges(state, area, changes);
      return Promise.resolve();
    },

    remove: (keys: string | string[]): Promise<void> => {
      const target = store();
      const list = typeof keys === "string" ? [keys] : keys;
      const changes: Record<string, StorageChange> = {};
      for (const key of list) {
        if (!(key in target)) continue;
        changes[key] = { oldValue: target[key], newValue: undefined };
        delete target[key];
      }
      emitChanges(state, area, changes);
      return Promise.resolve();
    }
  } as unknown as chrome.storage.StorageArea;
}

/**
 * Deliver a message to the content script's listeners and resolve with the first
 * response. Used by chrome.tabs.sendMessage (popup → content) and by the video
 * driver when it wants to exercise the real CREATE_NOTE path.
 */
export function dispatchToContent(state: StubState, message: unknown): Promise<unknown> {
  let answer: unknown;
  for (const listener of [...state.contentMessageListeners]) {
    listener(message, { id: "stub" }, (response: unknown) => {
      if (answer === undefined) answer = response;
    });
  }
  return Promise.resolve(answer);
}

/** Handles the messages the background worker would normally answer. */
function handleRuntimeMessage(state: StubState, message: unknown): Promise<unknown> {
  const type = (message as { type?: string } | null)?.type;
  if (type === "GET_TAB_ID") return Promise.resolve({ tabId: state.config.tabId });
  // SYNC, SET_APPEND_TARGET and LOGIN have no offline counterpart.
  return Promise.resolve(undefined);
}

/**
 * Replace the browser APIs the extension bundles reach for. `role` decides where
 * runtime.onMessage registrations land: content-script listeners are the ones the
 * popup and the driver dispatch into.
 */
export function installChromeStub(win: Window, state: StubState, role: "content" | "popup"): void {
  const { config } = state;

  // The content frame *is* the active tab; record it so the popup frame can ask
  // about the page rather than about itself.
  if (role === "content") {
    state.activeTab = { url: win.location.href, title: win.document.title };
  }

  const runtime = {
    getURL: (path: string): string => `${config.assetBase}${path.replace(/^\/+/, "")}`,
    getManifest: (): { version: string } => ({ version: config.version }),
    sendMessage: (message: unknown): Promise<unknown> => handleRuntimeMessage(state, message),
    openOptionsPage: (): Promise<void> => Promise.resolve(),
    onMessage: {
      addListener: (listener: MessageListener): void => {
        if (role !== "content") return;
        state.contentMessageListeners.push(listener);
      },
      removeListener: (listener: MessageListener): void => {
        const i = state.contentMessageListeners.indexOf(listener);
        if (i !== -1) state.contentMessageListeners.splice(i, 1);
      }
    },
    lastError: undefined
  };

  const storage = {
    local: makeStorageArea(state, "local"),
    session: makeStorageArea(state, "session"),
    onChanged: {
      addListener: (listener: StorageListener): void => {
        state.storageListeners.push(listener);
      },
      removeListener: (listener: StorageListener): void => {
        const i = state.storageListeners.indexOf(listener);
        if (i !== -1) state.storageListeners.splice(i, 1);
      }
    }
  };

  const tabs = {
    query: (): Promise<{ id: number; url: string; title: string }[]> => {
      const active = state.activeTab;
      if (!active) {
        return Promise.reject(
          new Error("stub: chrome.tabs.query before the content frame registered the active tab")
        );
      }
      return Promise.resolve([{ id: config.tabId, url: active.url, title: active.title }]);
    },
    sendMessage: (_tabId: number, message: unknown): Promise<unknown> =>
      dispatchToContent(state, message),
    create: (): Promise<void> => Promise.resolve()
  };

  const action = {
    setBadgeText: (): Promise<void> => Promise.resolve(),
    setBadgeBackgroundColor: (): Promise<void> => Promise.resolve(),
    openPopup: (): Promise<void> => Promise.resolve()
  };

  const stub = {
    runtime,
    storage,
    tabs,
    action,
    i18n: { getUILanguage: (): string => config.lang },
    scripting: { executeScript: (): Promise<unknown[]> => Promise.resolve([]) }
  };

  override(win, "chrome", stub);

  installDeterminism(win, state);
}

/**
 * Pin every source of nondeterminism the extension touches, and cut the network.
 * Without this the same frame renders differently between runs: relative
 * timestamps drift, note colors and ids change, analytics fire.
 */
function installDeterminism(win: Window, state: StubState): void {
  const { config } = state;

  // The frame's own intrinsics, not this module's: patching globalThis.Date here
  // would leave the iframe reading the real clock.
  const globals = win as Window & typeof globalThis;
  override(globals.Date, "now", (): number => config.now);
  override(globals.Math, "random", state.random);
  override(globals.crypto, "randomUUID", state.uuid);

  // The only request the extension makes that affects what is on screen is the
  // page's PWA manifest (it names the note header's "site" scope). Everything
  // else — analytics, backend config, PocketBase — is refused: callers already
  // swallow their own failures, and a render must never depend on the network.
  const manifestUrl = new URL("/manifest.json", win.location.href).href;
  const linked = win.document.querySelector('link[rel="manifest"]')?.getAttribute("href");
  const linkedUrl = linked ? new URL(linked, win.location.href).href : null;

  override(win, "fetch", (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === manifestUrl || url === linkedUrl) {
      const body = JSON.stringify({ name: config.siteName, short_name: config.siteName });
      return Promise.resolve(new Response(body, { headers: { "content-type": "application/json" } }));
    }
    return Promise.reject(new Error(`stub: blocked network request to ${url}`));
  });

  // Realtime sync opens an EventSource when signed in. Auth state is never
  // seeded, so this should stay unused — make a regression loud instead of
  // letting a live connection into a render.
  override(
    win,
    "EventSource",
    class {
      constructor() {
        throw new Error("stub: EventSource must not be opened during a render");
      }
    }
  );
}
