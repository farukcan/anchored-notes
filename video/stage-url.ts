// Shared stage plumbing: how a stage iframe is addressed, and how the demo notes
// are laid out on it. Imported by preview.mjs, the tests *and* the Remotion
// composition, so all three show the identical scene — keep it free of Node
// built-ins so the browser bundle can load it too.

import { LANGS } from "../store-assets/gen/i18n.mjs";
import type { AnchorScope, FormatName, NoteColor, NotesMap, Point, Rect } from "./src/types";

/** Stage viewport. Matches store-assets/gen/capture.mjs so videos and store screenshots agree. */
export const STAGE_WIDTH = 1280;
export const STAGE_HEIGHT = 800;

/**
 * Height of the browser chrome drawn above the stage, in stage pixels. It sits
 * at negative y in stage coordinates, which is what lets a zoom interpolate
 * smoothly between "the whole window" and "a region of the page".
 */
export const CHROME_HEIGHT = 92;

/**
 * A new note as src/content/index.ts newNote() makes one: centered on the
 * viewport at this size. Stated once here; the driver and scenarios read it.
 */
export const NEW_NOTE_SIZE = { w: 220, h: 200 };
export const NEW_NOTE_ORIGIN = {
  x: Math.round(STAGE_WIDTH / 2 - NEW_NOTE_SIZE.w / 2),
  y: Math.round(STAGE_HEIGHT / 2 - NEW_NOTE_SIZE.h / 2)
};

/** The whole browser window: chrome at negative y, then the page. */
export const WINDOW_VIEW: Rect = {
  x: 0,
  y: -CHROME_HEIGHT,
  width: STAGE_WIDTH,
  height: STAGE_HEIGHT + CHROME_HEIGHT
};

/**
 * A camera rect `width` stage pixels wide, centred on `at`. Scenarios say what
 * to look at and how close; the engine fits the rect to whatever canvas the
 * format asks for.
 *
 * The rect takes the shape of the canvas it will be shown on, which is what
 * makes a shot mean the same thing in both formats. A wide frame gets the
 * window's own proportions, so pulling all the way back is exactly the whole
 * window. A phone-shaped frame gets a tall slice instead: fitting a landscape
 * window into a portrait canvas leaves the page a small band adrift in the
 * middle, and no amount of pulling back improves it — the answer is to stay
 * inside the page and show less of its width.
 *
 * It is not clamped here: how much of the stage a rect actually reveals depends
 * on the canvas it is fitted to, so keeping the shot inside the window is the
 * composition's job (src/Scenario.tsx).
 */
export function shot(at: Point, width: number, format: FormatName): Rect {
  if (width <= 0 || width > STAGE_WIDTH) {
    throw new Error(`shot width ${width} is outside 1..${STAGE_WIDTH} stage pixels`);
  }
  const height =
    format === "9-16"
      ? (width * 16) / 9
      : (width * (STAGE_HEIGHT + CHROME_HEIGHT)) / STAGE_WIDTH;
  return { x: at.x - width / 2, y: at.y - height / 2, width, height };
}

/**
 * The shot every video opens on: the whole browser window.
 *
 * A viewer has to be told once what they are looking at, and the address bar is
 * what tells them — a page filling a phone screen could be anything. So even
 * vertical starts here and pushes in from it, rather than opening already
 * inside the page.
 */
export function initialView(): Rect {
  return WINDOW_VIEW;
}

/**
 * The shot a video returns to when it pulls back mid-scene.
 *
 * Not the same as where it opened. Wide can rest on the whole window all day.
 * Vertical cannot: the full window is under half a phone frame, so returning to
 * it between beats would leave the page small and adrift for most of the video.
 * Its resting shot is the widest slice that still fills the frame — the opening
 * is the one moment worth showing the window whole.
 */
export function homeView(format: FormatName): Rect {
  if (format !== "9-16") return WINDOW_VIEW;
  // The tallest portrait rect the stage can supply, so the browser fills the
  // frame top to bottom with the chrome still in shot.
  const width = Math.floor(((STAGE_HEIGHT + CHROME_HEIGHT) * 9) / 16);
  return shot({ x: STAGE_WIDTH / 2, y: (STAGE_HEIGHT - CHROME_HEIGHT) / 2 }, width, format);
}

/** The widest a vertical shot may be before it stops filling the frame. */
export const VERTICAL_HOME_WIDTH = Math.floor(((STAGE_HEIGHT + CHROME_HEIGHT) * 9) / 16);

/** The fictional address shown for each stage. */
export const STAGE_SITES: Record<string, string> = {
  article: "slowroute.example/journal/kyoto-in-autumn",
  "video-watch": "video.example/watch/hand-cut-soba",
  profile: "network.example/in/mira-halvorsen",
  "ai-chat": "assistant.example/c/freelance-rate"
};

export function siteFor(stage: string): string {
  const url = STAGE_SITES[stage];
  if (!url) throw new Error(`no address configured for stage "${stage}" — add it to STAGE_SITES`);
  return url;
}

