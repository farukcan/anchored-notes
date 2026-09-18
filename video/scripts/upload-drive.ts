// Upload one rendered marketing video and its YouTube sidecar to Drive.
//
//   npm run upload -- <jobId>
//
// Channel is always `anchored-notes`. jobId is scenario/lang/format (or the
// Remotion composition id). The script refuses to talk to Drive until
// check-video passes, the sidecar parses, and the operator types yes.
//
// JSON this command *reads*: out/<scenario>/<lang>/<format>.upload-metadata.json
//   { title, description, tags } — written by `npm run prepare-upload`.
// JSON this command *writes* to stdout (only): folder + file id / webViewLink.

import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stderr } from "node:process";
import { execFileSync } from "node:child_process";
import { config as loadEnv } from "dotenv";
import { google } from "googleapis";
import type { drive_v3 } from "googleapis";
import { join } from "node:path";
import { compositionId, parseJobId, slashJobId } from "./lib/job-id";
import { assertUploadFiles } from "./lib/upload-ready";
import {
  CHANNEL_SLUG,
  DRIVE_METADATA_NAME,
  DRIVE_SCOPE,
  DRIVE_VIDEO_NAME,
  FOLDER_MIME,
  METADATA_MIME,
  VIDEO_MIME,
  driveChildQuery,
  driveFolderNames,
  formatUploadResult,
  isAffirmative,
  parseUploadCliArgs,
  requireYoutubeDriveFolderId
} from "./lib/drive";
import { videoRoot } from "./lib/paths";

loadEnv({ path: join(videoRoot, ".env"), quiet: true });

let jobArg: string;
try {
  jobArg = parseUploadCliArgs(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const youtubeFolderId = requireYoutubeDriveFolderId();
if (!stdin.isTTY) {
  throw new Error("refusing to upload without a TTY — confirm in an interactive terminal");
}

const target = parseJobId(jobArg);
const jobId = compositionId(target);
const files = assertUploadFiles(target);

runCheckVideo(target.scenario, target.lang, target.format);

await confirmUpload({
  jobId,
  slashId: slashJobId(target),
  videoFile: files.videoFile,
  metadataFile: files.metadataFile,
  title: files.metadata.title
});

const auth = new google.auth.GoogleAuth({ scopes: [DRIVE_SCOPE] });
const drive = google.drive({ version: "v3", auth });

const [channelFolder, jobFolder] = driveFolderNames(jobId);
const channelFolderId = await ensureFolder(drive, youtubeFolderId, channelFolder);
const jobFolderId = await ensureFolder(drive, channelFolderId, jobFolder);

const video = await uploadFile(drive, jobFolderId, DRIVE_VIDEO_NAME, files.videoFile, VIDEO_MIME);
const metadata = await uploadFile(
  drive,
  jobFolderId,
  DRIVE_METADATA_NAME,
  files.metadataFile,
  METADATA_MIME
);

console.log(
  JSON.stringify(
    formatUploadResult({
      jobId,
      path: slashJobId(target),
      folderId: jobFolderId,
      video,
      metadata
    }),
    null,
    2
  )
);

function runCheckVideo(scenario: string, lang: string, format: string): void {
  const tsx = join(videoRoot, "node_modules", "tsx", "dist", "cli.mjs");
  const script = join(videoRoot, "scripts", "check-video.ts");
  const runner = existsSync(tsx) ? tsx : "tsx";
  execFileSync(runner, [script, scenario, lang, format], {
    cwd: videoRoot,
    stdio: ["ignore", stderr, stderr]
  });
}

async function confirmUpload(plan: {
  jobId: string;
  slashId: string;
  videoFile: string;
  metadataFile: string;
  title: string;
}): Promise<void> {
  const prompt =
    `Upload "${plan.title}" (${plan.slashId}) to Youtube/${CHANNEL_SLUG}/${plan.jobId}/ ?\n` +
    `  video    ${plan.videoFile}\n` +
    `  metadata ${plan.metadataFile}\n` +
    `Type yes to continue: `;

  const rl = createInterface({ input: stdin, output: stderr });
  try {
    const answer = await rl.question(prompt);
    if (!isAffirmative(answer)) {
      throw new Error("upload cancelled");
    }
  } finally {
    rl.close();
  }
}

async function findChild(
  drive: drive_v3.Drive,
  parentId: string,
  title: string,
  mimeType: string | null
): Promise<string | null> {
  const res = await drive.files.list({
    q: driveChildQuery(parentId, title, mimeType),
    fields: "files(id, name)"
  });
  const files = res.data.files ?? [];
  // Duplicates can only come from an earlier interrupted run; surface them
  // (stderr — stdout is reserved for the result JSON) rather than silently
  // picking one forever.
  if (files.length > 1) {
    console.warn(`${files.length} Drive entries named '${title}' under ${parentId}; using ${files[0].id}`);
  }
  return files[0]?.id ?? null;
}

async function ensureFolder(drive: drive_v3.Drive, parentId: string, title: string): Promise<string> {
  const existing = await findChild(drive, parentId, title, FOLDER_MIME);
  if (existing) return existing;
  const res = await drive.files.create({
    requestBody: { name: title, mimeType: FOLDER_MIME, parents: [parentId] },
    fields: "id"
  });
  if (!res.data.id) throw new Error(`Failed to create folder '${title}' under ${parentId}.`);
  return res.data.id;
}

// Re-uploads replace the existing file's media in place instead of deleting
// and re-creating it: a failed upload then leaves the previous version intact,
// and the file id (and every shared webViewLink) stays stable across runs.
async function uploadFile(
  drive: drive_v3.Drive,
  parentId: string,
  title: string,
  filePath: string,
  mimeType: string
): Promise<drive_v3.Schema$File> {
  const existing = await findChild(drive, parentId, title, null);
  const media = { mimeType, body: createReadStream(filePath) };
  const fields = "id, name, webViewLink";
  const res = existing
    ? await drive.files.update({ fileId: existing, media, fields })
    : await drive.files.create({ requestBody: { name: title, parents: [parentId] }, media, fields });
  return res.data;
}
