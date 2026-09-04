// Where the overlays sit.
//
// Placement is read out of the frame the camera actually produced rather than
// out of the scenario, because a beat is not one shot: the drag beat pulls all
// the way back and then pushes in again, and a height chosen for the beat is
// wrong for half of it.

/**
 * How long the hook stays legible, and how long its settle takes.
 *
 * It is fully opaque on the very first frame: a hook that fades up spends the
 * only second that matters being unreadable. The settle is motion under text
 * that can already be read, not an entrance.
 */
export const HOOK_SETTLE_MS = 320;
const HOOK_HOLD_MS = 2100;
const HOOK_OUT_MS = 420;

/** How long the hook is on screen in total, settle and exit included. */
export const HOOK_TOTAL_MS = HOOK_HOLD_MS + HOOK_OUT_MS;

/** 1 while the hook is up, falling to 0 as it leaves. */
export function hookProgressAt(timeMs: number): number {
  if (timeMs < 0) return 0;
  if (timeMs < HOOK_HOLD_MS) return 1;
  const leaving = timeMs - HOOK_HOLD_MS;
  if (leaving >= HOOK_OUT_MS) return 0;
  return 1 - leaving / HOOK_OUT_MS;
}
