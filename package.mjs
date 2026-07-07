// Builds the extension and zips dist/ into a Web Store-ready package named
// after the manifest version. Requires the `zip` CLI (present on macOS/Linux).
import { execSync } from "node:child_process";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const zip = `anchored-notes-${version}.zip`;

execSync("node mkicons.mjs && node mklocales.mjs && node build.mjs", { stdio: "inherit" });

// The manifest `key` only pins the unpacked dev build to the store extension
// id; the uploaded package must not carry it (CWS owns the published key).
const manifestPath = "dist/manifest.json";
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
delete manifest.key;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

rmSync(zip, { force: true });
execSync(`cd dist && zip -r -X ../${zip} .`, { stdio: "inherit" });

// Restore the dev manifest (with `key`) so dist/ stays loadable unpacked
// under the store extension id after packaging.
cpSync("manifest.json", manifestPath);

console.log(`Packaged ${zip}`);
