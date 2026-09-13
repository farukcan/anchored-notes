import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  compositionId,
  parseChannelSlug,
  parseJobId,
  slashJobId
} from "./job-id";
import { parseUploadMetadata } from "./upload-metadata";
import { driveChildQuery, escapeDriveQuery, isAffirmative } from "./drive";
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

test("parseChannelSlug is kebab-case only", () => {
  assert.equal(parseChannelSlug("anchored-notes"), "anchored-notes");
  assert.throws(() => parseChannelSlug("Anchored Notes"), /kebab-case/);
  assert.throws(() => parseChannelSlug("-leading"), /kebab-case/);
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
