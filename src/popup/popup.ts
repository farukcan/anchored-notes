// Popup: add a note to the current page and list notes visible there.

import type { Message } from "../types.js";
import { isNoteVisible, pageContextFromLocation } from "../matching.js";
import { getAllNotes, saveNote } from "../storage.js";
import { deriveTitle } from "../note-title.js";
import { formatLimit, limitForPlan } from "../limits.js";
import type { LoginResponse } from "../types.js";
import { getAuthState, logout, onAuthChanged, startUpgrade, type AuthState } from "../auth.js";
import { getEncStatus, onEncStatusChanged } from "../encryption.js";
import { getLang, initI18n, LANG_META, LANGS, setLang, t, type Lang } from "../i18n.js";
import { injectContentScript } from "../inject.js";
import { playErrorBeep } from "../sound.js";
import { PENDING_WARNING_KEY } from "../types.js";

// Sync runs only in the background worker (single context) to avoid races on
// the shared notes key; the popup just asks it to run.
function requestSync(): void {
  void chrome.runtime.sendMessage({ type: "SYNC" } satisfies Message);
}

function openOptionsPage(): void {
  chrome.runtime.openOptionsPage();
}

// Animated red error toast + beep, so a failure (e.g. a restricted page) is
// clearly noticed rather than mistaken for a broken extension.
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function showToast(text: string): void {
  const toast = document.getElementById("toast") as HTMLDivElement;
  toast.textContent = text;
  toast.hidden = true;
  void toast.offsetWidth; // reflow so the CSS animation restarts on repeat calls
  toast.hidden = false;
  playErrorBeep();
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 4000);
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

// Conversion CTA under the usage line: push anonymous users to sign in (higher
// limit + sync) and free users to upgrade to Pro (unlimited). Pro users see none.
function renderUsageCta(auth: AuthState | null): void {
  const cta = document.getElementById("usage-cta") as HTMLDivElement;
  cta.replaceChildren();
  if (auth && auth.plan === "pro") return;
  const btn = document.createElement("button");
  btn.className = "usage-cta-btn";
  btn.type = "button";
  if (!auth) {
    btn.textContent = t("usageSignInCta", null);
    btn.addEventListener("click", () => void handleSignIn(btn));
  } else {
    btn.textContent = t("usageUpgradeCta", null);
    btn.addEventListener("click", () => void handleUpgrade(btn));
  }
  cta.appendChild(btn);
}

async function handleUpgrade(button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  try {
    await startUpgrade();
  } catch {
    button.disabled = false;
    button.textContent = t("accountBillingFailed", null);
  }
}

// Render the account section: a Google sign-in button when signed out, or the
// email + plan badge + sign-out when signed in.
function renderAccount(auth: AuthState | null): void {
  const account = document.getElementById("account") as HTMLDivElement;
  account.replaceChildren();

  if (!auth) {
    const wrap = document.createElement("div");
    wrap.className = "account-signin-wrap";
    const signIn = document.createElement("button");
    signIn.className = "account-signin";
    signIn.type = "button";
    signIn.textContent = t("accountSignIn", null);
    signIn.addEventListener("click", () => void handleSignIn(signIn));
    const benefit = document.createElement("div");
    benefit.className = "account-signin-benefit";
    benefit.textContent = t("accountSignInBenefit", null);
    wrap.append(signIn, benefit);
    account.appendChild(wrap);
    return;
  }

  const email = document.createElement("button");
  email.className = "account-email";
  email.type = "button";
  email.textContent = auth.email;
  email.addEventListener("click", openOptionsPage);

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

// Monotonic token: overlapping async renders must not both append (see the
// same guard in options.ts renderEncryption).
let encWarnSeq = 0;

// Warn when sync is gated because the encryption password (changed/set on
// another device) hasn't been entered here; the options page hosts the unlock.
async function renderEncWarning(auth: AuthState | null): Promise<void> {
  const seq = ++encWarnSeq;
  const required = auth !== null && (await getEncStatus()) === "password-required";
  if (seq !== encWarnSeq) return;
  const box = document.getElementById("enc-warning") as HTMLDivElement;
  box.replaceChildren();
  if (!required) return;
  const btn = document.createElement("button");
  btn.className = "enc-warning-btn";
  btn.type = "button";
  btn.textContent = t("encPasswordRequired", null);
  btn.addEventListener("click", openOptionsPage);
  box.appendChild(btn);
}

async function render(): Promise<void> {
  const list = document.getElementById("list") as HTMLUListElement;
  const count = document.getElementById("count") as HTMLDivElement;
  const all = await getAllNotes();
  const auth = await getAuthState();
  renderUsage(all.length, limitForPlan(auth ? auth.plan : null));
  renderUsageCta(auth);
  await renderEncWarning(auth);
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
    // Old tab (no content script): inject the bundle then retry. If injection
    // also fails, the page is genuinely restricted (chrome://, Web Store, ...).
    try {
      await injectContentScript(tab.id);
      await chrome.tabs.sendMessage(tab.id, message);
      window.close();
    } catch {
      showToast(t("cantAddNote", null));
    }
  }
});

document.getElementById("options")?.addEventListener("click", (e) => {
  e.preventDefault();
  openOptionsPage();
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

onEncStatusChanged(() => void render());

// When a note couldn't be added on a restricted page, the background worker sets
// a flag and opens this popup. Show the red error toast, then clear the flag and
// the toolbar badge. Runs once per popup (the flag may be read on open or arrive
// via the storage change if the popup opened before the write landed).
let warningConsumed = false;
async function consumePendingWarning(): Promise<void> {
  if (warningConsumed) return;
  warningConsumed = true; // claim synchronously so a concurrent call can't double-show
  const res = await chrome.storage.session.get(PENDING_WARNING_KEY);
  const tabId = res[PENDING_WARNING_KEY] as number | undefined;
  if (tabId === undefined) {
    warningConsumed = false; // nothing pending yet; let a later real warning through
    return;
  }
  await chrome.storage.session.remove(PENDING_WARNING_KEY);
  showToast(t("cantAddNote", null));
  void chrome.action.setBadgeText({ tabId, text: "" });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes[PENDING_WARNING_KEY]?.newValue !== undefined) {
    void consumePendingWarning();
  }
});

async function main(): Promise<void> {
  await initI18n();
  applyStaticText();
  renderLangMenu();
  renderAccount(await getAuthState());
  await render();
  void consumePendingWarning();
  // Refresh from the backend in the background when signed in.
  requestSync();
}

void main();
