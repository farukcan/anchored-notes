// Ideas arrive while browsing, and they leave just as fast.
//
// The angle this one carries that the others do not: urgency, and a note per
// page. The site is a design inspiration gallery, the kind that sparks ideas
// faster than anyone can keep them. Each idea is caught on the page of the shot
// that sparked it: open a shot, stick a note on it, go back to the collection —
// which is clean, because the note belongs to that shot — open the next one,
// stick another. The last beat goes back to the first shot and the first note
// is still there, exactly where it was left.
//
// None of that is staged. The gallery is one document with several pages, and
// `navigate` is a same-document navigation, so the real extension sees a new
// URL each time and decides by itself which notes a page shows.
//
// A note is made the way the product makes one: a right-click on the page opens
// the browser's menu, and the extension's own "Add note here" entry creates it.
// A plain click on the page does nothing, so the video never shows one there.
//
// Every page change happens in a still, wide shot, so the click that causes it
// can be seen: the camera pulls out first, the card or link is clicked, the
// page changes with the camera at rest, and only then — if the new page needs
// it — does the camera push in. A camera move never overlaps a navigation.
//
// Each note is sharp from the frame it appears: nothing is in focus before it
// is created, so it never has to clear out of a blur. The page steps back only
// once the note exists, while it is being written.
//
// No seeded notes: every post-it in the video is one the viewer watched being
// caught.

import { NEW_NOTE_ORIGIN, NEW_NOTE_SIZE, shot } from "../stage-url";
import { copyFor, pickCopy } from "../copy/index";
import { HOOK_TOTAL_MS } from "../src/layout";
import { stepsDurationMs } from "../src/driver";
import {
  extensionLabels,
  menuCentre,
  menuRowPoint,
  pageMenuRows,
  rowIndexOf
} from "../src/overlays/ContextMenu";
import type { Beat, FormatName, Hook, Point, Scenario, Step } from "../src/types";

interface Copy {
  firstIdea: string;
  secondIdea: string;
  hookGap: string;
  hookText: string;
  sparkLine: string;
  catchLine: string;
  stickLine: string;
  cleanLine: string;
  moreLine: string;
  returnLine: string;
}

const COPY: Record<string, Copy> = {
  en: {
    firstIdea: "## 💡 Idea\n\nCandy stripes for our bakery box",
    secondIdea: "## 💡 Idea\n\nKraft + one black band for our beans",
    hookGap:
      "Ideas hit me all the time while browsing… I wish I could stick them right onto the page, like a post-it.",
    hookText: "DON'T LOSE THAT IDEA",
    sparkLine: "An idea hits. Right-click, add a note.",
    catchLine: "Right on the page that sparked it.",
    stickLine: "Stick it. It stays on this page.",
    cleanLine: "Other pages stay clean.",
    moreLine: "Another idea? Another page, another note.",
    returnLine: "Come back later — your idea is waiting."
  },
  tr: {
    firstIdea: "## 💡 Fikir\n\nPastane kutumuza şeker çizgisi",
    secondIdea: "## 💡 Fikir\n\nKraft + tek siyah bant, bizim kahveye",
    hookGap:
      "Nette gezerken aklıma bir sürü fikir geliyor… keşke bu fikirleri direkt o sayfanın üstüne post-it gibi yapıştırabilsem.",
    hookText: "O FİKRİ KAÇIRMA",
    sparkLine: "Fikir geldi. Sağ tıkla, not ekle.",
    catchLine: "Tam da ilham veren sayfanın üstüne.",
    stickLine: "Yapıştır. Bu sayfada kalır.",
    cleanLine: "Diğer sayfalar tertemiz kalır.",
    moreLine: "Bir fikir daha? Başka sayfa, başka not.",
    returnLine: "Sonra dön, fikrin yerinde seni bekler."
  }
};

const FIRST = "n1";
const SECOND = "n2";

/**
 * The two shots, by the `data-page-view` name the stage gives their pages, and
 * where each one's tile sits on the collection. Both are in the middle two
 * columns, which is the part of the grid a vertical cut can see. Measured from
 * the rendered stage; the points sit inside the tile's artwork in both
 * languages, whose titles wrap differently and move the grid.
 */
const SHOTS = {
  bakery: { page: "bakery", tile: { x: 790, y: 400 } },
  coffee: { page: "coffee", tile: { x: 490, y: 420 } }
} as const;

/** "Back to collection", centred at the top of every shot page. */
const BACK_LINK: Point = { x: 640, y: 98 };

