// A private reminder on someone else's page.
//
// The angle this one carries: the page belongs to somebody else and offers no
// place to write, yet the note is still there — and out of sight — the next time
// the page comes up. So this video ends on the badge rather than the popup.
//
// No seeded notes: the point is that a page with nothing on it gets exactly one
// thing, put there by you.

import { NEW_NOTE_ORIGIN, NEW_NOTE_SIZE, STAGE_HEIGHT, STAGE_WIDTH, shot } from "../stage-url";
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
}

const COPY: Record<string, Copy> = {
  en: {
    noteContent: "## Met at Devfest\n\n- [ ] Send the API docs\n- [ ] Intro to Sam",
    hookGap: "A profile tells you who someone is. It never tells you why you two spoke.",
    hookText: "THEIR PAGE. YOUR NOTE.",
    openLine: "Someone else's page. Your note.",
    writeLine: "The context this page won't give you.",
    anchorLine: "It waits here until you come back.",
    hideLine: "Tuck it away. One click brings it back."
  },
  tr: {
    noteContent: "## Devfest'te tanıştık\n\n- [ ] API dokümanlarını gönder\n- [ ] Sam ile tanıştır",
    hookGap: "Bir profil sana kim olduğunu söyler. Neden konuştuğunuzu asla söylemez.",
    hookText: "ONUN SAYFASI. SENİN NOTUN.",
    openLine: "Başkasının sayfası. Senin notun.",
    writeLine: "Sayfanın sana vermeyeceği bağlam.",
    anchorLine: "Bu profilde, sen dönene kadar bekler.",
    hideLine: "Kenara kaldır. Bir tıkla geri gelir."
  }
};

const NEW_NOTE = "n1";

/** The empty column beside the profile card. */
/**
 * Where the note lands, per format. Wide uses the margin beside the profile
 * card; vertical has no margin in shot — the card fills the column — so it sits
 * on the page below, which is what a sticky note does anyway.
 */
const parkedAt = (format: FormatName): Point =>
  format === "9-16" ? { x: 620, y: 540 } : { x: 1030, y: 250 };

const header = (at: Point): Point => ({ x: at.x + NEW_NOTE_SIZE.w / 2, y: at.y + 14 });
const menuButton = (at: Point): Point => ({ x: at.x + NEW_NOTE_SIZE.w - 16, y: at.y + 14 });
const hideItem = (at: Point): Point => ({ x: at.x + NEW_NOTE_SIZE.w - 48, y: at.y + 46 });
const middle = (at: Point): Point => ({ x: at.x + NEW_NOTE_SIZE.w / 2, y: at.y + NEW_NOTE_SIZE.h / 2 });

/**
 * How wide a shot is when it pushes in on one thing, per format. Vertical goes
 * closer: the same rect fitted to a 9:16 canvas reveals far more stage.
 */
const closeShot = (format: FormatName): number => (format === "9-16" ? 440 : 760);
/**
 * The shot the note lands in. Wider than the close shot on purpose: the note
 * parks in the margin at the right edge, so a close shot could only ever hold
 * it against empty page — and the beat is about it sitting beside the profile,
 * not alone.
 */
const parkShot = (format: FormatName): number => (format === "9-16" ? 470 : 960);
const badgeShot = (format: FormatName): number => (format === "9-16" ? 320 : 820);

const BADGE: Point = { x: STAGE_WIDTH - 42, y: STAGE_HEIGHT - 42 };

export const profile: Scenario = {
  id: "profile",
  stage: "profile",
  langs: ["en", "tr"],
  seed: "none",

  hook: (lang: string): Hook => {
    const copy = pickCopy(COPY, lang, "profile");
    return {
      formula: "bold_statement",
      gap: copy.hookGap,
      payoffBeat: "anchor",
      onScreenText: copy.hookText
    };
  },

  build: (lang: string, format: FormatName): Beat[] => {
    const copy = pickCopy(COPY, lang, "profile");
    const close = closeShot(format);
    const PARKED = parkedAt(format);

    const beats: Beat[] = [
      {
        id: "open",
        narration: copy.openLine,
        steps: [
          ...openingSteps({ x: 600, y: 340 }, NEW_NOTE, format),
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

      {
        id: "write",
        narration: copy.writeLine,
        steps: [
          { action: "type", id: NEW_NOTE, text: copy.noteContent, ms: 2500 },
          { action: "hold", ms: 400 }
        ]
      },

      // Into the margin beside the profile card.
      {
        id: "anchor",
        narration: copy.anchorLine,
        steps: [
          { action: "zoom", rect: null, ms: 700 },
          { action: "cursor", to: header(NEW_NOTE_ORIGIN), ms: 520 },
          { action: "move", id: NEW_NOTE, to: PARKED, ms: 900 },
          { action: "zoom", rect: shot(middle(PARKED), parkShot(format), format), ms: 700 },
          { action: "hold", ms: 600 }
        ]
      },

      // Hide it through the card's own options menu, then let the badge take
      // its place. The menu closes first, then the note collapses — the order
      // src/content/note-card.ts uses when "Hide" is clicked.
      {
        id: "hide",
        narration: copy.hideLine,
        steps: [
          { action: "cursor", to: menuButton(PARKED), ms: 600 },
          { action: "click", ms: 300 },
          { action: "noteMenu", id: NEW_NOTE, ms: 500 },
          { action: "cursor", to: hideItem(PARKED), ms: 420 },
          { action: "click", ms: 300 },
          { action: "noteMenu", id: null, ms: 1 },
          { action: "setHidden", id: NEW_NOTE, hidden: true, ms: 450 },
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
          { action: "hold", ms: 800 },
          { action: "badgeList", open: false, ms: 350 }
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
