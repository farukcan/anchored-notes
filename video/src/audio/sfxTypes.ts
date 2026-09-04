// The sound library as the composition sees it.
//
// The name type is derived from the manifest's own keys, so a cue naming a
// sound that does not exist is a compile error rather than a silent no-op that
// only surfaces when someone listens to the finished render.

import manifest from "../../sfx/manifest.json";

export type SfxName = keyof typeof manifest;

export type SfxRole = "ui" | "movement" | "impact" | "transition" | "feedback";

/**
 * A sound placed against a moment in the timeline.
 *
 * `atMs` is the animation's **peak or contact** moment, not its start: `<Sfx>`
 * shifts playback earlier by the sound's measured attack so the two peaks
 * coincide. Unlike the scene-relative model this is adapted from, the offset is
 * absolute — the timeline here is a flat list of steps, so there is no scene to
 * be relative to and nothing to resolve.
 */
export interface SfxCue {
  name: SfxName;
  atMs: number;
  /** Linear gain. Omit to use the manifest's `defaultGain`, which targets -14 dBFS. */
  gain?: number;
  /** Remotion `toneFrequency`. 1 = unchanged; 0.9-1.15 varies close repeats. */
  pitch?: number;
  /** Why this sound, at this moment. Surfaces in the cue sheet. */
  note: string;
}

/** The manifest fields playback depends on. The rest is selection metadata. */
interface SfxPlaybackEntry {
  file: string;
  role: string;
  durationSeconds: number;
  attackSeconds: number;
  peakDb: number;
  defaultGain: number;
}

// The JSON import widens `role` and friends to `string`; playback only needs
// the technical fields, so narrow once here instead of at every call site.
const entries = manifest as Record<string, SfxPlaybackEntry>;

export function sfxEntry(name: SfxName): SfxPlaybackEntry {
  const entry = entries[name];
  if (!entry) {
    throw new Error(`sound "${String(name)}" is not in sfx/manifest.json — run \`npm run sfx-manifest\``);
  }
  return entry;
}

export function sfxNames(): SfxName[] {
  return Object.keys(entries) as SfxName[];
}
