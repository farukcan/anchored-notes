// Privacy-friendly product analytics via Umami's HTTP collect API (no script
// tag — Chrome extension CSP / MV3 friendly). Failures are swallowed so
// analytics never block the user.
//
// Identifiers: a locally generated UUID (`anonymousIdentifier`) — never email
// or other account PII — so Chrome Web Store privacy policies are respected.

import { UMAMI_URL, UMAMI_WEBSITE_ID } from "./config.js";

/** Where a user-initiated action originated (for funnel breakdowns). */
export type TrackSource =
  | "popup"
  | "context_menu"
  | "card"
  | "options"
  | "badge"
  | "append_fallback";

const EDIT_WINDOW_MS = 30 * 60 * 1000;
const LAST_NOTE_EDITED_KEY = "umamiLastNoteEditedAt";
const ENC_WARN_SHOWN_KEY = "umamiEncWarnShown";
const ANON_ID_KEY = "anonymousIdentifier";

// Storage keys mirrored from auth.ts / storage.ts (avoid importing those modules
// so umami stays free of circular deps with auth callers).
const AUTH_KEY = "auth";
const NOTES_KEY = "notes";

type AuthSnap = { plan?: string };
type NotesSnap = Record<string, unknown>;

/** Stable per-install UUID kept in chrome.storage.local; created on first use. */
async function getOrCreateAnonymousId(): Promise<string> {
  const result = await chrome.storage.local.get(ANON_ID_KEY);
  const existing = result[ANON_ID_KEY];
  if (typeof existing === "string" && existing.length > 0) return existing;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [ANON_ID_KEY]: id });
  return id;
}

async function baseData(
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const [anonymousIdentifier, result] = await Promise.all([
    getOrCreateAnonymousId(),
    chrome.storage.local.get([AUTH_KEY, NOTES_KEY]),
  ]);
  const auth = result[AUTH_KEY] as AuthSnap | undefined;
  const notes = result[NOTES_KEY] as NotesSnap | undefined;
  return {
    anonymousIdentifier,
    noteCount: notes ? Object.keys(notes).length : 0,
    plan: auth?.plan ?? "anon",
    ...extra,
  };
}

/** Send a named event to Umami. No-op when URL/website id are unset. */
export async function track(
  eventName: string,
  extraData: Record<string, unknown> = {},
): Promise<void> {
  if (!UMAMI_URL || !UMAMI_WEBSITE_ID) return;
  try {
    const data = await baseData(extraData);
    await fetch(UMAMI_URL, {
      method: "POST",
      // keepalive: survive MV3 service-worker teardown after fire-and-forget calls
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "event",
        payload: {
          website: UMAMI_WEBSITE_ID,
          hostname: "anchored-notes.puhulab.com",
          url: "/extension/" + eventName,
          name: eventName,
          data: {
            ts: new Date().toISOString(),
            ...data,
          },
        },
      }),
    });
  } catch {
    // Analytics must never block the user.
  }
}

/**
 * Fire `note_edited` at most once per 30-minute window (extension session
 * storage). Call when the user actually persists a content change.
 */
export async function trackNoteEdited(
  extraData: Record<string, unknown> = {},
): Promise<void> {
  if (!UMAMI_URL || !UMAMI_WEBSITE_ID) return;
  const now = Date.now();
  const res = await chrome.storage.session.get(LAST_NOTE_EDITED_KEY);
  const last = res[LAST_NOTE_EDITED_KEY] as number | undefined;
  if (typeof last === "number" && now - last < EDIT_WINDOW_MS) return;
  await chrome.storage.session.set({ [LAST_NOTE_EDITED_KEY]: now });
  await track("note_edited", extraData);
}

/** Fire `enc_password_required_shown` once per browser session. */
export async function trackEncPasswordRequiredShown(): Promise<void> {
  if (!UMAMI_URL || !UMAMI_WEBSITE_ID) return;
  const res = await chrome.storage.session.get(ENC_WARN_SHOWN_KEY);
  if (res[ENC_WARN_SHOWN_KEY]) return;
  await chrome.storage.session.set({ [ENC_WARN_SHOWN_KEY]: true });
  await track("enc_password_required_shown");
}
