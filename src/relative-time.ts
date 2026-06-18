// Formats a timestamp as relative time (e.g. "2 hours ago") using the native
// Intl.RelativeTimeFormat, with no external dependencies. The locale follows the
// active app language so it switches together with the rest of the UI.

import { getLang, type Lang } from "./i18n.js";

const DIVISIONS: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, unit: "second" },
  { amount: 60, unit: "minute" },
  { amount: 24, unit: "hour" },
  { amount: 7, unit: "day" },
  { amount: 4.34524, unit: "week" },
  { amount: 12, unit: "month" },
  { amount: Number.POSITIVE_INFINITY, unit: "year" },
];

const formatters: Partial<Record<Lang, Intl.RelativeTimeFormat>> = {};

function formatter(lang: Lang): Intl.RelativeTimeFormat {
  const existing = formatters[lang];
  if (existing) return existing;
  const created = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  formatters[lang] = created;
  return created;
}

export function formatRelativeTime(ms: number): string {
  const rtf = formatter(getLang());
  let delta = (ms - Date.now()) / 1000;
  for (const division of DIVISIONS) {
    if (Math.abs(delta) < division.amount) {
      return rtf.format(Math.round(delta), division.unit);
    }
    delta /= division.amount;
  }
  return rtf.format(Math.round(delta), "year");
}
