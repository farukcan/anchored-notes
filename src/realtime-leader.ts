// One visible signed-in tab holds the PocketBase realtime EventSource.
// The service worker is too short-lived for SSE, and we do not use an
// offscreen document (that would add a store permission). A session lease
// stops every tab from opening its own connection.

export const REALTIME_LEADER_KEY = "realtimeLeader";
export const LEADER_TTL_MS = 20_000;
export const LEADER_HEARTBEAT_MS = 8_000;

export interface RealtimeLeaderLease {
  tabId: number;
  token: string;
  expiresAt: number;
}

async function readLease(): Promise<RealtimeLeaderLease | undefined> {
  const result = await chrome.storage.session.get(REALTIME_LEADER_KEY);
  const lease = result[REALTIME_LEADER_KEY] as RealtimeLeaderLease | undefined;
  if (!lease || typeof lease.tabId !== "number" || typeof lease.token !== "string") {
    return undefined;
  }
  return lease;
}

// Acquire or renew the lease for `tabId`. Returns false when another tab holds
// a still-valid lease.
export async function holdLeadership(tabId: number): Promise<boolean> {
  if (tabId < 0) return false;
  const now = Date.now();
  const current = await readLease();
  if (current && current.tabId !== tabId && current.expiresAt > now) return false;
  if (current?.tabId === tabId && current.expiresAt > now + LEADER_HEARTBEAT_MS) return true;
  const token = current?.tabId === tabId ? current.token : crypto.randomUUID();
  const lease: RealtimeLeaderLease = { tabId, token, expiresAt: now + LEADER_TTL_MS };
  await chrome.storage.session.set({ [REALTIME_LEADER_KEY]: lease });
  const confirmed = await readLease();
  return confirmed?.token === token && confirmed.tabId === tabId;
}

export async function releaseLeadership(tabId: number): Promise<void> {
  const current = await readLease();
  if (current?.tabId !== tabId) return;
  await chrome.storage.session.remove(REALTIME_LEADER_KEY);
}
