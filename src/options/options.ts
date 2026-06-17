// Options page: list, search, delete, export and import all notes.

import type { Note } from "../types.js";
import { deleteNote, getAllNotes, onNotesChanged, replaceAllNotes } from "../storage.js";

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

function formatDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = SWATCH[note.color] ?? "#ccc";
    tdNote.append(swatch, document.createTextNode(note.content || "(empty)"));

    const tdScope = document.createElement("td");
    tdScope.textContent = note.scope;

    const tdAnchor = document.createElement("td");
    tdAnchor.className = "anchor";
    tdAnchor.textContent = note.anchorKey || "—";

    const tdDate = document.createElement("td");
    tdDate.textContent = formatDate(note.createdAt);

    const tdActions = document.createElement("td");
    const del = document.createElement("button");
    del.textContent = "Delete";
    del.addEventListener("click", () => void deleteNote(note.id));
    tdActions.appendChild(del);

    tr.append(tdNote, tdScope, tdAnchor, tdDate, tdActions);
    rows.appendChild(tr);
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
    window.alert("Invalid notes file: expected an array of notes.");
    return;
  }
  if (!window.confirm(`Replace all current notes with ${parsed.length} imported note(s)?`)) return;
  await replaceAllNotes(parsed);
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
void render();