/**
 * The site's own name, as its manifest would give it. The content script asks
 * for this and prints it on a site-scoped note's header, so it has to follow the
 * stage rather than be one global value.
 *
 * The two nameless stages answer with what their domain says and nothing more —
 * a site with no wordmark would not claim one in its manifest either.
 */
export const STAGE_SITE_NAMES: Record<string, string> = {
  article: "Slow Route",
  "video-watch": "video.example",
  profile: "network.example",
  "ai-chat": "assistant.example"
};

export function siteNameFor(stage: string): string {
  const name = STAGE_SITE_NAMES[stage];
  if (!name) throw new Error(`no site name configured for stage "${stage}" — add it to STAGE_SITE_NAMES`);
  return name;
}

/** Frozen clock. Notes read as written yesterday, edited an hour ago. */
export const NOW = Date.UTC(2026, 4, 12, 9, 30, 0);
export const SEED = 20260512;
export const TAB_ID = 1;
/**
 * Reported by chrome.runtime.getManifest(). Only the content script's
 * re-injection guard reads it, and a render injects once — so a fixed value
 * keeps this module free of any build-time lookup.
 */
export const VERSION = "0.0.0-video";

export type FrameRole = "content" | "popup";

/**
 * Frame configuration. It rides in the hash on purpose: a page-scoped note's
 * anchorKey is origin + pathname + search (src/matching.ts), so query params
 * would leak render plumbing into the note's identity and into its header label.
 */
export function frameHash(
  role: FrameRole,
  lang: string,
  session: string,
  assetBase: string,
  stage: string
): string {
  const entry = LANGS[lang];
  if (!entry) throw new Error(`unknown language "${lang}" — not in store-assets/gen/i18n.mjs`);

  return new URLSearchParams({
    session,
    role,
    // The extension's own language code, not the store-asset one: `pt_BR` and
    // `zh_CN` are store codes, and src/i18n.ts would silently fall back to
    // English on them. store-assets/gen/capture.mjs makes the same mapping.
    lang: entry.ext,
    tabId: String(TAB_ID),
    now: String(NOW),
    seed: String(SEED),
    assetBase,
    version: VERSION,
    siteName: siteNameFor(stage)
  }).toString();
}

/**
 * Where public/ is mounted for the Node-side tools, which serve it from the
 * root. Remotion mounts it under /public/ instead, so the composition passes
 * its own base — see src/Scenario.tsx.
 */
export const NODE_ASSET_BASE = "/";

export function stagePath(stage: string, lang: string): string {
  return `stages/${stage}.${lang}.html`;
}

export const popupPath = "popup.html";

/** popup.html is 280px of content plus its 12px padding. */
export const POPUP_WIDTH = 304;

/**
 * Centre of the extension's toolbar icon, in stage coordinates — the chrome sits
 * at negative y. Scenarios aim the cursor here to open the popup.
 */
export const TOOLBAR_ICON = { x: STAGE_WIDTH - 31, y: 69 - CHROME_HEIGHT };

/** Absolute stage URL for the Node-side tools, which serve public/ themselves. */
export function stageUrl(origin: string, stage: string, lang: string, session: string): string {
  return `${origin}/${stagePath(stage, lang)}#${frameHash("content", lang, session, NODE_ASSET_BASE, stage)}`;
}

/** Same, for the popup frame — sharing the session means sharing the storage. */
export function popupUrl(origin: string, stage: string, lang: string, session: string): string {
  return `${origin}/popup.html#${frameHash("popup", lang, session, NODE_ASSET_BASE, stage)}`;
}

export interface NoteContents {
  n1: string;
  n2: string;
  n3: string;
}

/**
 * The three notes a scenario starts from, laid out around the article. Geometry
 * mirrors store-assets/gen/capture.mjs; on RTL pages the article sits on the
 * right, so the notes move to the left.
 *
 * `now` is the frozen clock: the notes read as written yesterday, edited an hour
 * ago, and stay that way across renders.
 */
export function demoNotes(
  contents: NoteContents,
  rtl: boolean,
  pageKey: string,
  origin: string,
  now: number
): NotesMap {
  const mirror = (x: number, w: number): number => (rtl ? STAGE_WIDTH - x - w : x);
  const make = (
    id: string,
    scope: AnchorScope,
    anchorKey: string,
    color: NoteColor,
    x: number,
    y: number,
    w: number,
    h: number,
    content: string
  ) => ({
    id,
    content,
    color,
    scope,
    anchorKey,
    x: mirror(x, w),
    y,
    w,
    h,
    createdAt: now - 86_400_000,
    updatedAt: now - 3_600_000
  });

  return {
    n1: make("n1", "page", pageKey, "yellow", 872, 120, 316, 208, contents.n1),
    n2: make("n2", "site", origin, "pink", 948, 440, 264, 172, contents.n2),
    n3: make("n3", "global", "", "blue", 600, 490, 292, 208, contents.n3)
  };
}
