// Lightweight runtime i18n layer. Unlike chrome.i18n (locked to the browser UI
// language), the active language is stored in chrome.storage.local so the user
// can switch it at runtime from the popup. Default is the detected system
// language. Per-language dictionaries live in ./locales/<lang>.ts.

import { en } from "./locales/en.js";
import { tr } from "./locales/tr.js";

export type Lang = "en" | "tr";

export const LANGS: Lang[] = ["en", "tr"];

// Native names + flags, shown in the language picker (never translated).
export const LANG_META: Record<Lang, { name: string; flag: string }> = {
  en: { name: "English", flag: "🇬🇧" },
  tr: { name: "Türkçe", flag: "🇹🇷" }
};

// Keys come from the canonical English dictionary; every locale must match it.
export type MessageKey = keyof typeof en;

const LANG_KEY = "lang";

const DICT: Record<Lang, Record<MessageKey, string>> = { en, tr };

function detectSystemLang(): Lang {
  const ui = chrome.i18n.getUILanguage().toLowerCase();
  return ui.startsWith("tr") ? "tr" : "en";
}

// Module-level active language so t() can stay synchronous (render code assigns
// textContent directly). Seeded from the system language, then overwritten by
// the stored choice in initI18n().
let currentLang: Lang = detectSystemLang();

export function getLang(): Lang {
  return currentLang;
}

// Resolve the active language from storage before first render. Falls back to
// the system language when the user has never chosen one.
export async function initI18n(): Promise<void> {
  const result = await chrome.storage.local.get(LANG_KEY);
  const stored = result[LANG_KEY] as Lang | undefined;
  currentLang = stored && LANGS.includes(stored) ? stored : detectSystemLang();
}

export async function setLang(lang: Lang): Promise<void> {
  currentLang = lang;
  await chrome.storage.local.set({ [LANG_KEY]: lang });
}

export function t(key: MessageKey, params: Record<string, string | number> | null): string {
  const msg = DICT[currentLang][key];
  if (!params) return msg;
  return msg.replace(/\{(\w+)\}/g, (_, name: string) =>
    name in params ? String(params[name]) : `{${name}}`
  );
}

// Subscribe to runtime language changes (e.g. switched from another context's
// popup). Updates the module state before invoking the listener so t() reads
// the new language. Returns an unsubscribe function.
export function onLangChanged(listener: (lang: Lang) => void): () => void {
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string
  ): void => {
    if (area !== "local" || !(LANG_KEY in changes)) return;
    const next = changes[LANG_KEY].newValue as Lang | undefined;
    currentLang = next && LANGS.includes(next) ? next : detectSystemLang();
    listener(currentLang);
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
