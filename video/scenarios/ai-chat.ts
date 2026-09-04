// Reading an answer from an assistant and keeping the two sentences worth
// keeping.
//
// The angle this one carries that the others do not: the note is not typed, it
// is taken. A passage is selected on the page, the browser's own context menu
// opens on it, and the extension's entry turns that selection into a note —
// then a second selection is appended to the same note as a quote. Nothing here
// is a special effect: the highlight is the browser's selection, the menu
// entries carry the labels src/background.ts registers, and the appended text
// is built the way src/content/note-card.ts builds it.
//
// The quoted sentences come from the stage's own copy deck rather than being
// restated here, so what is selected and what lands in the note cannot drift.

import { CHROME_HEIGHT, NEW_NOTE_ORIGIN, NEW_NOTE_SIZE, POPUP_WIDTH, STAGE_WIDTH, TOOLBAR_ICON, homeView, shot } from "../stage-url";
import { STAGE_COPY } from "../copy/stages";
import { copyFor, pickCopy } from "../copy/index";
import { menuCentre, menuRowPoint } from "../src/overlays/ContextMenu";
import type { Beat, FormatName, Hook, Point, Scenario, Step } from "../src/types";

interface Copy {
  hookGap: string;
  hookText: string;
  askLine: string;
  keepLine: string;
  appendLine: string;
  stayLine: string;
  /**
   * Where each quoted sentence ends, in stage pixels.
   *
   * Measured from the rendered stage, and per language because the two
   * translations are not the same length — a shared number would leave the
   * pointer short of the text in one of them, and the selection stops wherever
   * the pointer does.
   */
  sweep1EndX: number;
  sweep2EndX: number;
}

const COPY: Record<string, Copy> = {
  en: {
    hookGap: "The best line in a long answer is the one you will never scroll back to.",
    hookText: "KEEP THE GOOD PART",
    askLine: "A long answer. Two useful lines.",
    keepLine: "Select it, right-click, keep it.",
    appendLine: "The next one joins the same note.",
    stayLine: "It stays on the conversation.",
    sweep1EndX: 707,
    sweep2EndX: 700
  },
  tr: {
    hookGap: "Uzun bir cevabın en iyi cümlesi, bir daha asla geri dönmeyeceğin cümledir.",
    hookText: "İYİ KISMI SAKLA",
    askLine: "Uzun cevap, iki işe yarar cümle.",
    keepLine: "Seç, sağ tıkla, sakla.",
    appendLine: "Sonraki de aynı nota ekleniyor.",
    stayLine: "Sohbetin üstünde kalır, başka uygulamada değil.",
    sweep1EndX: 675,
    sweep2EndX: 614
  }
};

/** The passages the stage marks as selectable, and the text inside them. */
const QUOTE_IDS = { first: "q1", second: "q2" } as const;

function quotes(lang: string): { first: string; second: string } {
  const deck = pickCopy(STAGE_COPY["ai-chat"], lang, "ai-chat stage");
  return { first: deck.acQuote1, second: deck.acQuote2 };
}

const NEW_NOTE = "n1";

/**
 * Where each quoted passage sits. Both are one line: a sentence that wrapped
 * would make the pointer travel down and back to the left margin, which no hand
 * does — and the selection, which follows the pointer, would jump between lines
 * with it. Keeping the quotes to a single line keeps the drag a straight move.
 * Measured from the rendered stage.
 */
const SWEEP = {
  first: { from: { x: 352, y: 161 }, y: 161 },
  second: { from: { x: 352, y: 290 }, y: 290 }
};

/**
 * Where the note lands once it exists: out of the answer's way, but still in
 * shot beside it. Wide has a margin to the right of the narrow column; vertical
 * has none, so it goes below the answer instead.
 */
const parkedAt = (format: FormatName): Point =>
  format === "9-16" ? { x: 330, y: 500 } : { x: 900, y: 200 };

/**
 * The shot the second selection is made in. It has to hold the passage and the
 * note at once: the whole point of the beat is that the one lands in the other,
 * and a viewer who can only see one of them at a time has to take that on
 * trust.
 */
