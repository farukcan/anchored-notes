// Builds the extension and zips dist/ into a Web Store-ready package named
// after the manifest version. Requires the `zip` CLI (present on macOS/Linux).
import { execSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const zip = `anchored-notes-${version}.zip`;

execSync("node mkicons.mjs && node mklocales.mjs && node build.mjs", { stdio: "inherit" });
rmSync(zip, { force: true });
execSync(`cd dist && zip -r -X ../${zip} .`, { stdio: "inherit" });

console.log(`Packaged ${zip}`);
