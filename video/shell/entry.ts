// Loaded by every stubbed frame (stage and popup) *before* the extension bundle
// it hosts. Reads its configuration from the frame's own query string, installs
// the chrome stub, and exposes the shared state so the Remotion driver can reach
// into the frame later.
//
// Frames that belong to the same render share one StubState, keyed by `session`
// and parked on the top window. That is what makes a popup click land in the
// content script running in the other iframe.

import {
  createStubState,
  dispatchToContent,
  installChromeStub,
  type StubConfig,
  type StubState
} from "./chrome-stub";

export interface StubBridge {
  state: StubState;
  /** Send a Message to the content script's own onMessage listeners. */
  send: (message: unknown) => Promise<unknown>;
}

declare global {
  interface Window {
    __anStubSessions?: Map<string, StubState>;
    __anStub?: StubBridge;
  }
}

function requiredParam(params: URLSearchParams, key: string): string {
  const value = params.get(key);
  if (value === null) throw new Error(`shell: missing required query param "${key}"`);
  return value;
}

function readConfig(params: URLSearchParams): StubConfig {
  return {
    lang: requiredParam(params, "lang"),
    tabId: Number(requiredParam(params, "tabId")),
    now: Number(requiredParam(params, "now")),
    seed: Number(requiredParam(params, "seed")),
    assetBase: requiredParam(params, "assetBase"),
    version: requiredParam(params, "version"),
    siteName: requiredParam(params, "siteName")
  };
}

/**
 * One StubState per render session, held on the top window so sibling frames
 * find the same instance no matter which one loads first.
 */
function resolveState(session: string, config: StubConfig): StubState {
  const top = window.top ?? window;
  const sessions = top.__anStubSessions ?? new Map<string, StubState>();
  top.__anStubSessions = sessions;

  const existing = sessions.get(session);
  if (existing) return existing;

  const created = createStubState(config);
  sessions.set(session, created);
  return created;
}

// Configuration rides in the hash, never the query string: a page-scoped note's
// anchorKey is origin + pathname + search (src/matching.ts), so query params
// would leak render plumbing into the note's identity and its header label.
// The hash is excluded from that key by design.
const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
const role = params.get("role") === "popup" ? "popup" : "content";
const config = readConfig(params);
const state = resolveState(requiredParam(params, "session"), config);

installChromeStub(window, state, role);

// Seed the UI language the way capture.mjs does, so the extension renders in the
// same language as the page around it. initI18n() picks this up on bootstrap.
state.local.lang = config.lang;

window.__anStub = {
  state,
  send: (message: unknown): Promise<unknown> => dispatchToContent(state, message)
};