const appendShot = (format: FormatName): { at: Point; width: number } =>
  format === "9-16" ? { at: { x: 546, y: 430 }, width: 470 } : { at: { x: 736, y: 300 }, width: 900 };

const middle = (at: Point): Point => ({ x: at.x + NEW_NOTE_SIZE.w / 2, y: at.y + NEW_NOTE_SIZE.h / 2 });

const closeShot = (format: FormatName): number => (format === "9-16" ? 460 : 780);
const readShot = (format: FormatName): number => (format === "9-16" ? 501 : 900);
const popupShot = (format: FormatName): number => (format === "9-16" ? 480 : 820);
/** Close enough that the entry being clicked can be read on a phone. */
const menuShot = (format: FormatName): number => (format === "9-16" ? 470 : 720);

const POPUP_CENTRE: Point = { x: STAGE_WIDTH - 16 - POPUP_WIDTH / 2, y: 180 - CHROME_HEIGHT / 2 };

/**
 * Right-click a passage, then click one of the extension's two entries.
 *
 * The menu opens under the pointer, so where its rows are is a consequence of
 * where the drag ended — `menuRowPoint` works that out rather than the scenario
 * hard-coding a coordinate that would silently drift if a row were ever added.
 */
function menuSteps(
  at: Point,
  lang: string,
  format: FormatName,
  row: number,
  done: Step
): Step[] {
  const copy = copyFor(lang);
  return [
    // The menu appears in one frame, as a real one does; the shot eases onto it
    // over the same stretch, so the correction is a camera move rather than a
    // jump. Parallel because the two are one event.
    {
      action: "parallel",
      ms: 620,
      steps: [
        { action: "contextMenu", at, ms: 1 },
        { action: "zoom", rect: shot(menuCentre(at, lang, copy), menuShot(format), format), ms: 620 }
      ]
    },
    { action: "cursor", to: menuRowPoint(at, lang, copy, row), ms: 560 },
    { action: "hold", ms: 240 },
    { action: "click", ms: 260 },
    { action: "contextMenu", at: null, ms: 1 },
    done
  ];
}

