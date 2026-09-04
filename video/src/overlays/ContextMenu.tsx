// The browser's context menu, drawn by the composition.
//
// In a real browser this menu is painted by the browser, not by the page or the
// extension — so it belongs here, beside the address bar, rather than being
// faked inside the stage. What the extension contributes is two entries, and
// their labels are imported from the extension's own dictionary: the video
// cannot say something the product does not register.
//
// Which entry is highlighted is not stated by the scenario. The pointer is
// already somewhere, and the menu knows where its rows are, so the highlight is
// simply the row under the pointer — the same rule the real menu follows.

import React from "react";
import { en } from "../../../src/locales/en";
import { tr } from "../../../src/locales/tr";
import type { Point } from "../types";

export interface ContextMenuCopy {
  menuCopy: string;
  menuPrint: string;
  menuInspect: string;
}

export interface ContextMenuProps {
  /** Where the menu was opened, in stage coordinates, or null when closed. */
  at: Point | null;
  /** Pointer position, in stage coordinates. */
  cursor: Point;
  lang: string;
  copy: ContextMenuCopy;
  iconSrc: string;
  dir: string;
}

/** Stage-pixel geometry, matching a desktop Chrome menu closely enough to read as one. */
const WIDTH = 252;
const ROW = 28;
const RULE = 9;
const PAD = 6;

type Row = { kind: "item"; label: string; extension: boolean } | { kind: "rule" };

/**
 * The extension's entries as the extension registers them
 * (src/background.ts buildContextMenu). Only two languages have video copy, and
 * anything else is a scenario bug rather than a reason to fall back silently.
 */
function extensionLabels(lang: string): { add: string; append: string } {
  if (lang === "tr") return { add: tr.addNoteHere, append: tr.addSelectionToNote };
  if (lang === "en") return { add: en.addNoteHere, append: en.addSelectionToNote };
  throw new Error(`no context-menu labels for language "${lang}"`);
}

export function contextMenuRows(lang: string, copy: ContextMenuCopy): Row[] {
  const labels = extensionLabels(lang);
  return [
    { kind: "item", label: copy.menuCopy, extension: false },
    { kind: "item", label: copy.menuPrint, extension: false },
    { kind: "rule" },
    { kind: "item", label: labels.add, extension: true },
    { kind: "item", label: labels.append, extension: true },
    { kind: "rule" },
    { kind: "item", label: copy.menuInspect, extension: false }
  ];
}

/** Vertical offset of a row's top edge, from the menu's own top edge. */
export function rowOffset(rows: Row[], index: number): number {
  let offset = PAD;
  for (let i = 0; i < index; i += 1) offset += rows[i].kind === "rule" ? RULE : ROW;
  return offset;
}

/**
 * The box the menu occupies, in stage coordinates.
 *
 * A scenario frames the menu with an ordinary `zoom` rather than the camera
 * correcting for it: the menu appears in a single frame, and a shot that
 * widened to catch it would widen in a single frame too — which reads as a
 * glitch rather than as a camera move. Easing to a stated shot instead makes
 * the same correction deliberate.
 */
export function menuBounds(at: Point, lang: string, copy: ContextMenuCopy): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  const rows = contextMenuRows(lang, copy);
  const height = rows.reduce((total, row) => total + (row.kind === "rule" ? RULE : ROW), PAD * 2);
  return { x: at.x, y: at.y, width: WIDTH, height };
}

/** Centre of the menu, for a scenario to aim a shot at. */
export function menuCentre(at: Point, lang: string, copy: ContextMenuCopy): Point {
  const box = menuBounds(at, lang, copy);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Where a scenario aims the pointer to reach a row.
 *
 * Over the label rather than at the row's centre: it is where a hand actually
 * stops, and it keeps the pointer near the corner the menu opened from instead
 * of carrying it a full menu-width to the right — which on a phone-shaped frame
 * is far enough to leave the shot.
 */
const ROW_REACH = 46;

export function menuRowPoint(at: Point, lang: string, copy: ContextMenuCopy, index: number): Point {
  const rows = contextMenuRows(lang, copy);
  if (rows[index]?.kind !== "item") {
    throw new Error(`context menu row ${index} is not something that can be clicked`);
  }
  return { x: at.x + ROW_REACH, y: at.y + rowOffset(rows, index) + ROW / 2 };
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
  at,
  cursor,
  lang,
  copy,
  iconSrc,
  dir
}) => {
  if (at === null) return null;

  const rows = contextMenuRows(lang, copy);
  const height = rows.reduce((total, row) => total + (row.kind === "rule" ? RULE : ROW), PAD * 2);
  const inside = cursor.x >= at.x && cursor.x <= at.x + WIDTH;

  return (
    <div
      dir={dir}
      style={{
        position: "absolute",
        left: at.x,
        top: at.y,
        width: WIDTH,
        padding: `${PAD}px 0`,
        boxSizing: "border-box",
        height,
        borderRadius: 8,
        border: "1px solid rgba(0, 0, 0, 0.11)",
        backgroundColor: "#ffffff",
        boxShadow: "0 2px 6px rgba(0,0,0,0.12), 0 10px 28px rgba(0,0,0,0.16)",
        fontFamily: '-apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        fontSize: 13,
        color: "#1f1f1f",
        pointerEvents: "none",
        userSelect: "none"
      }}
    >
      {rows.map((row, index) => {
        if (row.kind === "rule") {
          return (
            <div
              key={`rule-${index}`}
              style={{ height: RULE, display: "flex", alignItems: "center", padding: "0 8px" }}
            >
              <div style={{ height: 1, width: "100%", backgroundColor: "rgba(0,0,0,0.09)" }} />
            </div>
          );
        }

        const top = at.y + rowOffset(rows, index);
        const hovered = inside && cursor.y >= top && cursor.y < top + ROW;

        return (
          <div
            key={row.label}
            style={{
              height: ROW,
              display: "flex",
              alignItems: "center",
              gap: 9,
              padding: "0 12px",
              backgroundColor: hovered ? "#e8f0fe" : "transparent"
            }}
          >
            {/* Chrome shows an extension's own icon beside the entries it
                contributes, which is also what tells the viewer these two rows
                came from the product rather than from the browser. */}
            {row.extension ? (
              <img src={iconSrc} alt="" style={{ width: 15, height: 15, borderRadius: 3 }} />
            ) : (
              <span style={{ width: 15 }} />
            )}
            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {row.label}
            </span>
          </div>
        );
      })}
    </div>
  );
};
