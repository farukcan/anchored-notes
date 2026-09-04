// Scenario schema. A scenario is data: a stage to play on and an ordered list of
// steps. The engine never learns anything scenario-specific — adding a video
// means adding a file under scenarios/, not touching src/.

import type { SfxName } from "./audio/sfxTypes";

export type NoteColor = "yellow" | "green" | "pink" | "purple" | "blue" | "gray" | "dark";
export type AnchorScope = "global" | "site" | "page" | "tab";

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A note as the extension stores it. Mirrors src/types.ts Note. */
export interface Note {
  id: string;
  content: string;
  color: NoteColor;
  scope: AnchorScope;
  anchorKey: string;
  x: number;
  y: number;
  w: number;
  h: number;
  hidden?: boolean;
  createdAt: number;
  updatedAt: number;
}

export type NotesMap = Record<string, Note>;

/**
 * Steps run in sequence, each for `ms` milliseconds. Everything a step changes
 * is a function of elapsed time, never of what happened on the previous frame —
 * Remotion renders frames out of order and in parallel, so state must be
 * derivable from the timeline alone.
 */
export type Step =
  /** Nothing moves. Room to read what is on screen. */
  | { action: "hold"; ms: number }
  /** Glide the pointer to a stage coordinate. */
  | { action: "cursor"; to: Point; ms: number }
  /** Click ripple at the current pointer position. */
  | { action: "click"; ms: number }
  /**
   * Add a note where the popup's "add note" would put one: centered, 220x200,
   * page-scoped (src/content/index.ts newNote()). Declared rather than sent as a
   * CREATE_NOTE message, because a message would create a fresh note on every
   * frame it is replayed — the scene has to be a function of time alone. The
   * colour is fixed instead of random for the same reason.
   */
  | { action: "createNote"; id: string; content: string; ms: number }
  /** Reveal `text` character by character, as if typed into the note. */
  | { action: "type"; id: string; text: string; ms: number }
  /**
   * Drag-select a passage on the page, or clear the selection when `target` is
   * null. `target` is the id of an element in the stage.
   *
   * The step says *that* a drag is happening, not how far it has got: how much
   * is selected is whatever the pointer is over, exactly as in a real browser.
   * Move the pointer across the passage in the same window — a `parallel` of a
   * `select` and a `cursor` — and the highlight follows it by construction
   * instead of being a second animation that has to be kept in step.
   */
  | { action: "select"; target: string | null; ms: number }
  /**
   * Open the browser's context menu at the pointer, or close it when `at` is
   * null. Drawn by the composition rather than by the page, because in a real
   * browser it is drawn by the browser; the entries that matter are the
   * extension's own, and they carry the labels the extension registers.
   */
  | { action: "contextMenu"; at: Point | null; ms: number }
  /**
   * Append a selection to an existing note as a block quote, the way
   * src/content/note-card.ts appendBlockquote() does. Instant, not typed: the
   * text arrives from the context menu, not from the keyboard.
   */
  | { action: "appendQuote"; id: string; text: string; ms: number }
  /** Drag a note to a new stage position. */
  | { action: "move"; id: string; to: Point; ms: number }
  /** Open a note's ⋮ options menu, or close it. */
  | { action: "noteMenu"; id: string | null; ms: number }
  /** Collapse a note into the bottom-right badge, or bring it back. */
  | { action: "setHidden"; id: string; hidden: boolean; ms: number }
  /** Open the badge's list of hidden notes. */
  | { action: "badgeList"; open: boolean; ms: number }
  /** Show the extension popup over the stage. */
  | { action: "popup"; open: boolean; ms: number }
  /** Zoom the stage to a region, or back out when `rect` is null. */
  | { action: "zoom"; rect: Rect | null; ms: number }
  /**
   * Blur everything that is not the subject, or lift the blur when `target` is
   * null. Unlike `zoom` the framing does not change — the whole window stays in
   * shot, only what matters right now stays legible.
   */
  | { action: "focus"; target: FocusTarget | null; ms: number }
  /**
   * An extra sound, on top of what src/audio/cues.ts already derives from the
   * other steps. For a moment the step vocabulary cannot express on its own —
   * a scenario punctuating its own closing card, say. Ordinary beats need
   * nothing here.
   */
  | { action: "sfx"; name: SfxName; pitch?: number; note: string; ms: number }
  /**
   * Run several steps over the same stretch of time. Steps are otherwise
   * strictly sequential, which is what a shot pushing in while the blur comes
   * up needs an escape from. Each child runs on its own `ms`, so they can start
   * together and finish apart.
   */
  | { action: "parallel"; steps: Step[]; ms: number }
  /** Fade the closing card over the frame. */
  | { action: "outro"; ms: number };

