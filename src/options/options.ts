// Options page: list, search, delete, export and import all notes.

import type { Note } from "../types.js";
import { deleteNote, getAllNotes, onNotesChanged, replaceAllNotes } from "../storage.js";
import { deriveTitle } from "../note-title.js";
import { formatRelativeTime } from "../relative-time.js";
import { initI18n, onLangChanged, t } from "../i18n.js";

const SWATCH: Record<string, string> = {
  yellow: "#fcee5f",
  green: "#c9f0c0",
  pink: "#fbd0e2",
  purple: "#e6dcfb",
  blue: "#bcdcfb",
  gray: "#ececec",
  dark: "#4a4a4a"
};

let query = "";
const expanded = new Set<string>();

function matchesQuery(note: Note): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return note.content.toLowerCase().includes(q) || note.anchorKey.toLowerCase().includes(q) || note.scope.includes(q);
}

async function render(): Promise<void> {
  const rows = document.getElementById("rows") as HTMLTableSectionElement;
  const empty = document.getElementById("empty") as HTMLDivElement;
  const notes = (await getAllNotes()).filter(matchesQuery).sort((a, b) => b.createdAt - a.createdAt);

  rows.replaceChildren();
  empty.hidden = notes.length > 0;

  for (const note of notes) {
    const tr = document.createElement("tr");

    const tdNote = document.createElement("td");
    tdNote.className = "title";
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = SWATCH[note.color] ?? "#ccc";
    tdNote.append(swatch, document.createTextNode(deriveTitle(note.content)));

    const tdScope = document.createElement("td");
    tdScope.textContent = note.scope;

    const tdAnchor = document.createElement("td");
    tdAnchor.className = "anchor";
    if (note.anchorKey.startsWith("http")) {
      const link = document.createElement("a");
      link.href = note.anchorKey;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = note.anchorKey;
      link.addEventListener("click", (e) => e.stopPropagation());
      tdAnchor.appendChild(link);
    } else {
      tdAnchor.textContent = note.anchorKey || "—";
    }

    const tdDate = document.createElement("td");
    tdDate.textContent = formatRelativeTime(note.createdAt);

    const tdActions = document.createElement("td");
    const del = document.createElement("button");
    del.textContent = t("delete", null);
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      if (note.content.trim() && !window.confirm(t("deleteConfirm", null))) return;
      void deleteNote(note.id);
    });
    tdActions.appendChild(del);

    const detail = document.createElement("tr");
    detail.className = "detail";
    detail.hidden = !expanded.has(note.id);
    const tdDetail = document.createElement("td");
    tdDetail.colSpan = 5;
    const content = document.createElement("div");
    content.className = "content";
    content.textContent = note.content || t("empty", null);
    tdDetail.appendChild(content);
    detail.appendChild(tdDetail);

    tr.addEventListener("click", () => {
      if (expanded.has(note.id)) expanded.delete(note.id);
      else expanded.add(note.id);
      detail.hidden = !expanded.has(note.id);
    });

    tr.append(tdNote, tdScope, tdAnchor, tdDate, tdActions);
    rows.append(tr, detail);
  }
}

function exportNotes(): void {
  void getAllNotes().then((notes) => {
    const blob = new Blob([JSON.stringify(notes, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `anchored-notes-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

const SCOPES = new Set(["global", "site", "page", "tab"]);

function isValidNote(value: unknown): value is Note {
  if (typeof value !== "object" || value === null) return false;
  const n = value as Record<string, unknown>;
  return (
    typeof n.id === "string" &&
    typeof n.content === "string" &&
    typeof n.color === "string" &&
    n.color in SWATCH &&
    typeof n.scope === "string" &&
    SCOPES.has(n.scope) &&
    typeof n.anchorKey === "string" &&
    typeof n.x === "number" &&
    typeof n.y === "number" &&
    typeof n.w === "number" &&
    typeof n.h === "number" &&
    typeof n.createdAt === "number" &&
    typeof n.updatedAt === "number"
  );
}

async function importNotes(file: File): Promise<void> {
  const text = await file.text();
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed) || !parsed.every(isValidNote)) {
    window.alert(t("invalidNotesFile", null));
    return;
  }
  if (!window.confirm(t("importConfirm", { count: parsed.length }))) return;
  await replaceAllNotes(parsed);
}

function applyStaticText(): void {
  document.title = t("optionsTitle", null);
  (document.getElementById("search") as HTMLInputElement).placeholder = t("searchPlaceholder", null);
  (document.getElementById("export") as HTMLButtonElement).textContent = t("exportJson", null);
  (document.getElementById("import") as HTMLButtonElement).textContent = t("importJson", null);
  (document.getElementById("col-note") as HTMLTableCellElement).textContent = t("colNote", null);
  (document.getElementById("col-scope") as HTMLTableCellElement).textContent = t("colScope", null);
  (document.getElementById("col-anchor") as HTMLTableCellElement).textContent = t("colAnchor", null);
  (document.getElementById("col-created") as HTMLTableCellElement).textContent = t("colCreated", null);
  (document.getElementById("empty") as HTMLDivElement).textContent = t("noNotesYet", null);
}

document.getElementById("search")?.addEventListener("input", (e) => {
  query = (e.target as HTMLInputElement).value;
  void render();
});

document.getElementById("export")?.addEventListener("click", exportNotes);

document.getElementById("import")?.addEventListener("click", () => {
  (document.getElementById("file") as HTMLInputElement).click();
});

document.getElementById("file")?.addEventListener("change", (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) void importNotes(file);
});

onNotesChanged(() => void render());
onLangChanged(() => {
  applyStaticText();
  void render();
});

async function main(): Promise<void> {
  await initI18n();
  applyStaticText();
  await render();
}

void main();
