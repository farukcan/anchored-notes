// A single sound effect, aligned by its peak instead of its start.
//
// Sounds do not begin at full amplitude: a whoosh may take 160ms to reach its
// loudest point. Starting one on the animation's peak therefore lands the
// audible hit late, which reads as sloppy far more readily than an early one.
// This shifts playback back by the manifest's measured `attackSeconds` so the
// two peaks coincide, and converts to frames with the composition's own fps.

import React from "react";
import { Audio, Sequence, interpolate, staticFile, useVideoConfig } from "remotion";
import { sfxEntry, type SfxName } from "./sfxTypes";

export interface SfxProps {
  name: SfxName;
  /** The moment the animation peaks, in milliseconds from the start of the video. */
  atMs: number;
  gain: number | undefined;
  pitch: number;
  fadeOutFrames: number;
}

export const Sfx: React.FC<SfxProps> = ({ name, atMs, gain, pitch, fadeOutFrames }) => {
  const { fps } = useVideoConfig();
  const entry = sfxEntry(name);

  const level = gain ?? entry.defaultGain;
  const durationInFrames = Math.max(1, Math.ceil(entry.durationSeconds * fps));

  // Playback can only begin on a frame boundary, so the start is computed once
  // in milliseconds — peak minus attack — and then floored rather than rounded.
  // Rounding splits the error either way and loses a sub-frame attack entirely
  // (a 14ms one is 0.42 frames, which rounds to nothing), leaving every short
  // sound up to 30ms late. The ear forgives early far more readily than late,
  // so the bias is deliberate.
  const startMs = atMs - entry.attackSeconds * 1000;
  const from = Math.max(0, Math.floor((startMs / 1000) * fps));

  const volumeAt = (frame: number): number => {
    if (fadeOutFrames <= 0) return level;
    return interpolate(frame, [durationInFrames - fadeOutFrames, durationInFrames], [level, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp"
    });
  };

  return (
    <Sequence from={from} durationInFrames={durationInFrames} name={`SFX ${name} @${atMs}ms`}>
      <Audio src={staticFile(entry.file)} volume={volumeAt} toneFrequency={pitch} />
    </Sequence>
  );
};
