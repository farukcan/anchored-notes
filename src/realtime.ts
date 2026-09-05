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
// This POST goes straight to PocketBase (not the backend authFetch wraps), so
// it applies the same rule itself: a 401 may just be an expired token, so
// refresh once and retry before giving up on the session.

import { getRuntimeConfig } from "./config.js";
import { getAuthState, refreshAuthToken } from "./auth.js";

const NOTES_TOPIC = "notes/*";

interface ConnectEvent {
  clientId: string;
}

function postSubscription(realtimeUrl: string, clientId: string, token: string): Promise<Response> {
  return fetch(realtimeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ clientId, subscriptions: [NOTES_TOPIC] }),
  });
}

// Opens a realtime subscription and invokes onChange on every notes event.
// onClosed fires if the subscription gives up on its own (a 401 that survives
// a token refresh), so the caller can drop its handle and reconnect later
// instead of holding a dead one. Returns a disconnect function.
export function connectRealtime(onChange: () => void, onClosed: () => void): () => void {
  let source: EventSource | null = null;
  let closed = false;

  const disconnect = (): void => {
    closed = true;
    source?.close();
    source = null;
  };

  const subscribe = async (realtimeUrl: string, clientId: string): Promise<void> => {
    const auth = await getAuthState();
    if (!auth || closed) return;
    try {
      let res = await postSubscription(realtimeUrl, clientId, auth.token);
      if (res.status === 401) {
        // The token expired since this context last read it: renew it and try
        // again with the fresh one, exactly like authFetch does.
        const refreshed = await refreshAuthToken();
        if (closed) return;
        if (refreshed) res = await postSubscription(realtimeUrl, clientId, refreshed.token);
      }
      // The caller can disconnect across either await. This connection is then
      // already dead, and reporting its closure would clear a handle that now
      // points at a newer, live connection.
      if (closed) return;
      if (!res.ok) {
        console.warn(`[anchored-notes] realtime subscribe failed: ${res.status}`);
        // A 401 that survives the refresh means the session is genuinely over:
        // stop here instead of letting EventSource reconnect and re-POST
        // forever. onClosed lets the caller reconnect on the next auth change,
        // and sync's own 401 handling signs the user out.
        if (res.status === 401) {
          disconnect();
          onClosed();
        }
      }
    } catch (err) {
      console.warn("[anchored-notes] realtime subscribe error:", err);
    }
  };

  void (async (): Promise<void> => {
    const { pbUrl } = await getRuntimeConfig();
    if (closed) return;
    const realtimeUrl = `${pbUrl}/api/realtime`;
    source = new EventSource(realtimeUrl);
    source.addEventListener("PB_CONNECT", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as ConnectEvent;
      void subscribe(realtimeUrl, data.clientId);
    });
    source.addEventListener(NOTES_TOPIC, () => onChange());
  })();

  return disconnect;
}
