// The reference scenario: someone reading a travel article leaves a note on it,
// writes a checklist, drags it aside, then tucks it into the badge.
//
// Every beat is data. The engine knows nothing about Kyoto, checklists or
// badges — it only knows how to be at a point on a timeline. The beat ids are
// the contract with the narration: `npm run voiceover` measures a spoken line
// per id, and src/beats.ts scales each beat's steps to what it measured.

import {
  CHROME_HEIGHT,
  NEW_NOTE_ORIGIN,
  NEW_NOTE_SIZE,
  POPUP_WIDTH,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  TOOLBAR_ICON,
  shot
} from "../stage-url";
import { pickCopy } from "../copy/index";
import { openingSteps } from "./opening";
import type { Beat, FormatName, Hook, Point, Scenario } from "../src/types";

interface Copy {
  noteContent: string;
  hookGap: string;
  hookText: string;
  openLine: string;
  writeLine: string;
  anchorLine: string;
  hideLine: string;
  badgeLine: string;
  popupLine: string;
}

const COPY: Record<string, Copy> = {
  en: {
    noteContent: "## Trip planning\n\n- [ ] Compare train passes\n- [ ] Book the ryokan",
    hookGap: "The page you researched on is the one place your notes never live.",
    hookText: "NOTES THAT STAY",
    openLine: "Leave a note on any page.",
    writeLine: "Full markdown — lists, tables, checkboxes.",
    anchorLine: "Drag it anywhere. It stays put.",
    hideLine: "Done with it? Tuck it away.",
    badgeLine: "Still there, one click from the corner.",
    popupLine: "Every note you left is in the toolbar."
  },
  tr: {
    noteContent: "## Gezi planı\n\n- [ ] Tren kartlarını karşılaştır\n- [ ] Ryokan rezervasyonu",
    hookGap: "Araştırmayı yaptığın sayfa, notlarının asla durmadığı tek yer.",
    hookText: "NOTLAR YERİNDE KALIR",
    openLine: "Herhangi bir sayfaya not bırak.",
    writeLine: "Tam markdown: liste, tablo, onay kutusu.",
    anchorLine: "İstediğin yere sürükle. Yerinde kalır.",
    hideLine: "İşin bitti mi? Kenara kaldır.",
    badgeLine: "Hâlâ orada, köşeden bir tık uzakta.",
    popupLine: "Bıraktığın her not araç çubuğunda."
  }
};

const NEW_NOTE = "n4";

/**
 * Where the note lands after the drag, per format.
 *
 * Wide sends it to the far margin, clear of the seeded notes. Vertical cannot:
 * the frame only holds a column of the page, so a note dragged to the far edge
 * would leave the shot and the camera would have to pull back to follow it —
 * undoing the framing. A tall frame favours a tall move, so it travels down.
 */
const parkedAt = (format: FormatName): Point =>
  format === "9-16" ? { x: 410, y: 545 } : { x: 120, y: 470 };

/** Cursor targets on a card, derived from its top-left so they follow the drag. */
const header = (at: Point): Point => ({ x: at.x + NEW_NOTE_SIZE.w / 2, y: at.y + 14 });
const menuButton = (at: Point): Point => ({ x: at.x + NEW_NOTE_SIZE.w - 16, y: at.y + 14 });
const hideItem = (at: Point): Point => ({ x: at.x + NEW_NOTE_SIZE.w - 48, y: at.y + 46 });
const middle = (at: Point): Point => ({ x: at.x + NEW_NOTE_SIZE.w / 2, y: at.y + NEW_NOTE_SIZE.h / 2 });

/** The badge sits in the bottom-right corner of the viewport. */
const BADGE: Point = { x: STAGE_WIDTH - 42, y: STAGE_HEIGHT - 42 };

/** Centre of the popup and the toolbar icon it hangs from — the chrome is at negative y. */
const POPUP_CENTRE: Point = { x: STAGE_WIDTH - 16 - POPUP_WIDTH / 2, y: 180 - CHROME_HEIGHT / 2 };

/**
 * How wide a shot is when it pushes in on one thing, per format.
 *
 * Vertical pushes in harder: the same rect fitted to a 9:16 canvas reveals far
 * more stage than it does on a wide one, so a shot that reads as close in 16:9
 * reads as a wide establishing view on a phone.
 */
const closeShot = (format: FormatName): number => (format === "9-16" ? 440 : 780);
const badgeShot = (format: FormatName): number => (format === "9-16" ? 320 : 700);
const popupShot = (format: FormatName): number => (format === "9-16" ? 480 : 820);

