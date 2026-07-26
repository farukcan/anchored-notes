// Floating toolbar for editing GFM tables. It appears above the table the caret
// is currently in and exposes buttons to add/remove rows and columns and to
// delete the whole table. Themeless and shadow-DOM friendly (fixed strategy).

import { $prose } from "@milkdown/utils";
import { Plugin, PluginKey } from "@milkdown/prose/state";
import {
  addColumnAfter,
  addRowAfter,
  deleteColumn,
  deleteRow,
  deleteTable,
  isInTable
} from "@milkdown/prose/tables";
import type { Command } from "@milkdown/prose/state";
import type { EditorView } from "@milkdown/prose/view";
import { t, type MessageKey } from "../i18n.js";
import { track } from "../umami.js";

interface ToolbarButton {
  label: string;
  titleKey: MessageKey;
  /** Distinct Umami event name for this toolbar action. */
  event: string;
  command: Command;
}

const BUTTONS: ToolbarButton[] = [
  { label: "+Col", titleKey: "tableAddColumn", event: "table_add_column", command: addColumnAfter },
  { label: "−Col", titleKey: "tableDeleteColumn", event: "table_delete_column", command: deleteColumn },
  { label: "+Row", titleKey: "tableAddRow", event: "table_add_row", command: addRowAfter },
  { label: "−Row", titleKey: "tableDeleteRow", event: "table_delete_row", command: deleteRow },
  { label: "✕", titleKey: "tableDeleteTable", event: "table_delete_table", command: deleteTable }
];

export function tableToolbarPlugin(rootEl: HTMLElement): ReturnType<typeof $prose> {
  return $prose(() => {
    const toolbar = document.createElement("div");
    toolbar.className = "table-toolbar";
    toolbar.dataset.show = "false";

    return new Plugin({
      key: new PluginKey("anchored-table-toolbar"),
      view: (view) => {
        for (const btn of BUTTONS) {
          const el = document.createElement("button");
          el.type = "button";
          el.className = "table-toolbar-btn";
          el.textContent = btn.label;
          el.title = t(btn.titleKey, null);
          el.addEventListener("mousedown", (e) => {
            e.preventDefault(); // keep the table cell selection in the editor
            view.focus();
            btn.command(view.state, view.dispatch);
            void track(btn.event, { source: "card" });
          });
          toolbar.appendChild(el);
        }
        rootEl.appendChild(toolbar);

        const reposition = (v: EditorView): void => {
          if (!isInTable(v.state)) {
            toolbar.dataset.show = "false";
            return;
          }
          const { node } = v.domAtPos(v.state.selection.from);
          const cell = node instanceof HTMLElement ? node : node.parentElement;
          const table = cell?.closest("table");
          if (!table) {
            toolbar.dataset.show = "false";
            return;
          }
          const rect = table.getBoundingClientRect();
          toolbar.style.top = `${rect.top}px`;
          toolbar.style.left = `${rect.left}px`;
          toolbar.dataset.show = "true";
        };

        reposition(view);

        return {
          update: (v) => reposition(v),
          destroy: () => toolbar.remove()
        };
      }
    });
  });
}
