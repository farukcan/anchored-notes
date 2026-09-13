// Locates a Chrome binary for rendering the channel templates. Nothing here
// loads an unpacked extension — the templates are plain HTML — so branded
// Chrome works and no Chrome for Testing download is needed.
import { existsSync } from "node:fs";

const CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium"
];

export function findChrome() {
  if (process.env.CHROME_PATH) {
    if (!existsSync(process.env.CHROME_PATH)) {
      throw new Error(`CHROME_PATH does not exist: ${process.env.CHROME_PATH}`);
    }
    return process.env.CHROME_PATH;
  }
  const found = CANDIDATES.find((path) => existsSync(path));
  if (!found) {
    throw new Error(`no Chrome binary found; set CHROME_PATH. Looked in:\n${CANDIDATES.join("\n")}`);
  }
  return found;
}
