// The store-asset copy deck is plain ESM shared with store-assets/gen. Typing it
// here keeps that file untouched while the video code still gets checked.
declare module "*/store-assets/gen/i18n.mjs" {
  export interface LangEntry {
    /** Extension UI language code (src/i18n.ts Lang). */
    ext: string;
    dir: "ltr" | "rtl";
    fontHref: string;
    fontHead: string;
    fontBody: string;
    demo: Record<string, string>;
    notes: { n1: string; n2: string; n3: string };
    tiles: Record<string, string>;
  }

  export const LANGS: Record<string, LangEntry>;
  export function templateVars(code: string): Record<string, string>;
  export function renderTemplate(html: string, vars: Record<string, string>): string;
}
