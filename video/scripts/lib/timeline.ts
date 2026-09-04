// Loading one video's timeline from the Node side.
//
// The composition reaches the same data through a generated index, because a
// browser bundle cannot look in a directory. The scripts can, so they read the
// file — but both go through the same schema, so a timeline that would break a
// render fails at the gate instead.

import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { voiceTimelinePath } from "./paths";

export const voiceTimelineSchema = z
  .object({
    contractVersion: z.literal(1),
    scenario: z.string().min(1),
    lang: z.string().min(2),
    format: z.string().min(3),
    totalMs: z.number().positive(),
    voiceover: z.object({
      file: z.string().min(1),
      volume: z.number().min(0).max(2),
      wordCount: z.number().int().min(0),
      referenceDb: z.number()
    }),
    beats: z.record(z.string(), z.number().positive()),
    phrases: z
      .array(
        z.object({
          text: z.string().min(1),
          fromMs: z.number().min(0),
          toMs: z.number().positive(),
          beat: z.string().min(1)
        })
      )
      .min(1)
  })
  .superRefine((timeline, ctx) => {
    const summed = Object.values(timeline.beats).reduce((total, ms) => total + ms, 0);
    // Beats tile the video with no gaps: every millisecond belongs to exactly
    // one of them, which is what lets a caption be placed by beat and a step be
    // scaled into one.
    if (Math.abs(summed - timeline.totalMs) > 1) {
      ctx.addIssue({
        code: "custom",
        message: `beats sum to ${summed}ms but the video is ${timeline.totalMs}ms long`
      });
    }
    for (const phrase of timeline.phrases) {
      if (phrase.toMs <= phrase.fromMs) {
        ctx.addIssue({ code: "custom", message: `phrase "${phrase.text}" ends before it starts` });
      }
      if (timeline.beats[phrase.beat] === undefined) {
        ctx.addIssue({
          code: "custom",
          message: `phrase "${phrase.text}" names beat "${phrase.beat}", which is not in the timeline`
        });
      }
    }
  });

export type VoiceTimelineFile = z.infer<typeof voiceTimelineSchema>;

/** The timeline for one video, or null when it has no narration yet. */
export function readVoiceTimeline(
  scenario: string,
  lang: string,
  format: string
): VoiceTimelineFile | null {
  const file = voiceTimelinePath(scenario, lang, format);
  if (!existsSync(file)) return null;
  return voiceTimelineSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}
