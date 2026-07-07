// Locates the Chrome for Testing binary used for screenshot generation.
// Branded Chrome 137+ removed --load-extension, so a Chrome for Testing
// install is required: `npm run chrome` (or set CHROME_PATH to a binary).
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export function findChrome() {
  if (process.env.CHROME_PATH) {
    if (!existsSync(process.env.CHROME_PATH)) {
      throw new Error(`CHROME_PATH does not exist: ${process.env.CHROME_PATH}`);
    }
    return process.env.CHROME_PATH;
  }
  const root = join(HERE, "chrome");
  if (!existsSync(root)) {
    throw new Error("Chrome for Testing not found. Run: npm run chrome (in store-assets/gen)");
  }
  // Layout created by @puppeteer/browsers: chrome/<platform>-<version>/chrome-<platform>/...
  for (const entry of readdirSync(root)) {
    const macArm = join(root, entry, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    const macX64 = join(root, entry, "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    const linux = join(root, entry, "chrome-linux64/chrome");
    for (const p of [macArm, macX64, linux]) if (existsSync(p)) return p;
  }
  throw new Error(`No Chrome binary found under ${root}. Run: npm run chrome`);
}