/** Output shapes a scenario is written for. */
export type FormatName = "16-9" | "9-16";

/**
 * A stretch of the video with one thing to say.
 *
 * A beat is the unit the narration is aligned to: its steps supply a natural
 * duration, and when a voiceover exists the measured length of the spoken line
 * wins instead, with the steps inside scaled to match (src/beats.ts). That is
 * what keeps the camera and the sentence finishing together without anyone
 * hand-tuning milliseconds against a waveform.
 */
export interface Beat {
  /** Unique within the scenario. The voice timeline and the captions key on it. */
  id: string;
  /** What is said over this beat, or null for a beat that is only movement. */
  narration: string | null;
  steps: Step[];
}

/**
 * How a video wins its first seconds. Stated as data so it can be checked:
 * `payoffBeat` must name a real beat, and `onScreenText` has to carry the
 * promise on its own for the majority of viewers who watch muted.
 */
export interface Hook {
  formula:
    | "curiosity_gap"
    | "question"
    | "bold_statement"
    | "payoff_preview"
    | "mid_action"
    | "shock"
    | "loop";
  /** The gap opened in the first seconds, in one sentence. */
  gap: string;
  /** The beat that closes it. Verified against the beat list at build time. */
  payoffBeat: string;
  /** Two to five words, set large. Must mean something with the sound off. */
  onScreenText: string;
}

export interface Scenario {
  id: string;
  /** Stage template name under stages/ (without .html). */
  stage: string;
  /** Languages this scenario has copy for. */
  langs: string[];
  /** Notes present before the first step. */
  seed: "demo" | "none";
  hook: (lang: string) => Hook;
  /**
   * The timeline, built per language and per format. A scenario owns its own
   * words — what it says is as particular to it as what it does, so the strings
   * live in its file rather than in one deck every video has to share.
   *
   * Format is a parameter rather than a post-processing step because a vertical
   * cut is not a crop of the wide one: it pushes in harder and drops beats, and
   * only the scenario knows which beats it can lose.
   */
  build: (lang: string, format: FormatName) => Beat[];
}

/**
 * What the scene is asking the viewer to look at. Named by role rather than by
 * rectangle: the thing to keep sharp is a real element, so it can be blurred
 * with a plain CSS filter on that element. A geometric cut-out is not an option
 * — `backdrop-filter` loses the stage frame's content wherever it is masked
 * away, which leaves the focus region blank instead of sharp.
 */
export type FocusTarget =
  /** One note card. Every other card steps back with the page. */
  | { kind: "note"; id: string }
  /** The badge that collects hidden notes. */
  | { kind: "badge" }
  /** The popup hanging off the toolbar; the whole page steps back. */
  | { kind: "popup" };

/**
 * Blur strength per role, 0 (sharp) to 1 (fully blurred).
 *
 * Resolved strengths rather than a target, so one target can dissolve into the
 * next: during the handover the outgoing subject blurs while the incoming one
 * clears, instead of both switching on a single frame.
 *
 * The browser chrome is deliberately absent: the address bar is what tells the
 * viewer this is a real browser, so it is never blurred.
 */
export interface FocusState {
  /** The page behind the notes. */
  page: number;
  /** The hidden-notes badge. */
  badge: number;
  /** Per-note overrides; a card not listed here follows `page`. */
  notes: Record<string, number>;
}

/** Everything the engine derives from a scenario at a point in time. */
export interface SceneState {
  notes: NotesMap;
  cursor: Point;
  /** 0 at rest, 1 at the instant of the click — drives the ripple. */
  clickProgress: number;
  zoom: Rect | null;
  focus: FocusState;
  /** The passage being dragged through, if any. How much is covered follows the pointer. */
  selection: string | null;
  /** Where the browser's context menu is open, if it is. */
  contextMenu: Point | null;
  /**
   * Note being typed into, if any — it gets a text caret at the end of its
   * content, and the pointer turns into an I-beam. Set only while a `type` step
   * is running, so the caret leaves when the typing stops.
   */
  caret: string | null;
  popupOpen: boolean;
  badgeListOpen: boolean;
  /** Note whose ⋮ menu is open, if any. */
  openMenuNoteId: string | null;
  /** 0 → no closing card, 1 → it fully covers the frame. */
  outroProgress: number;
}
