// Write YouTube sidecars next to rendered cuts. Agents run this — operators
// do not hand-write JSON.
//
//   npm run prepare-upload
//   npm run prepare-upload -- <jobId>

import { prepareUpload, resolvePrepareTargets } from "./lib/prepare-upload";

let written: { jobId: string; file: string; title: string }[];
try {
  written = prepareUpload(resolvePrepareTargets(process.argv.slice(2)));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

console.log(JSON.stringify(written, null, 2));
