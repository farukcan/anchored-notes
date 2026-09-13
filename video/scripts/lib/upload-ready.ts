// Local gates the Drive CLI runs before it asks for confirmation or opens
// a network socket: the render exists, the sidecar parses, check-video passes.

import { existsSync, readFileSync } from "node:fs";
import { parseUploadMetadata, type UploadMetadata } from "./upload-metadata";
import { uploadMetadataPath, videoPath } from "./paths";
import type { UploadTarget } from "./job-id";

export interface UploadReady {
  videoFile: string;
  metadataFile: string;
  metadata: UploadMetadata;
}

export function assertUploadFiles(
  target: UploadTarget,
  paths?: { videoFile?: string; metadataFile?: string }
): UploadReady {
  const videoFile = paths?.videoFile ?? videoPath(target.scenario, target.lang, target.format);
  if (!existsSync(videoFile)) {
    throw new Error(`Rendered video not found: ${videoFile}. Render before uploading.`);
  }

  const metadataFile =
    paths?.metadataFile ?? uploadMetadataPath(target.scenario, target.lang, target.format);
  if (!existsSync(metadataFile)) {
    throw new Error(
      `upload-metadata.json not found at ${metadataFile}; write title/description/tags before uploading.`
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(metadataFile, "utf8"));
  } catch {
    throw new Error(`${metadataFile} is not valid JSON`);
  }

  try {
    return {
      videoFile,
      metadataFile,
      metadata: parseUploadMetadata(raw)
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${metadataFile}: ${detail}`);
  }
}
