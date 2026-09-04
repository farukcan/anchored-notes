// The only words every video shares: the line on the closing card.
//
// Everything else a video says — its captions, the markdown it types — belongs
// to one scenario and lives in that scenario's file. Deliberately separate from
// store-assets/gen/i18n.mjs: that deck describes the product in a still frame,
// this one closes a video. The two share tone, not sentences.
//
// A scenario may only list a language in `langs` once it resolves here and in
// the scenario's own deck.

export interface SharedCopy {
  /** Closing card. */
  outroTagline: string;
  /**
   * What the closing card asks for. Phrased as the button the viewer will
   * actually press, so the next step is obvious without the card claiming
   * anything — no rating, no install count, no feature the video did not show.
   */
  outroCta: string;
  /**
   * The browser's own context-menu entries, around the extension's.
   *
   * Deliberately the plainest ones a menu has: naming a search engine or a
   * screenshot tool would put another product's name in the frame, and none of
   * them is what the shot is about.
   */
  menuCopy: string;
  menuPrint: string;
  menuInspect: string;
}

export const SHARED_COPY: Record<string, SharedCopy> = {
  en: {
    outroTagline: "Sticky notes that stay where you put them.",
    outroCta: "Add to Chrome",
    menuCopy: "Copy",
    menuPrint: "Print…",
    menuInspect: "Inspect"
  },
  tr: {
    outroTagline: "Bıraktığın yerde kalan yapışkan notlar.",
    outroCta: "Chrome'a Ekle",
    menuCopy: "Kopyala",
    menuPrint: "Yazdır…",
    menuInspect: "İncele"
  }
};

/**
 * Resolve a language out of a copy deck, or say which deck is missing it. Used
 * by every scenario for its own strings, so a missing translation is an error
 * with a name on it rather than a video that renders in the wrong language.
 */
export function pickCopy<T>(deck: Record<string, T>, lang: string, deckName: string): T {
  const found = deck[lang];
  if (!found) throw new Error(`no ${deckName} copy for language "${lang}"`);
  return found;
}

export function copyFor(lang: string): SharedCopy {
  return pickCopy(SHARED_COPY, lang, "shared");
}
