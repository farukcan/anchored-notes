// Popup: add a note to the current page and list notes visible there.

import type { Message } from "../types.js";
import { isNoteVisible, pageContextFromLocation } from "../matching.js";
import { getAllNotes } from "../storage.js";

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function render(): Promise<void> {
  const list = document.getElementById("list") as HTMLUListElement;
  const count = document.getElementById("count") as HTMLDivElement;
  const tab = await activeTab();
  if (!tab?.url || tab.id === undefined) {
    count.textContent = "No active page.";
    return;
  }
  const ctx = pageContextFromLocation(tab.url, tab.id);
  const visible = (await getAllNotes()).filter((n) => isNoteVisible(n, ctx));
  count.textContent = `${visible.length} note(s) on this page`;
  list.replaceChildren();
  for (const note of visible) {
    const li = document.createElement("li");
    const text = document.createElement("span");
    text.className = "text";
    text.textContent = note.content || "(empty)";
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
    count.textContent = "Can't add a note on this page.";
  }
});

document.getElementById("options")?.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

void render();
