// Watching something long, taking a note without leaving the page.
//
// The angle this one carries that kyoto-basics does not: the note has to live
// beside what you are watching, not on top of it. So the shot pulls back for the
// drag, the note lands clear of the player, and the video is still playing
// behind it the whole time.
//
// No seeded notes: this is the first note on a fresh page, which is also what
// makes the popup's count honest.

import { NEW_NOTE_ORIGIN, NEW_NOTE_SIZE, POPUP_WIDTH, CHROME_HEIGHT, STAGE_WIDTH, TOOLBAR_ICON, shot } from "../stage-url";
import { pickCopy } from "../copy/index";
import { openingSteps } from "./opening";
import type { Beat, FormatName, Hook, Point, Scenario } from "../src/types";

interface Copy {
  noteContent: string;
  hookGap: string;
  hookText: string;
  openLine: string;
  writeLine: string;
  parkLine: string;
  popupLine: string;
}

const COPY: Record<string, Copy> = {
  en: {
    noteContent: "## Soba — 12:04\n\n- [ ] Rest the dough 30 min\n- [ ] Water at 45%",
    hookGap: "You pause a long video to write something down, and the note ends up somewhere else entirely.",
    hookText: "NOTE IT, KEEP WATCHING",
    openLine: "Something worth remembering, mid-video.",
    writeLine: "Timestamps, steps, checkboxes — just markdown.",
    parkLine: "Park it clear of the player. It stays there.",
    popupLine: "Still there next time you open the page."
  },
  tr: {
    noteContent: "## Soba — 12:04\n\n- [ ] Hamuru 30 dk dinlendir\n- [ ] Su oranı %45",
    hookGap: "Uzun bir videoyu bir şey not almak için durdurursun, not bambaşka bir yerde kalır.",
    hookText: "NOT AL, İZLEMEYE DEVAM",
    openLine: "Aklında kalması gereken bir şey.",
    writeLine: "Zaman damgası, adımlar, onay kutuları.",
    parkLine: "Önünü kapatmadan park et. Orada kalır.",
    popupLine: "Sayfayı tekrar açtığında hâlâ orada."
  }
};

const NEW_NOTE = "n1";

/**
 * Where the note lands, per format. Wide parks it beside the player, under the
 * up-next column; vertical only holds a column of the page, so it travels down
 * to the space below the player instead of across to a margin that is not in
 * shot.
 */
const parkedAt = (format: FormatName): Point =>
  format === "9-16" ? { x: 620, y: 560 } : { x: 986, y: 470 };

const header = (at: Point): Point => ({ x: at.x + NEW_NOTE_SIZE.w / 2, y: at.y + 14 });
const middle = (at: Point): Point => ({ x: at.x + NEW_NOTE_SIZE.w / 2, y: at.y + NEW_NOTE_SIZE.h / 2 });

/**
 * How wide a shot is when it pushes in on one thing, per format. Vertical goes
 * closer: the same rect fitted to a 9:16 canvas reveals far more stage.
 */
const closeShot = (format: FormatName): number => (format === "9-16" ? 440 : 760);
/**
 * The shot the note lands in. Wider than the close shot on purpose: the note
 * parks at the right edge of the page, so a close shot could only ever hold it
 * against empty margin — and the point of the beat is that the player is still
 * there beside it.
 */
const parkShot = (format: FormatName): number => (format === "9-16" ? 470 : 960);
const popupShot = (format: FormatName): number => (format === "9-16" ? 480 : 820);

const POPUP_CENTRE: Point = { x: STAGE_WIDTH - 16 - POPUP_WIDTH / 2, y: 180 - CHROME_HEIGHT / 2 };

export const videoWatch: Scenario = {
  id: "video-watch",
  stage: "video-watch",
  langs: ["en", "tr"],
  seed: "none",

  hook: (lang: string): Hook => {
    const copy = pickCopy(COPY, lang, "video-watch");
    return {
      formula: "question",
      gap: copy.hookGap,
      payoffBeat: "park",
      onScreenText: copy.hookText
    };
  },

  build: (lang: string, format: FormatName): Beat[] => {
    const copy = pickCopy(COPY, lang, "video-watch");
    const close = closeShot(format);
    const PARKED = parkedAt(format);

    const beats: Beat[] = [
      // Pause the watching, leave a note.
      {
        id: "open",
        narration: copy.openLine,
        steps: [
          ...openingSteps({ x: 560, y: 300 }, NEW_NOTE, format),
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

      // Out of the player's way. The shot pulls back first, or the note would
      // sit still in frame and the move would read as the page sliding.
      {
        id: "park",
        narration: copy.parkLine,
        steps: [
          { action: "zoom", rect: null, ms: 700 },
          { action: "cursor", to: header(NEW_NOTE_ORIGIN), ms: 520 },
          { action: "move", id: NEW_NOTE, to: PARKED, ms: 900 },
          { action: "zoom", rect: shot(middle(PARKED), parkShot(format), format), ms: 700 },
          { action: "hold", ms: 600 }
        ]
      },

      // And it is reachable from the toolbar like everything else.
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
          { action: "popup", open: true, ms: 1400 },
          { action: "popup", open: false, ms: 300 }
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
