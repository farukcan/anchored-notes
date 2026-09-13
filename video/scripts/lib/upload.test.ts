import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { compositionId, parseJobId, slashJobId } from "./job-id";
import { parseUploadMetadata } from "./upload-metadata";
import {
  STORE_LISTING_URL,
  buildUploadMetadata,
  parsePrepareUploadArgs,
  writeUploadMetadata,
  youtubeTitle
} from "./prepare-upload";
import {
  CHANNEL_SLUG,
  driveChildQuery,
  driveFolderNames,
  escapeDriveQuery,
  formatUploadResult,
  isAffirmative,
  parseUploadCliArgs,
  requireYoutubeDriveFolderId
} from "./drive";
import { assertUploadFiles } from "./upload-ready";

const scratch = mkdtempSync(join(tmpdir(), "anchored-upload-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

test("parseJobId accepts slash and composition spellings", () => {
  const slash = parseJobId("kyoto-basics/en/16-9");
  const dash = parseJobId("kyoto-basics-en-9-16");
  assert.deepEqual(slash, { scenario: "kyoto-basics", lang: "en", format: "16-9" });
  assert.deepEqual(dash, { scenario: "kyoto-basics", lang: "en", format: "9-16" });
  assert.equal(compositionId(slash), "kyoto-basics-en-16-9");
  assert.equal(slashJobId(dash), "kyoto-basics/en/9-16");
});

test("parseJobId rejects unknown scenarios, langs, and shapes", () => {
  assert.throws(() => parseJobId("not-a-job"), /not <scenario>/);
  assert.throws(() => parseJobId("unknown/en/16-9"), /unknown scenario/);
  assert.throws(() => parseJobId("kyoto-basics/de/16-9"), /no copy for "de"/);
  assert.throws(() => parseJobId("kyoto-basics/en/1-1"), /not <scenario>/);
});

test("upload CLI takes only a jobId; channel is always anchored-notes", () => {
  assert.equal(parseUploadCliArgs(["kyoto-basics/en/16-9"]), "kyoto-basics/en/16-9");
  assert.equal(parseUploadCliArgs(["  kyoto-basics-en-16-9  "]), "kyoto-basics-en-16-9");
  assert.throws(
    () => parseUploadCliArgs(["anchored-notes", "kyoto-basics/en/16-9"]),
    /channelSlug is no longer an argument/
  );
  assert.throws(() => parseUploadCliArgs([]), /Usage: npm run upload -- <jobId>/);
  assert.throws(() => parseUploadCliArgs([""]), /Usage: npm run upload -- <jobId>/);
  assert.throws(() => parseUploadCliArgs(["a", "b", "c"]), /Usage: npm run upload -- <jobId>/);
  assert.deepEqual(driveFolderNames("kyoto-basics-en-16-9"), [
    CHANNEL_SLUG,
    "kyoto-basics-en-16-9"
  ]);
  assert.equal(CHANNEL_SLUG, "anchored-notes");
});

test("YOUTUBE_DRIVE_FOLDER_ID has no fallback name or default", () => {
  assert.equal(
    requireYoutubeDriveFolderId({ YOUTUBE_DRIVE_FOLDER_ID: "folder-id" }),
    "folder-id"
  );
  assert.throws(() => requireYoutubeDriveFolderId({}), /YOUTUBE_DRIVE_FOLDER_ID is not set in \.env/);
  assert.throws(
    () => requireYoutubeDriveFolderId({ DRIVE_FOLDER_ID: "other" }),
    /YOUTUBE_DRIVE_FOLDER_ID is not set in \.env/
  );
});

test("stdout result JSON requires file id and webViewLink", () => {
  const result = formatUploadResult({
    jobId: "kyoto-basics-en-16-9",
    path: "kyoto-basics/en/16-9",
    folderId: "folder-1",
    video: { id: "vid-1", webViewLink: "https://drive.google.com/file/d/vid-1/view" },
    metadata: { id: "meta-1", webViewLink: "https://drive.google.com/file/d/meta-1/view" }
  });
  assert.deepEqual(result, {
    channel: "anchored-notes",
    jobId: "kyoto-basics-en-16-9",
    path: "kyoto-basics/en/16-9",
    folderId: "folder-1",
    video: { id: "vid-1", webViewLink: "https://drive.google.com/file/d/vid-1/view" },
    metadata: { id: "meta-1", webViewLink: "https://drive.google.com/file/d/meta-1/view" }
  });
  assert.throws(
    () =>
      formatUploadResult({
        jobId: "kyoto-basics-en-16-9",
        path: "kyoto-basics/en/16-9",
        folderId: "folder-1",
        video: { id: "vid-1" },
        metadata: { id: "meta-1", webViewLink: "https://drive.google.com/file/d/meta-1/view" }
      }),
    /video upload did not return id and webViewLink/
  );
});

test("prepare-upload derives title, description, tags from scenario copy", () => {
  const en = buildUploadMetadata({ scenario: "kyoto-basics", lang: "en", format: "9-16" });
  const tr = buildUploadMetadata({ scenario: "kyoto-basics", lang: "tr", format: "9-16" });
  const wide = buildUploadMetadata({ scenario: "kyoto-basics", lang: "en", format: "16-9" });
  const chat = buildUploadMetadata({ scenario: "ai-chat", lang: "en", format: "9-16" });

  assert.equal(en.title, "Notes That Stay");
  assert.equal(tr.title, "Notlar Yerinde Kalır");
  assert.equal(youtubeTitle("İYİ KISMI SAKLA", "tr"), "İyi Kısmı Sakla");
  assert.equal(en.title, wide.title);
  assert.equal(en.description, wide.description);
  assert.notEqual(en.title, chat.title);
  assert.match(en.description, /notes never live/);
  assert.match(en.description, /Sticky notes that stay where you put them/);
  assert.match(en.description, /Add to Chrome: /);
  assert.ok(en.description.includes(STORE_LISTING_URL));
  assert.match(tr.description, /asla durmadığı/);
  assert.match(tr.description, /Chrome'a Ekle: /);
  assert.deepEqual(en.tags, ["chrome extension", "sticky notes", "productivity", "anchored notes"]);
  assert.deepEqual(tr.tags, ["chrome eklentisi", "yapışkan notlar", "verimlilik", "anchored notes"]);
  assert.deepEqual(parseUploadMetadata(en), en);
  assert.equal(Object.keys(en).sort().join(","), "description,tags,title");
});

test("prepare-upload CLI is jobId-only and writes the sidecar", () => {
  assert.equal(parsePrepareUploadArgs([]), null);
  assert.equal(parsePrepareUploadArgs(["kyoto-basics/en/9-16"]), "kyoto-basics/en/9-16");
  assert.throws(
    () => parsePrepareUploadArgs(["anchored-notes", "kyoto-basics/en/9-16"]),
    /channelSlug is no longer an argument/
  );

  const target = { scenario: "kyoto-basics", lang: "en", format: "9-16" as const };
  const videoFile = join(scratch, "prepared.mp4");
  const metadataFile = join(scratch, "prepared.upload-metadata.json");
  writeFileSync(videoFile, "fake");
  const { metadata } = writeUploadMetadata(target, metadataFile);
  const ready = assertUploadFiles(target, { videoFile, metadataFile });
  assert.equal(ready.metadata.title, metadata.title);
});

test("upload-metadata schema requires title, description, tags", () => {
  const ok = parseUploadMetadata({
    title: "Notes That Stay",
    description: "Sticky notes that stay where you put them.",
    tags: ["chrome extension", "notes"]
  });
  assert.equal(ok.title, "Notes That Stay");
  assert.throws(() => parseUploadMetadata({ title: "x", description: "long enough", tags: [""] }));
  assert.throws(() => parseUploadMetadata({ title: "Hi", description: "", tags: ["a"] }));
});

test("Drive query escaping and child lookup", () => {
  assert.equal(escapeDriveQuery("O'Brien"), "O\\'Brien");
  assert.equal(
    driveChildQuery("parent'1", "video.mp4", null),
    "name = 'video.mp4' and 'parent\\'1' in parents and trashed = false"
  );
  assert.match(
    driveChildQuery("abc", "folder", "application/vnd.google-apps.folder"),
    /mimeType = 'application\/vnd.google-apps.folder'/
  );
});

test("confirmation accepts yes/y only", () => {
  assert.equal(isAffirmative("yes"), true);
  assert.equal(isAffirmative(" Y "), true);
  assert.equal(isAffirmative("no"), false);
  assert.equal(isAffirmative(""), false);
});

test("assertUploadFiles requires a render and a valid sidecar", () => {
  const videoFile = join(scratch, "16-9.mp4");
  const metadataFile = join(scratch, "16-9.upload-metadata.json");
  const target = { scenario: "kyoto-basics", lang: "en", format: "16-9" as const };

  assert.throws(() => assertUploadFiles(target, { videoFile, metadataFile }), /Rendered video not found/);

  writeFileSync(videoFile, "fake");
  assert.throws(() => assertUploadFiles(target, { videoFile, metadataFile }), /upload-metadata.json not found/);

  writeFileSync(metadataFile, "{not-json");
  assert.throws(() => assertUploadFiles(target, { videoFile, metadataFile }), /not valid JSON/);

  writeFileSync(metadataFile, JSON.stringify({ title: "N", description: "Stay put.", tags: ["notes"] }));
  assert.throws(() => assertUploadFiles(target, { videoFile, metadataFile }), /16-9\.upload-metadata\.json/);

  writeFileSync(metadataFile, JSON.stringify({ title: "Notes That Stay", description: "Stay put.", tags: ["notes"] }));
  const ready = assertUploadFiles(target, { videoFile, metadataFile });
  assert.equal(ready.metadata.title, "Notes That Stay");
});
