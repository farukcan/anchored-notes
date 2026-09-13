// YouTube sidecar written next to a render. Same shape as RemotionLab:
// title, description, tags — nothing the composition reads.

import { z } from "zod";

export const uploadMetadataSchema = z.object({
  title: z.string().min(2),
  description: z.string().min(2),
  tags: z.array(z.string().min(1))
});

export type UploadMetadata = z.infer<typeof uploadMetadataSchema>;

export function parseUploadMetadata(raw: unknown): UploadMetadata {
  return uploadMetadataSchema.parse(raw);
}
