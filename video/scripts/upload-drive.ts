// Upload one rendered marketing video and its YouTube sidecar to Drive.
//
//   npm run upload -- <channelSlug> <jobId>
//
// jobId is scenario/lang/format (or the Remotion composition id). The script
// refuses to talk to Drive until check-video passes, the sidecar parses, and
// the operator types yes.

import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin, stderr } from "node:process";
import { execFileSync } from "node:child_process";
import { config as loadEnv } from "dotenv";
import { google } from "googleapis";
import type { drive_v3 } from "googleapis";
import { join } from "node:path";
import {
  compositionId,
  parseChannelSlug,
  parseJobId,
  slashJobId
} from "./lib/job-id";
import { assertUploadFiles } from "./lib/upload-ready";
import {
  DRIVE_METADATA_NAME,
  DRIVE_SCOPE,
  DRIVE_VIDEO_NAME,
  FOLDER_MIME,
  METADATA_MIME,
  VIDEO_MIME,
  driveChildQuery,
  driveFolderNames,
  isAffirmative
} from "./lib/drive";
import { videoRoot } from "./lib/paths";

loadEnv({ path: join(videoRoot, ".env"), quiet: true });

const [channelArg, jobArg] = process.argv.slice(2);
if (!channelArg || !jobArg) {
  console.error("Usage: npm run upload -- <channelSlug> <jobId>");
  console.error("  jobId: <scenario>/<lang>/<format>  or  <scenario>-<lang>-<format>");
  process.exit(1);
}

const youtubeFolderId = process.env.YOUTUBE_DRIVE_FOLDER_ID;
if (!youtubeFolderId) {
  throw new Error("YOUTUBE_DRIVE_FOLDER_ID is not set in .env (Drive id of the 'Youtube' folder).");
}
if (!stdin.isTTY) {
  throw new Error("refusing to upload without a TTY — confirm in an interactive terminal");
}

const channelSlug = parseChannelSlug(channelArg);
const target = parseJobId(jobArg);
const jobId = compositionId(target);
const files = assertUploadFiles(target);

runCheckVideo(target.scenario, target.lang, target.format);

await confirmUpload({
  channelSlug,
  jobId,
  slashId: slashJobId(target),
  videoFile: files.videoFile,
  metadataFile: files.metadataFile,
  title: files.metadata.title
});

const auth = new google.auth.GoogleAuth({ scopes: [DRIVE_SCOPE] });
const drive = google.drive({ version: "v3", auth });

const [channelFolder, jobFolder] = driveFolderNames(channelSlug, jobId);
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
    {
      channel: channelSlug,
      jobId,
      path: slashJobId(target),
      folderId: jobFolderId,
      video: { id: video.id, webViewLink: video.webViewLink },
      metadata: { id: metadata.id, webViewLink: metadata.webViewLink }
    },
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
  channelSlug: string;
  jobId: string;
  slashId: string;
  videoFile: string;
  metadataFile: string;
  title: string;
}): Promise<void> {
  const prompt =
    `Upload "${plan.title}" (${plan.slashId}) to Youtube/${plan.channelSlug}/${plan.jobId}/ ?\n` +
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
    fields: "files(id, name)",
    pageSize: 1
  });
  const files = res.data.files ?? [];
  return files.length > 0 ? (files[0].id ?? null) : null;
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

async function deleteChildIfExists(drive: drive_v3.Drive, parentId: string, title: string): Promise<void> {
  const existing = await findChild(drive, parentId, title, null);
  if (!existing) return;
  await drive.files.delete({ fileId: existing });
}

async function uploadFile(
  drive: drive_v3.Drive,
  parentId: string,
  title: string,
  filePath: string,
  mimeType: string
): Promise<drive_v3.Schema$File> {
  await deleteChildIfExists(drive, parentId, title);
  const res = await drive.files.create({
    requestBody: { name: title, parents: [parentId] },
    media: { mimeType, body: createReadStream(filePath) },
    fields: "id, name, webViewLink"
  });
  return res.data;
}
