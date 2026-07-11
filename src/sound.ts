// Synthetic error beep via Web Audio — no bundled asset needed. Used by the
// in-page toast (content script) and the popup toast. Autoplay policy may keep
// the AudioContext suspended when there's no user gesture in the toast's own
// document (e.g. a popup-triggered in-page toast); the beep then silently
// no-ops while the visual toast still shows. Errors are swallowed on purpose.

// One reused context per document. Creating a fresh context per beep would leak
// under autoplay-suspended conditions (time never advances, so oscillator
// `onended` never fires to close it) until the browser's per-document cap.
let sharedCtx: AudioContext | undefined;

function getContext(): AudioContext | undefined {
  if (sharedCtx) return sharedCtx;
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return undefined;
  sharedCtx = new Ctx();
  return sharedCtx;
}

export function playErrorBeep(): void {
  try {
    const ctx = getContext();
    if (!ctx) return;
    // A gesture may have arrived since a prior suspended beep; try to resume.
    void ctx.resume().catch(() => undefined);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    // Two short descending low tones read as an "error" cue.
    const now = ctx.currentTime;
    osc.type = "square";
    osc.frequency.setValueAtTime(220, now);
    osc.frequency.setValueAtTime(160, now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.26);
  } catch {
    // No AudioContext / suspended by autoplay policy: visual toast is enough.
  }
}
