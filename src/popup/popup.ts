// Popup: add a note to the current page and list notes visible there.

import type { Message } from "../types.js";
import { isNoteVisible, pageContextFromLocation } from "../matching.js";
import { getAllNotes, saveNote } from "../storage.js";
import { deriveTitle } from "../note-title.js";
import { formatLimit, getCurrentLimit } from "../limits.js";
import type { LoginResponse } from "../types.js";
import { getAuthState, logout, onAuthChanged, type AuthState } from "../auth.js";
import { getLang, initI18n, LANG_META, LANGS, setLang, t, type Lang } from "../i18n.js";

// Sync runs only in the background worker (single context) to avoid races on
// the shared notes key; the popup just asks it to run.
function requestSync(): void {
  void chrome.runtime.sendMessage({ type: "SYNC" } satisfies Message);
}

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

function renderUsage(total: number, limit: number): void {
  const usage = document.getElementById("usage") as HTMLDivElement;
  const add = document.getElementById("add") as HTMLButtonElement;
  const atLimit = total >= limit;
  usage.textContent = t("notesUsage", { count: total, limit: formatLimit(limit) });
  usage.classList.toggle("limit", atLimit);
  add.disabled = atLimit;
}

// Render the account section: a Google sign-in button when signed out, or the
// email + plan badge + sign-out when signed in.
function renderAccount(auth: AuthState | null): void {
  const account = document.getElementById("account") as HTMLDivElement;
  account.replaceChildren();

  if (!auth) {
    const signIn = document.createElement("button");
    signIn.className = "account-signin";
    signIn.type = "button";
    signIn.textContent = t("accountSignIn", null);
    signIn.addEventListener("click", () => void handleSignIn(signIn));
    account.appendChild(signIn);
    return;
  }

  const email = document.createElement("span");
  email.className = "account-email";
  email.textContent = auth.email;

  const badge = document.createElement("span");
  badge.className = `plan-badge plan-${auth.plan}`;
  badge.textContent = auth.plan === "pro" ? "Pro" : "Free";

  const signOut = document.createElement("button");
  signOut.className = "account-signout";
  signOut.type = "button";
  signOut.textContent = t("accountSignOut", null);
  signOut.addEventListener("click", () => void logout());

  account.append(email, badge, signOut);
}

async function handleSignIn(button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  // The background worker runs the OAuth flow (the popup may close when the auth
  // window opens). If the popup survives, reflect the result; otherwise the
  // background completes login on its own and the next popup open shows it.
  try {
    const res = (await chrome.runtime.sendMessage({ type: "LOGIN" })) as LoginResponse;
    if (res.ok) {
      requestSync();
    } else {
      button.disabled = false;
      button.textContent = t("accountSignInFailed", null);
    }
  } catch {
    // Popup was closed during the flow; background finishes login independently.
  }
}

async function render(): Promise<void> {
  const list = document.getElementById("list") as HTMLUListElement;
  const count = document.getElementById("count") as HTMLDivElement;
  const all = await getAllNotes();
  renderUsage(all.length, await getCurrentLimit());
  const tab = await activeTab();
  if (!tab?.url || tab.id === undefined) {
    count.textContent = t("noActivePage", null);
    return;
  }
  const ctx = pageContextFromLocation(tab.url, tab.id);
  const visible = all.filter((n) => isNoteVisible(n, ctx));
  count.textContent = t("notesOnPage", { count: visible.length });
  list.replaceChildren();
  for (const note of visible) {
    const li = document.createElement("li");
    const text = document.createElement("span");
    text.className = "text";
    text.textContent = note.content ? deriveTitle(note.content) : t("empty", null);
    const scope = document.createElement("span");
    scope.className = "scope";
    scope.textContent = note.scope;
    li.append(text, scope);
    if (note.hidden) {
      const icon = document.createElement("span");
      icon.className = "hidden-icon";
      icon.textContent = "👁";
      li.prepend(icon);
      li.classList.add("hidden-note");
      li.title = t("showHiddenNote", null);
      li.addEventListener("click", async () => {
        await saveNote({ ...note, hidden: false, updatedAt: Date.now() });
        await render();
      });
    }
    list.appendChild(li);
  }
}

document.getElementById("add")?.addEventListener("click", async () => {
  const tab = await activeTab();
  if (tab?.id === undefined) return;
  const message: Message = { type: "CREATE_NOTE", content: "" };
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

onAuthChanged((auth) => {
  renderAccount(auth);
  void render();
});

async function main(): Promise<void> {
  await initI18n();
  applyStaticText();
  renderLangMenu();
  renderAccount(await getAuthState());
  await render();
  // Refresh from the backend in the background when signed in.
  requestSync();
}

void main();
