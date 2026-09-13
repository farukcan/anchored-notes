// Drive helpers used by the upload CLI. Kept free of process.argv so tests
// can cover the query escaping and the folder/file names without a network.

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const VIDEO_MIME = "video/mp4";
export const METADATA_MIME = "application/json";

export const DRIVE_VIDEO_NAME = "video.mp4";
export const DRIVE_METADATA_NAME = "upload-metadata.json";

/** Escape a Drive `q` string value. */
export function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export function driveChildQuery(parentId: string, title: string, mimeType: string | null): string {
  const mimeClause = mimeType ? ` and mimeType = '${mimeType}'` : "";
  return `name = '${escapeDriveQuery(title)}' and '${escapeDriveQuery(parentId)}' in parents and trashed = false${mimeClause}`;
}

/** Youtube/<channel>/<compositionId>/ — Youtube itself is YOUTUBE_DRIVE_FOLDER_ID. */
export function driveFolderNames(channelSlug: string, compositionId: string): [string, string] {
  return [channelSlug, compositionId];
}

export function isAffirmative(answer: string): boolean {
  const trimmed = answer.trim().toLowerCase();
  return trimmed === "y" || trimmed === "yes";
}
