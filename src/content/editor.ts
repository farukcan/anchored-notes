// Thin wrapper around a themeless Milkdown (commonmark) editor mounted into a
// host element. Reports markdown on every change and can be torn down.
// Includes a Notion-style "/" slash menu and markdown-aware paste (clipboard).

import { Editor, defaultValueCtx, rootCtx } from "@milkdown/core";
import { commonmark, listItemSchema } from "@milkdown/preset-commonmark";
import { gfm } from "@milkdown/preset-gfm";
import { listener, listenerCtx } from "@milkdown/plugin-listener";
import { clipboard } from "@milkdown/plugin-clipboard";
import { $view } from "@milkdown/utils";
import type { Node as ProseNode } from "@milkdown/prose/model";
import { createSlashMenu } from "./slash-menu.js";
import { tableToolbarPlugin } from "./table-toolbar.js";

export interface MarkdownEditorHandle {
  destroy: () => void;
}

// Render GFM task list items (list_item with a non-null `checked` attribute) as
// an interactive checkbox; plain list items keep their default rendering.
const taskListItemView = $view(listItemSchema.node, () => (node, view, getPos) => {
  let current = node;
  const li = document.createElement("li");
  const contentDOM = document.createElement("div");
  contentDOM.className = "list-item-content";
  let checkbox: HTMLInputElement | null = null;

  const render = (n: ProseNode): void => {
    if (n.attrs.checked == null) {
      li.removeAttribute("data-item-type");
      checkbox?.remove();
      checkbox = null;
      return;
    }
    li.dataset.itemType = "task";
    if (!checkbox) {
      checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "task-checkbox";
      checkbox.contentEditable = "false";
      checkbox.addEventListener("mousedown", (e) => e.preventDefault());
      checkbox.addEventListener("change", () => {
        const pos = getPos();
        if (pos == null) return;
        view.dispatch(
          view.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, checked: checkbox!.checked })
        );
      });
      li.prepend(checkbox);
    }
    checkbox.checked = n.attrs.checked === true;
  };

  li.appendChild(contentDOM);
  render(current);

  return {
    dom: li,
    contentDOM,
    update: (updated) => {
      if (updated.type.name !== "list_item") return false;
      current = updated;
      render(updated);
      return true;
    }
  };
});

export function createMarkdownEditor(
  host: HTMLElement,
  menuRoot: HTMLElement,
  initial: string,
  onChange: (markdown: string) => void
): MarkdownEditorHandle {
  const slash = createSlashMenu(menuRoot);
  let editor: Editor | undefined;
  const ready = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, host);
      ctx.set(defaultValueCtx, initial);
      ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => onChange(markdown));
    })
    .config(slash.configure)
    .use(commonmark)
    .use(gfm)
    .use(taskListItemView)
    .use(listener)
    .use(clipboard)
    .use(slash.plugin)
    .use(tableToolbarPlugin(menuRoot))
    .create()
    .then((created) => {
      editor = created;
    });

  return {
    destroy: () => void ready.then(() => editor?.destroy())
  };
}
