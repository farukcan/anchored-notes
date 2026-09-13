// Drive helpers used by the upload CLI. Kept free of process.argv so tests
// can cover the query escaping and the folder/file names without a network.

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const VIDEO_MIME = "video/mp4";
export const METADATA_MIME = "application/json";

export const DRIVE_VIDEO_NAME = "video.mp4";
export const DRIVE_METADATA_NAME = "upload-metadata.json";

/** Always the Drive channel folder. The CLI no longer accepts a slug. */
export const CHANNEL_SLUG = "anchored-notes";

export const UPLOAD_USAGE =
  "Usage: npm run upload -- <jobId>\n" +
  "  jobId: <scenario>/<lang>/<format>  or  <scenario>-<lang>-<format>";

/** Escape a Drive `q` string value. */
export function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function driveChildQuery(parentId: string, title: string, mimeType: string | null): string {
  const mimeClause = mimeType ? ` and mimeType = '${mimeType}'` : "";
  return `name = '${escapeDriveQuery(title)}' and '${escapeDriveQuery(parentId)}' in parents and trashed = false${mimeClause}`;
}

/** Youtube/anchored-notes/<compositionId>/ — Youtube itself is YOUTUBE_DRIVE_FOLDER_ID. */
export function driveFolderNames(compositionId: string): [string, string] {
  return [CHANNEL_SLUG, compositionId];
}

/**
 * Same contract as RemotionLab: read YOUTUBE_DRIVE_FOLDER_ID from .env,
 * no fallback name and no default id.
 */
export function requireYoutubeDriveFolderId(env: NodeJS.ProcessEnv = process.env): string {
  const id = env.YOUTUBE_DRIVE_FOLDER_ID;
  if (!id) {
    throw new Error("YOUTUBE_DRIVE_FOLDER_ID is not set in .env (Drive id of the 'Youtube' folder).");
  }
  return id;
}

/** One positional jobId. The old `<channelSlug> <jobId>` form is rejected. */
export function parseUploadCliArgs(argv: string[]): string {
  if (argv.length === 2) {
    throw new Error(
      `channelSlug is no longer an argument; channel is always "${CHANNEL_SLUG}".\n${UPLOAD_USAGE}`
    );
  }
  const jobId = argv[0]?.trim();
  if (argv.length !== 1 || !jobId) {
    throw new Error(UPLOAD_USAGE);
  }
  return jobId;
}

export interface UploadResultFile {
  id: string;
  webViewLink: string;
}

export interface UploadResult {
  channel: string;
  jobId: string;
  path: string;
  folderId: string;
  video: UploadResultFile;
  metadata: UploadResultFile;
}

function requireDriveFileRefs(
  label: string,
  file: { id?: string | null; webViewLink?: string | null }
): UploadResultFile {
  if (!file.id || !file.webViewLink) {
    throw new Error(`Drive ${label} upload did not return id and webViewLink`);
  }
  return { id: file.id, webViewLink: file.webViewLink };
}

/** Stdout payload: only file ids and webViewLinks, plus the Drive path. */
export function formatUploadResult(input: {
  jobId: string;
  path: string;
  folderId: string;
  video: { id?: string | null; webViewLink?: string | null };
  metadata: { id?: string | null; webViewLink?: string | null };
}): UploadResult {
  return {
    channel: CHANNEL_SLUG,
    jobId: input.jobId,
    path: input.path,
    folderId: input.folderId,
    video: requireDriveFileRefs("video", input.video),
    metadata: requireDriveFileRefs("metadata", input.metadata)
  };
}

export function isAffirmative(answer: string): boolean {
  const trimmed = answer.trim().toLowerCase();
  return trimmed === "y" || trimmed === "yes";
}
