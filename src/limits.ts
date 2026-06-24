// Quota limits, the single source of truth for note caps. The limit depends on
// the account tier: anonymous (no account, one device), free, or pro. All
// enforcement reads from here so the rule stays in one place.

import { getAuthState, type Plan } from "./auth.js";

export const NOTE_LIMITS: { anonymous: number; free: number; pro: number } = {
  anonymous: 10,
  free: 20,
  pro: Infinity,
};

export function limitForPlan(plan: Plan | null): number {
  if (plan === "pro") return NOTE_LIMITS.pro;
  if (plan === "free") return NOTE_LIMITS.free;
  return NOTE_LIMITS.anonymous;
}

// Resolve the active note limit for the current account state.
export async function getCurrentLimit(): Promise<number> {
  const auth = await getAuthState();
  return limitForPlan(auth ? auth.plan : null);
}

// Format a limit for display, rendering unlimited as an infinity glyph.
export function formatLimit(limit: number): string {
  return limit === Infinity ? "∞" : String(limit);
}
