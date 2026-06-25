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

import { getRuntimeConfig } from "./config.js";
import { getAuthState } from "./auth.js";

const NOTES_TOPIC = "notes/*";

interface ConnectEvent {
  clientId: string;
}

// Opens a realtime subscription and invokes onChange on every notes event.
// Returns a disconnect function.
export function connectRealtime(onChange: () => void): () => void {
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
      const res = await fetch(realtimeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: auth.token },
        body: JSON.stringify({ clientId, subscriptions: [NOTES_TOPIC] }),
      });
      if (!res.ok) {
        console.warn(`[anchored-notes] realtime subscribe failed: ${res.status}`);
        // Bad/expired token: stop here instead of letting EventSource reconnect
        // and re-POST forever. The content lifecycle reconnects on the next auth
        // change, and sync's own 401 handling signs the user out.
        if (res.status === 401) disconnect();
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
