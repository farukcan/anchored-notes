// Thin wrapper around a themeless Milkdown (commonmark) editor mounted into a
// host element. Reports markdown on every change and can be torn down.
// Includes a Notion-style "/" slash menu and markdown-aware paste (clipboard).

import { Editor, commandsCtx, defaultValueCtx, editorViewCtx, rootCtx } from "@milkdown/core";
import { commonmark, listItemSchema, liftListItemCommand } from "@milkdown/preset-commonmark";
import { gfm } from "@milkdown/preset-gfm";
import { listener, listenerCtx } from "@milkdown/plugin-listener";
import { clipboard } from "@milkdown/plugin-clipboard";
import { $prose, $useKeymap, $view, replaceAll } from "@milkdown/utils";
import { history, undo, redo } from "@milkdown/prose/history";
import { TextSelection } from "@milkdown/prose/state";
import type { Node as ProseNode } from "@milkdown/prose/model";
import { createSlashMenu } from "./slash-menu.js";
import { tableToolbarPlugin } from "./table-toolbar.js";

export interface MarkdownEditorHandle {
  destroy: () => void;
  // Replace the whole document, e.g. when a newer version arrives from sync.
  // When scrollToEnd is set, move the caret to the end and scroll it into view.
  replace: (markdown: string, opts?: { scrollToEnd?: boolean }) => void;
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

// Pressing Enter in an empty list item lifts it out of the list instead of
// creating yet another (attribute-inheriting) item. Without this, splitListItem
// keeps copying the `checked` attribute, so a task list can never be exited and
// every following block stays a task item. Runs before commonmark's Enter
// (priority > the default 50) and falls through when not in an empty list item.
const exitListItemKeymap = $useKeymap("anchoredExitListItem", {
  ExitEmptyListItem: {
    shortcuts: "Enter",
    priority: 100,
    command: (ctx) => () => {
      const view = ctx.get(editorViewCtx);
      const { state } = view;
      const sel = state.selection;
      if (!(sel instanceof TextSelection) || !sel.empty) return false;
      const { $from } = sel;
      if ($from.parent.content.size !== 0) return false;
      const listItem = $from.node(-1);
      if (listItem?.type.name !== "list_item") return false;
      return ctx.get(commandsCtx).call(liftListItemCommand.key);
    }
  }
});

// Undo/redo. The commonmark preset does not register prosemirror-history, so
// without this the editor has no edit history and Mod-z/Mod-y do nothing.
const historyPlugin = $prose(() => history());

const historyKeymap = $useKeymap("anchoredHistory", {
  Undo: {
    shortcuts: "Mod-z",
    command: (ctx) => () => {
      const view = ctx.get(editorViewCtx);
      return undo(view.state, view.dispatch);
    }
  },
  Redo: {
    shortcuts: ["Mod-y", "Mod-Shift-z"],
    command: (ctx) => () => {
      const view = ctx.get(editorViewCtx);
      return redo(view.state, view.dispatch);
    }
  }
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
    .use(historyPlugin)
    .use(historyKeymap)
    .use(exitListItemKeymap)
    .use(listener)
    .use(clipboard)
    .use(slash.plugin)
    .use(tableToolbarPlugin(menuRoot))
    .create()
    .then((created) => {
      editor = created;
    });

  return {
    destroy: () => void ready.then(() => editor?.destroy()),
    replace: (markdown: string, opts?: { scrollToEnd?: boolean }) =>
      void ready.then(() => {
        if (!editor) return;
        editor.action(replaceAll(markdown));
        if (!opts?.scrollToEnd) return;
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          const sel = TextSelection.atEnd(view.state.doc);
          view.dispatch(view.state.tr.setSelection(sel).scrollIntoView());
          const scroller = view.dom.closest(".note-body");
          if (scroller instanceof HTMLElement) {
            scroller.scrollTop = scroller.scrollHeight;
          }
        });
      }),
  };
}
