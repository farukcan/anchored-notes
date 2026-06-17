// Notion-style "/" slash menu for the Milkdown editor. The plugin-slash package
// only provides triggering + positioning; the menu UI, filtering, keyboard
// navigation and command dispatch are implemented here (themeless, shadow-DOM
// friendly via floating-ui's fixed strategy).

import { commandsCtx, editorViewCtx } from "@milkdown/core";
import { SlashProvider, slashFactory } from "@milkdown/plugin-slash";
import {
  createCodeBlockCommand,
  insertHrCommand,
  turnIntoTextCommand,
  wrapInBlockquoteCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand
} from "@milkdown/preset-commonmark";
import { insertTableCommand } from "@milkdown/preset-gfm";
import { TextSelection } from "@milkdown/prose/state";
import type { EditorState, PluginSpec } from "@milkdown/prose/state";
import type { EditorView } from "@milkdown/prose/view";
import type { Ctx } from "@milkdown/ctx";

interface SlashItem {
  label: string;
  icon: string;
  run: (ctx: Ctx) => void;
}

// GFM has no "wrap in task list" command: wrap in a bullet list, then flag the
// enclosing list_item as an (unchecked) task item via its `checked` attribute.
function wrapInTaskList(ctx: Ctx): void {
  ctx.get(commandsCtx).call(wrapInBulletListCommand.key);
  const view = ctx.get(editorViewCtx);
  const { state } = view;
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === "list_item") {
      const pos = $from.before(depth);
      view.dispatch(state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: false }));
      break;
    }
  }
}

const ITEMS: SlashItem[] = [
  { label: "Text", icon: "¶", run: (ctx) => ctx.get(commandsCtx).call(turnIntoTextCommand.key) },
  { label: "Heading 1", icon: "H1", run: (ctx) => ctx.get(commandsCtx).call(wrapInHeadingCommand.key, 1) },
  { label: "Heading 2", icon: "H2", run: (ctx) => ctx.get(commandsCtx).call(wrapInHeadingCommand.key, 2) },
  { label: "Heading 3", icon: "H3", run: (ctx) => ctx.get(commandsCtx).call(wrapInHeadingCommand.key, 3) },
  { label: "Bullet List", icon: "•", run: (ctx) => ctx.get(commandsCtx).call(wrapInBulletListCommand.key) },
  { label: "Ordered List", icon: "1.", run: (ctx) => ctx.get(commandsCtx).call(wrapInOrderedListCommand.key) },
  { label: "Task List", icon: "☑", run: wrapInTaskList },
  { label: "Quote", icon: "❝", run: (ctx) => ctx.get(commandsCtx).call(wrapInBlockquoteCommand.key) },
  { label: "Code", icon: "</>", run: (ctx) => ctx.get(commandsCtx).call(createCodeBlockCommand.key) },
  { label: "Table", icon: "▦", run: (ctx) => ctx.get(commandsCtx).call(insertTableCommand.key) },
  { label: "Divider", icon: "―", run: (ctx) => ctx.get(commandsCtx).call(insertHrCommand.key) }
];

// Text of the current paragraph up to the cursor, used to detect "/query".
function slashQuery(view: EditorView): string | null {
  const { selection } = view.state;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const { $from } = selection;
  if ($from.parent.type.name !== "paragraph") return null;
  const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
  const match = /(?:^|\s)\/([^\s/]*)$/.exec(before);
  return match ? match[1] : null;
}

export interface SlashMenu {
  plugin: ReturnType<typeof slashFactory>;
  configure: (ctx: Ctx) => void;
}

export function createSlashMenu(rootEl: HTMLElement): SlashMenu {
  const plugin = slashFactory("anchored-slash");
  const menu = document.createElement("div");
  menu.className = "slash-menu";
  menu.dataset.show = "false";

  let filtered: SlashItem[] = ITEMS;
  let selected = 0;
  let view: EditorView | null = null;
  let ctxRef: Ctx | null = null;

  function render(): void {
    menu.replaceChildren();
    filtered.forEach((item, i) => {
      const row = document.createElement("div");
      row.className = i === selected ? "slash-item active" : "slash-item";
      const icon = document.createElement("span");
      icon.className = "slash-icon";
      icon.textContent = item.icon;
      const label = document.createElement("span");
      label.textContent = item.label;
      row.append(icon, label);
      row.addEventListener("mousedown", (e) => {
        e.preventDefault(); // keep editor focus
        if (view) select(view, item);
      });
      menu.appendChild(row);
    });
  }

  const provider = new SlashProvider({
    content: menu,
    root: rootEl,
    trigger: "/",
    floatingUIOptions: { strategy: "fixed" },
    shouldShow: (v) => {
      const q = slashQuery(v);
      if (q === null) return false;
      filtered = ITEMS.filter((it) => it.label.toLowerCase().includes(q.toLowerCase()));
      if (filtered.length === 0) return false;
      if (selected >= filtered.length) selected = 0;
      return true;
    }
  });
  provider.onShow = render;

  function select(v: EditorView, item: SlashItem): void {
    const { $from } = v.state.selection;
    const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
    const match = /(?:^|\s)(\/[^\s/]*)$/.exec(before);
    if (match) {
      const to = $from.pos;
      v.dispatch(v.state.tr.delete(to - match[1].length, to));
    }
    v.focus();
    if (ctxRef) item.run(ctxRef);
    provider.hide();
    selected = 0;
  }

  function configure(ctx: Ctx): void {
    ctxRef = ctx;
    const spec: PluginSpec<unknown> = {
      view: () => ({
        update: (v: EditorView, prev?: EditorState) => {
          view = v;
          provider.update(v, prev);
        },
        destroy: () => provider.destroy()
      }),
      props: {
        handleKeyDown: (v: EditorView, event: KeyboardEvent): boolean => {
          if (menu.dataset.show !== "true") return false;
          switch (event.key) {
            case "ArrowDown":
              selected = (selected + 1) % filtered.length;
              render();
              return true;
            case "ArrowUp":
              selected = (selected - 1 + filtered.length) % filtered.length;
              render();
              return true;
            case "Enter":
              select(v, filtered[selected]);
              return true;
            case "Escape":
              provider.hide();
              return true;
            default:
              return false;
          }
        }
      }
    };
    ctx.set(plugin.key, spec);
  }

  return { plugin, configure };
}