/** Where the page is right-clicked to leave a note — on the work itself. */
const RIGHT_CLICK: Point = { x: 640, y: 440 };

/**
 * Where a note is stuck on a shot page, per format. Wide has a free margin
 * beside the work, between the save button and the designer's other shots.
 * Vertical only holds the middle of the page, so the note sits on the lower
 * corner of the work instead. Both shot pages share a layout, so the same spot
 * serves both — which is also what shows each page keeping its own.
 */
const parkedAt = (format: FormatName): Point =>
  format === "9-16" ? { x: 640, y: 530 } : { x: 1000, y: 270 };

const header = (at: Point): Point => ({ x: at.x + NEW_NOTE_SIZE.w / 2, y: at.y + 14 });
const middle = (at: Point): Point => ({ x: at.x + NEW_NOTE_SIZE.w / 2, y: at.y + NEW_NOTE_SIZE.h / 2 });

/**
 * How wide a shot is when it pushes in on one thing, per format. Vertical goes
 * closer: the same rect fitted to a 9:16 canvas reveals far more stage.
 */
const closeShot = (format: FormatName): number => (format === "9-16" ? 440 : 780);
/** The shot a stuck note is seen in: wide enough to hold the work beside it. */
const parkShot = (format: FormatName): number => (format === "9-16" ? 470 : 960);
/** Close enough that the menu entry being clicked can be read on a phone. */
const menuShot = (format: FormatName): number => (format === "9-16" ? 470 : 720);

/**
 * Change page: click, and the page changes. The caller has already pulled the
 * camera out to rest, so the click is seen in a wide shot and the camera does
 * not move across the change; the hold lets the new page register before
 * anything else happens on it.
 */
function pageChangeSteps(page: string | null, holdMs: number): Step[] {
  return [
    { action: "click", ms: 280 },
    { action: "navigate", page, ms: 1 },
    { action: "hold", ms: holdMs }
  ];
}

/**
 * Open a shot from the collection, which is already in a wide shot: point at
 * its tile and click it.
 */
function openShotSteps(target: { page: string; tile: Point }): Step[] {
  return [{ action: "cursor", to: target.tile, ms: 600 }, ...pageChangeSteps(target.page, 600)];
}

/**
 * Back to the collection. The blur lifts and the camera pulls out to rest while
 * the pointer goes to the link; only once the shot is wide is the link clicked.
 * The collection has no note on it, because the note belongs to the page it was
 * left on.
 */
function backSteps(holdMs: number): Step[] {
  return [
    {
      action: "parallel",
      ms: 700,
      steps: [
        { action: "focus", target: null, ms: 440 },
        { action: "zoom", rect: null, ms: 700 },
        { action: "cursor", to: BACK_LINK, ms: 700 }
      ]
    },
    { action: "hold", ms: 200 },
    ...pageChangeSteps(null, holdMs)
  ];
}

/**
 * Leave a note the way the product does: right-click the page, and choose the
 * extension's "Add note here" from the browser's menu. The menu opens under the
 * pointer and the shot eases onto it, so the entry being clicked can be read.
 * The note appears where the extension puts one — centred on the page — with
 * nothing in focus, so it is sharp from its first frame.
 */
function leaveNoteSteps(id: string, lang: string, format: FormatName): Step[] {
  const rows = pageMenuRows(lang, copyFor(lang));
  const addRow = rowIndexOf(rows, extensionLabels(lang).add);
  return [
    { action: "cursor", to: RIGHT_CLICK, ms: 380 },
    // No `click` before the menu: the right-click is the menu opening, and
    // src/audio/cues.ts already gives that its own sound. A click here would be
    // a second, left-click, gesture for the same press.
    { action: "hold", ms: 200 },
    {
      action: "parallel",
      ms: 620,
      steps: [
        { action: "contextMenu", at: RIGHT_CLICK, ms: 1 },
        { action: "zoom", rect: shot(menuCentre(RIGHT_CLICK, rows), menuShot(format), format), ms: 620 }
      ]
    },
    { action: "cursor", to: menuRowPoint(RIGHT_CLICK, rows, addRow), ms: 560 },
    { action: "hold", ms: 260 },
    { action: "click", ms: 260 },
    { action: "contextMenu", at: null, ms: 1 },
    { action: "createNote", id, content: "", ms: 320 }
  ];
}

