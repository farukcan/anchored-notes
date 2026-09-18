// PocketBase realtime (SSE) subscription to the signed-in user's own notes, so
// changes made on other devices appear live in open tabs. This only watches:
// on any notes event it calls onChange, and the caller triggers a normal sync
// (the single reconciliation path) rather than mutating storage here.
//
// Flow (see PocketBase realtime API): open an EventSource to /api/realtime; the
// server sends a PB_CONNECT event carrying a clientId; POST that clientId with
// the subscription topic and the user's token (collection subscriptions honor
// the collection listRule, so each user only receives their own notes' events).
// EventSource auto-reconnects on drop and emits a fresh PB_CONNECT, so we simply
// re-subscribe whenever PB_CONNECT arrives.
//
// The subscribe POST is issued by the background worker when the caller is a
// content script, so the page's CSP never sees the token. The 401 handling
// matches authFetch: refresh once and retry; only a confirmed dead session
// gives up.

import { getRuntimeConfig } from "./config.js";
import { getAuthState, refreshAuthToken } from "./auth.js";
import type { Message, RealtimeSubscribeResponse } from "./types.js";

const NOTES_TOPIC = "notes/*";
const CLIENT_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

interface ConnectEvent {
  clientId: string;
}

export function realtimeSubscribeUrl(pbUrl: string): string {
  return `${pbUrl.replace(/\/$/, "")}/api/realtime`;
}

function isAllowedSubscribe(pbUrl: string, realtimeUrl: string, clientId: string): boolean {
  return realtimeUrl === realtimeSubscribeUrl(pbUrl) && CLIENT_ID_RE.test(clientId);
}

function postSubscription(realtimeUrl: string, clientId: string, token: string): Promise<Response> {
  return fetch(realtimeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ clientId, subscriptions: [NOTES_TOPIC] }),
  });
}

export interface SubscribeResult {
  status: number;
  gaveUp: boolean;
}

// Handshake POST after PB_CONNECT. Exported so the background worker can run
// it on behalf of a content script (page CSP/CORS must not see the token).
export async function subscribeRealtime(realtimeUrl: string, clientId: string): Promise<SubscribeResult> {
  const { pbUrl } = await getRuntimeConfig();
  if (!isAllowedSubscribe(pbUrl, realtimeUrl, clientId)) {
    console.warn("[anchored-notes] realtime subscribe: refused unexpected target");
    return { status: 0, gaveUp: false };
  }
  const auth = await getAuthState();
  if (!auth) return { status: 0, gaveUp: false };
  try {
    let res = await postSubscription(realtimeUrl, clientId, auth.token);
    if (res.status === 401) {
      const refresh = await refreshAuthToken();
      if (refresh.status === "unavailable") {
        console.warn("[anchored-notes] realtime subscribe: token refresh unavailable");
        return { status: res.status, gaveUp: false };
      }
      if (refresh.status === "refreshed") {
        res = await postSubscription(realtimeUrl, clientId, refresh.state.token);
      }
    }
    if (!res.ok) {
      console.warn(`[anchored-notes] realtime subscribe failed: ${res.status}`);
    }
    return { status: res.status, gaveUp: res.status === 401 };
  } catch (err) {
    console.warn("[anchored-notes] realtime subscribe error:", err);
    return { status: 0, gaveUp: false };
  }
}

async function runSubscribe(
  realtimeUrl: string,
  clientId: string,
  closed: () => boolean,
): Promise<SubscribeResult> {
  if (typeof window !== "undefined" && chrome.runtime?.sendMessage) {
    const message: Message = { type: "REALTIME_SUBSCRIBE", realtimeUrl, clientId };
    const res = (await chrome.runtime.sendMessage(message)) as RealtimeSubscribeResponse | undefined;
    if (!res?.ok) return { status: 0, gaveUp: false };
    return { status: res.status, gaveUp: res.gaveUp };
  }
  if (closed()) return { status: 0, gaveUp: false };
  return subscribeRealtime(realtimeUrl, clientId);
}

export type RealtimeCloseReason = "gaveUp" | "connectFailed" | "setupFailed" | "timedOut";

const HANDSHAKE_TIMEOUT_MS = 10_000;

// Opens a realtime subscription and invokes onChange on every notes event.
// onClosed fires when this connection stops on its own: a confirmed-dead
// session (`gaveUp`), an EventSource that never handshakes (`connectFailed`),
// a handshake timeout (`timedOut`), or a config fetch error (`setupFailed`).
// Caller disconnect does not fire it.
export function connectRealtime(
  onChange: () => void,
  onClosed: (reason: RealtimeCloseReason) => void,
): () => void {
  let source: EventSource | null = null;
  let closed = false;
  let connected = false;
  let handshakeTimer: ReturnType<typeof setTimeout> | undefined;

  const disconnect = (): void => {
    closed = true;
    if (handshakeTimer !== undefined) {
      clearTimeout(handshakeTimer);
      handshakeTimer = undefined;
    }
    source?.close();
    source = null;
  };

  const fail = (reason: RealtimeCloseReason): void => {
    if (closed) return;
    disconnect();
    onClosed(reason);
  };

  const subscribe = async (realtimeUrl: string, clientId: string): Promise<void> => {
    if (closed) return;
    const result = await runSubscribe(realtimeUrl, clientId, () => closed);
    if (closed) return;
    if (result.gaveUp) fail("gaveUp");
  };

  void (async (): Promise<void> => {
    try {
      const { pbUrl } = await getRuntimeConfig();
      if (closed) return;
      const realtimeUrl = realtimeSubscribeUrl(pbUrl);
      source = new EventSource(realtimeUrl);
      handshakeTimer = setTimeout(() => fail("timedOut"), HANDSHAKE_TIMEOUT_MS);
      source.addEventListener("error", () => {
        if (!connected && source?.readyState === EventSource.CLOSED) fail("connectFailed");
      });
      source.addEventListener("PB_CONNECT", (event) => {
        connected = true;
        if (handshakeTimer !== undefined) {
          clearTimeout(handshakeTimer);
          handshakeTimer = undefined;
        }
        const data = JSON.parse((event as MessageEvent).data) as ConnectEvent;
        void subscribe(realtimeUrl, data.clientId);
      });
      source.addEventListener(NOTES_TOPIC, () => onChange());
    } catch (err) {
      console.warn("[anchored-notes] realtime connect:", err);
      fail("setupFailed");
    }
  })();

  return disconnect;
}
