import { test } from "node:test";
import assert from "node:assert/strict";
import { ar } from "./locales/ar.ts";
import { de } from "./locales/de.ts";
import { en } from "./locales/en.ts";
import { es } from "./locales/es.ts";
import { fa } from "./locales/fa.ts";
import { fr } from "./locales/fr.ts";
import { it } from "./locales/it.ts";
import { ja } from "./locales/ja.ts";
import { ko } from "./locales/ko.ts";
import { nl } from "./locales/nl.ts";
import { pl } from "./locales/pl.ts";
import { pt } from "./locales/pt.ts";
import { ru } from "./locales/ru.ts";
import { tr } from "./locales/tr.ts";
import { vi } from "./locales/vi.ts";
import { zh } from "./locales/zh.ts";

// All locale dictionaries keyed by language code. English is canonical: its
// keys, placeholders and emojis define what every other locale must match.
const locales: Record<string, Record<string, string>> = {
  ar, de, en, es, fa, fr, it, ja, ko, nl, pl, pt, ru, tr, vi, zh
};

const enKeys: string[] = Object.keys(en).sort();
const translations: [string, Record<string, string>][] = Object.entries(locales).filter(
  ([lang]) => lang !== "en"
);

// {name}-style interpolation tokens, sorted for order-independent comparison.
function placeholders(value: string): string[] {
  return (value.match(/\{(\w+)\}/g) ?? []).sort();
}

// Pictographic glyphs (⚓ 🌐 …) plus the → arrow used in labels, sorted.
function glyphs(value: string): string[] {
  return (value.match(/\p{Extended_Pictographic}|→/gu) ?? []).sort();
}

for (const [lang, dict] of translations) {
  test(`${lang} has exactly the canonical keys`, () => {
    assert.deepEqual(Object.keys(dict).sort(), enKeys);
  });

  test(`${lang} preserves placeholders for every key`, () => {
    for (const key of enKeys) {
      assert.deepEqual(
        placeholders(dict[key]),
        placeholders(en[key as keyof typeof en]),
        `placeholder mismatch in ${lang}.${key}`
      );
    }
  });

  test(`${lang} preserves emojis and arrows for every key`, () => {
    for (const key of enKeys) {
      assert.deepEqual(
        glyphs(dict[key]),
        glyphs(en[key as keyof typeof en]),
        `glyph mismatch in ${lang}.${key}`
      );
    }
  });

  test(`${lang} has no empty translations`, () => {
    for (const key of enKeys) {
      assert.ok(dict[key].trim().length > 0, `empty translation in ${lang}.${key}`);
    }
  });
}

// Note: a locale being registered in i18n.ts (LANGS, LANG_META, DICT) is already
// guaranteed at compile time by their Lang-keyed types, so it needs no runtime
// test here. The checks above only cover translation content.