/** Push in on the new note while the page steps back around it. */
function focusNoteStep(id: string, format: FormatName): Step {
  return {
    action: "parallel",
    ms: 760,
    steps: [
      { action: "focus", target: { kind: "note", id }, ms: 440 },
      { action: "zoom", rect: shot(middle(NEW_NOTE_ORIGIN), closeShot(format), format), ms: 760 }
    ]
  };
}

/** Pull back and drag the card by its header to its spot beside the work. */
function stickSteps(id: string, format: FormatName): Step[] {
  return [
    { action: "zoom", rect: null, ms: 700 },
    { action: "cursor", to: header(NEW_NOTE_ORIGIN), ms: 520 },
    { action: "move", id, to: parkedAt(format), ms: 900 }
  ];
}

/**
 * How the video opens: the collection, whole, with the pointer already heading
 * for the first tile. It waits there until the hook has left, in both formats:
 * the first page change is the move the rest of the video depends on, and a
 * hook set over it would hide the very thing it has to show.
 */
function openingSteps(): Step[] {
  const glide: Step = { action: "cursor", to: SHOTS.bakery.tile, ms: 1200 };
  return [glide, { action: "hold", ms: Math.max(200, HOOK_TOTAL_MS - stepsDurationMs([glide])) }];
}

export const ideaRush: Scenario = {
  id: "idea-rush",
  stage: "inspiration",
  langs: ["en", "tr"],
  seed: "none",

  hook: (lang: string): Hook => {
    const copy = pickCopy(COPY, lang, "idea-rush");
    return {
      formula: "bold_statement",
      gap: copy.hookGap,
      payoffBeat: "stick",
      onScreenText: copy.hookText
    };
  },

  build: (lang: string, format: FormatName): Beat[] => {
    const copy = pickCopy(COPY, lang, "idea-rush");
    const parked = parkedAt(format);

    return [
      // Into the shot that sparked the idea, and a note on it straight away.
      {
        id: "spark",
        narration: copy.sparkLine,
        steps: [
          ...openingSteps(),
          ...pageChangeSteps(SHOTS.bakery.page, 600),
          ...leaveNoteSteps(FIRST, lang, format),
          focusNoteStep(FIRST, format)
        ]
      },

      // Get it down before it goes.
      {
        id: "catch",
        narration: copy.catchLine,
        steps: [
          { action: "type", id: FIRST, text: copy.firstIdea, ms: 2500 },
          { action: "hold", ms: 300 }
        ]
      },

      // Beside the work, not in some other app. The shot pulls back first — a
      // camera riding along with the note would hide the drag.
      {
        id: "stick",
        narration: copy.stickLine,
        steps: [
          ...stickSteps(FIRST, format),
          { action: "zoom", rect: shot(middle(parked), parkShot(format), format), ms: 700 },
          { action: "hold", ms: 400 }
        ]
      },

      // The collection has no note on it: that one belongs to the shot.
      {
        id: "clean",
        narration: copy.cleanLine,
        steps: backSteps(900)
      },

      // A second shot, a second idea, a second page.
      {
        id: "more",
        narration: copy.moreLine,
        steps: [
          ...openShotSteps(SHOTS.coffee),
          ...leaveNoteSteps(SECOND, lang, format),
          focusNoteStep(SECOND, format),
          { action: "type", id: SECOND, text: copy.secondIdea, ms: 1800 },
          { action: "hold", ms: 250 },
          ...stickSteps(SECOND, format),
          { action: "hold", ms: 300 }
        ]
      },

      // Back on the first shot, the first note is where it was left.
      {
        id: "return",
        narration: copy.returnLine,
        steps: [
          ...backSteps(500),
          ...openShotSteps(SHOTS.bakery),
          {
            action: "parallel",
            ms: 760,
            steps: [
              { action: "focus", target: { kind: "note", id: FIRST }, ms: 440 },
              { action: "zoom", rect: shot(middle(parked), parkShot(format), format), ms: 760 }
            ]
          },
          { action: "hold", ms: 1000 }
        ]
      },

      {
        id: "close",
        narration: null,
        steps: [
          {
            action: "parallel",
            ms: 700,
            steps: [
              { action: "focus", target: null, ms: 420 },
              { action: "zoom", rect: null, ms: 700 },
              // The pointer comes back onto the page as the shot pulls out, so it
              // is not left at the edge of a frame that is widening.
              { action: "cursor", to: { x: 640, y: 520 }, ms: 700 }
            ]
          },
          { action: "outro", ms: 700 },
          { action: "hold", ms: 1600 }
        ]
      }
    ];
  }
};