export const aiChat: Scenario = {
  id: "ai-chat",
  stage: "ai-chat",
  langs: ["en", "tr"],
  seed: "none",

  hook: (lang: string): Hook => {
    const copy = pickCopy(COPY, lang, "ai-chat");
    return {
      formula: "curiosity_gap",
      gap: copy.hookGap,
      payoffBeat: "keep",
      onScreenText: copy.hookText
    };
  },

  build: (lang: string, format: FormatName): Beat[] => {
    const copy = pickCopy(COPY, lang, "ai-chat");
    const quote = quotes(lang);
    const PARKED = parkedAt(format);
    const append = appendShot(format);
    const sweep1End: Point = { x: copy.sweep1EndX, y: SWEEP.first.y };
    const sweep2End: Point = { x: copy.sweep2EndX, y: SWEEP.second.y };

    return [
      // Establish the conversation. No note yet — just an answer long enough
      // that nobody will scroll back to it.
      {
        id: "ask",
        narration: copy.askLine,
        steps: [
          { action: "cursor", to: SWEEP.first.from, ms: 1200 },
          { action: "hold", ms: 900 },
          {
            action: "zoom",
            // Centred on the answer's own column, not on the middle of the page:
            // the narrow vertical slice has to hold the whole of a sentence,
            // including the first character the drag starts on.
            rect: shot({ x: 555, y: 300 }, readShot(format), format),
            ms: 700
          }
        ]
      },

      // Drag through the sentence, take it, and put the note where it will not
      // sit on top of the answer. The pointer travels with the selection,
      // because that is the same gesture.
      {
        id: "keep",
        narration: copy.keepLine,
        steps: [
          {
            action: "parallel",
            ms: 900,
            steps: [
              { action: "select", target: QUOTE_IDS.first, ms: 900 },
              { action: "cursor", to: sweep1End, ms: 900 }
            ]
          },
          { action: "hold", ms: 320 },
          ...menuSteps(sweep1End, lang, format, 3, {
            action: "createNote",
            id: NEW_NOTE,
            content: quote.first,
            ms: 420
          }),
          { action: "select", target: null, ms: 1 },
          {
            action: "parallel",
            ms: 700,
            steps: [
              { action: "focus", target: { kind: "note", id: NEW_NOTE }, ms: 440 },
              { action: "zoom", rect: shot(middle(NEW_NOTE_ORIGIN), closeShot(format), format), ms: 700 }
            ]
          },
          { action: "hold", ms: 380 },
          {
            action: "cursor",
            to: { x: NEW_NOTE_ORIGIN.x + NEW_NOTE_SIZE.w / 2, y: NEW_NOTE_ORIGIN.y + 14 },
            ms: 520
          },
          { action: "move", id: NEW_NOTE, to: PARKED, ms: 880 }
        ]
      },

      // The second sentence joins the first, quoted, in the same note — and the
      // shot holds both, so the viewer sees where it goes.
      {
        id: "append",
        narration: copy.appendLine,
        steps: [
          // The blur comes off before anything is selected. A selection made on
          // a page that has stepped back is a selection nobody can see happen,
          // which is the whole point of the beat.
          {
            action: "parallel",
            ms: 760,
            steps: [
              { action: "focus", target: null, ms: 460 },
              { action: "zoom", rect: shot(append.at, append.width, format), ms: 760 },
              // The pointer travels with the shot rather than being left
              // behind it: a camera that arrives somewhere the cursor is not
              // has a frame with nothing in it to follow, and the pointer
              // spends that frame outside the picture.
        { action: "cursor", to: SWEEP.second.from, ms: 620 }
            ]
          },
          {
            action: "parallel",
            ms: 820,
            steps: [
              { action: "select", target: QUOTE_IDS.second, ms: 820 },
              { action: "cursor", to: sweep2End, ms: 820 }
            ]
          },
          { action: "hold", ms: 300 },
          ...menuSteps(sweep2End, lang, format, 4, {
            action: "appendQuote",
            id: NEW_NOTE,
            text: quote.second,
            ms: 420
          }),
          // The shot goes back to holding both before the selection clears, so
          // the sentence and the quote it became are on screen together. The
          // pointer comes off the menu with it — left on the row it clicked, it
          // ends up outside a shot that no longer reaches the menu.
          {
            action: "parallel",
            ms: 620,
            steps: [
              { action: "zoom", rect: shot(append.at, append.width, format), ms: 620 },
              { action: "cursor", to: { x: 620, y: 400 }, ms: 620 }
            ]
          },
          { action: "hold", ms: 620 },
          { action: "select", target: null, ms: 1 },
          {
            action: "parallel",
            ms: 700,
            steps: [
              { action: "focus", target: { kind: "note", id: NEW_NOTE }, ms: 440 },
              { action: "zoom", rect: shot(middle(PARKED), closeShot(format), format), ms: 700 }
            ]
          },
          { action: "hold", ms: 460 }
        ]
      },

      // It belongs to this conversation, and the toolbar knows where it is.
      {
        id: "stay",
        narration: copy.stayLine,
        steps: [
          {
            action: "parallel",
            ms: 760,
            steps: [
              { action: "focus", target: { kind: "popup" }, ms: 420 },
              { action: "zoom", rect: shot(POPUP_CENTRE, popupShot(format), format), ms: 760 },
              // The pointer travels with the shot rather than being left
              // behind it: a camera that arrives somewhere the cursor is not
              // has a frame with nothing in it to follow, and the pointer
              // spends that frame outside the picture.
              { action: "cursor", to: TOOLBAR_ICON, ms: 760 }
            ]
          },
          { action: "click", ms: 300 },
          { action: "popup", open: true, ms: 1700 },
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
              { action: "zoom", rect: homeView(format), ms: 700 },
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
  }
};
