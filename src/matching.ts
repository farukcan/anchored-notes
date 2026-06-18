// Pure functions deciding whether a note is visible in a given page context
// and how to derive a note's anchorKey for a chosen scope.

import type { AnchorScope, Note, PageContext } from "./types.js";

export function anchorKeyFor(scope: AnchorScope, ctx: PageContext): string {
  switch (scope) {
    case "global":
      return "";
    case "site":
      return ctx.origin;
    case "page":
      return ctx.urlNoHash;
    case "tab":
      return String(ctx.tabId);
  }
}

export function isNoteVisible(note: Note, ctx: PageContext): boolean {
  switch (note.scope) {
    case "global":
      return true;
    case "site":
      return note.anchorKey === ctx.origin;
    case "page":
      return note.anchorKey === ctx.urlNoHash;
    case "tab":
      return note.anchorKey === String(ctx.tabId);
  }
}

export function pageContextFromLocation(href: string, tabId: number): PageContext {
  const url = new URL(href);
  return {
    origin: url.origin,
    urlNoHash: url.origin + url.pathname + url.search,
    tabId
  };
}

export function shortDomainFromHostname(hostname: string): string {
  return hostname.replace(/^www\./i, "");
}
