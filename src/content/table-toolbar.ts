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

interface ToolbarButton {
  label: string;
  title: string;
  command: Command;
}

const BUTTONS: ToolbarButton[] = [
  { label: "+Col", title: "Add column", command: addColumnAfter },
  { label: "−Col", title: "Delete column", command: deleteColumn },
  { label: "+Row", title: "Add row", command: addRowAfter },
  { label: "−Row", title: "Delete row", command: deleteRow },
  { label: "✕", title: "Delete table", command: deleteTable }
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
          el.title = btn.title;
          el.addEventListener("mousedown", (e) => {
            e.preventDefault(); // keep the table cell selection in the editor
            view.focus();
            btn.command(view.state, view.dispatch);
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