export const kyotoBasics: Scenario = {
  id: "kyoto-basics",
  stage: "article",
  langs: ["en", "tr"],
  seed: "demo",

  hook: (lang: string): Hook => {
    const copy = pickCopy(COPY, lang, "kyoto-basics");
    return {
      formula: "payoff_preview",
      gap: copy.hookGap,
      payoffBeat: "anchor",
      onScreenText: copy.hookText
    };
  },

  build: (lang: string, format: FormatName): Beat[] => {
    const copy = pickCopy(COPY, lang, "kyoto-basics");
    const close = closeShot(format);
    const PARKED = parkedAt(format);

    const beats: Beat[] = [
      // Leave a note on the page. The article recedes the moment the note
      // exists — the camera pushes in as the blur comes up, so the page never
      // competes with the product.
      {
        id: "open",
        narration: copy.openLine,
        steps: [
          ...openingSteps({ x: 620, y: 430 }, NEW_NOTE, format),
          {
            action: "parallel",
            ms: 760,
            steps: [
              { action: "focus", target: { kind: "note", id: NEW_NOTE }, ms: 440 },
              { action: "zoom", rect: shot(middle(NEW_NOTE_ORIGIN), close, format), ms: 760 }
            ]
          }
        ]
      },

      // Write it.
      {
        id: "write",
        narration: copy.writeLine,
        steps: [
          { action: "type", id: NEW_NOTE, text: copy.noteContent, ms: 2600 },
          { action: "hold", ms: 300 }
        ]
      },

      // Drag it out of the way; it stays where it is put. The shot pulls back
      // first — a camera that rode along with the note would hold it still in
      // frame and hide the very thing the beat is about. The focus rides the
      // card itself, so the drag needs no help.
      {
        id: "anchor",
        narration: copy.anchorLine,
        steps: [
          { action: "zoom", rect: null, ms: 700 },
          { action: "cursor", to: header(NEW_NOTE_ORIGIN), ms: 520 },
          { action: "move", id: NEW_NOTE, to: PARKED, ms: 950 },
          { action: "zoom", rect: shot(middle(PARKED), close, format), ms: 700 },
          { action: "hold", ms: 400 }
        ]
      },

      // Tuck it into the badge through the card's own options menu. The menu
      // closes first, then the note collapses — the order src/content/note-card.ts
      // uses when "Hide" is clicked.
      {
        id: "hide",
        narration: copy.hideLine,
        steps: [
          { action: "cursor", to: menuButton(PARKED), ms: 620 },
          { action: "click", ms: 300 },
          { action: "noteMenu", id: NEW_NOTE, ms: 500 },
          { action: "cursor", to: hideItem(PARKED), ms: 420 },
          { action: "click", ms: 300 },
          { action: "noteMenu", id: null, ms: 1 },
          { action: "setHidden", id: NEW_NOTE, hidden: true, ms: 450 }
        ]
      },

      // It is still there, one click away. The card is gone by now, so both the
      // focus and the camera hand over to what took its place.
      {
        id: "badge",
        narration: copy.badgeLine,
        steps: [
          {
            action: "parallel",
            ms: 800,
            steps: [
              { action: "focus", target: { kind: "badge" }, ms: 460 },
              {
                action: "zoom",
                rect: shot({ x: BADGE.x - 40, y: BADGE.y - 40 }, badgeShot(format), format),
                ms: 800
              },
              // The pointer travels with the shot rather than being left
              // behind it: a camera that arrives somewhere the cursor is not
              // has a frame with nothing in it to follow, and the pointer
              // spends that frame outside the picture.
              { action: "cursor", to: BADGE, ms: 800 }
            ]
          },
          { action: "click", ms: 300 },
          { action: "badgeList", open: true, ms: 900 },
          { action: "hold", ms: 700 },
          { action: "badgeList", open: false, ms: 350 }
        ]
      },

      // And everything is reachable from the toolbar.
      {
        id: "popup",
        narration: copy.popupLine,
        steps: [
          {
            action: "parallel",
            ms: 800,
            steps: [
              { action: "focus", target: { kind: "popup" }, ms: 420 },
              { action: "zoom", rect: shot(POPUP_CENTRE, popupShot(format), format), ms: 800 },
              // The pointer travels with the shot rather than being left
              // behind it: a camera that arrives somewhere the cursor is not
              // has a frame with nothing in it to follow, and the pointer
              // spends that frame outside the picture.
              { action: "cursor", to: TOOLBAR_ICON, ms: 800 }
            ]
          },
          { action: "click", ms: 300 },
          { action: "popup", open: true, ms: 1500 },
          { action: "popup", open: false, ms: 300 }
        ]
      },

      // Hand the whole page back before the closing card.
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
              // The pointer comes back onto the page as the shot pulls out.
              // Left where the last click was, it ends up outside a frame that
              // no longer reaches the toolbar or the corner.
              { action: "cursor", to: { x: 640, y: 520 }, ms: 700 }
            ]
          },
          { action: "outro", ms: 700 },
          { action: "hold", ms: 1600 }
        ]
      }
    ];

    return beats;
  }
};
