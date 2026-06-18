// Popup: add a note to the current page and list notes visible there.

import type { Message } from "../types.js";
import { isNoteVisible, pageContextFromLocation } from "../matching.js";
import { getAllNotes } from "../storage.js";
import { getLang, initI18n, LANG_META, LANGS, setLang, t, type Lang } from "../i18n.js";

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function applyStaticText(): void {
  (document.getElementById("add") as HTMLButtonElement).textContent = t("addNote", null);
  (document.getElementById("options") as HTMLAnchorElement).textContent = t("manageAllNotes", null);
  const langBtn = document.getElementById("lang-btn") as HTMLButtonElement;
  langBtn.textContent = LANG_META[getLang()].flag;
  langBtn.title = t("language", null);
}

function renderLangMenu(): void {
  const menu = document.getElementById("lang-menu") as HTMLDivElement;
  const active = getLang();
  menu.replaceChildren();
  for (const lang of LANGS) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "lang-item";
    item.setAttribute("aria-current", String(lang === active));
    item.textContent = `${LANG_META[lang].flag} ${LANG_META[lang].name}`;
    item.addEventListener("click", () => void chooseLang(lang));
    menu.appendChild(item);
  }
}

async function chooseLang(lang: Lang): Promise<void> {
  (document.getElementById("lang-menu") as HTMLDivElement).hidden = true;
  if (lang === getLang()) return;
  await setLang(lang);
  applyStaticText();
  renderLangMenu();
  await render();
}

async function render(): Promise<void> {
  const list = document.getElementById("list") as HTMLUListElement;
  const count = document.getElementById("count") as HTMLDivElement;
  const tab = await activeTab();
  if (!tab?.url || tab.id === undefined) {
    count.textContent = t("noActivePage", null);
    return;
  }
  const ctx = pageContextFromLocation(tab.url, tab.id);
  const visible = (await getAllNotes()).filter((n) => isNoteVisible(n, ctx));
  count.textContent = t("notesOnPage", { count: visible.length });
  list.replaceChildren();
  for (const note of visible) {
    const li = document.createElement("li");
    const text = document.createElement("span");
    text.className = "text";
    text.textContent = note.content || t("empty", null);
    const scope = document.createElement("span");
    scope.className = "scope";
    scope.textContent = note.scope;
    li.append(text, scope);
    list.appendChild(li);
  }
}

document.getElementById("add")?.addEventListener("click", async () => {
  const tab = await activeTab();
  if (tab?.id === undefined) return;
  const message: Message = { type: "CREATE_NOTE" };
  try {
    await chrome.tabs.sendMessage(tab.id, message);
    window.close();
  } catch {
    const count = document.getElementById("count") as HTMLDivElement;
    count.textContent = t("cantAddNote", null);
  }
});

document.getElementById("options")?.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

document.getElementById("lang-btn")?.addEventListener("click", () => {
  const menu = document.getElementById("lang-menu") as HTMLDivElement;
  menu.hidden = !menu.hidden;
});

document.addEventListener("click", (e) => {
  const menu = document.getElementById("lang-menu") as HTMLDivElement;
  if (menu.hidden) return;
  if (!(e.target as HTMLElement).closest(".lang")) menu.hidden = true;
});

async function main(): Promise<void> {
  await initI18n();
  applyStaticText();
  renderLangMenu();
  await render();
}

void main();
