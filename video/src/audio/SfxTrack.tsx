// Every sound effect in one video.
//
// Mount this at the **composition root**, never inside a <Sequence>: a
// Sequence's `from` is parent-relative, so a nested track plays every cue late
// by that sequence's start frame — inaudible to whoever built it, obvious to a
// viewer. Cues carry absolute milliseconds, which makes that mistake visible
// here rather than silent.

import React from "react";
import { Sfx } from "./Sfx";
import type { SfxCue } from "./sfxTypes";

export interface SfxTrackProps {
  cues: readonly SfxCue[];
  /** Total length of the video. A cue past the end would never be heard. */
  durationMs: number;
}

export const SfxTrack: React.FC<SfxTrackProps> = ({ cues, durationMs }) => {
  return (
    <>
      {cues.map((cue, index) => {
        if (cue.atMs < 0 || cue.atMs >= durationMs) {
          throw new Error(
            `sfx cue "${String(cue.name)}" sits at ${cue.atMs}ms in a ${durationMs}ms video — re-derive it from the timeline`
          );
        }
        return (
          <Sfx
            key={`${String(cue.name)}-${cue.atMs}-${index}`}
            name={cue.name}
            atMs={cue.atMs}
            gain={cue.gain}
            pitch={cue.pitch ?? 1}
            fadeOutFrames={0}
          />
        );
      })}
    </>
  );
};
