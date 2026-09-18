// Href allow-list for user-controlled links (note markdown and options
// anchor cells). Rejects javascript:/data:/vbscript: and unknown schemes,
// including whitespace-obfuscated schemes.

function stripped(href: string): string {
  return href.trim().replace(/[\u0000-\u001F\u007F]/g, "");
}

export function isSafeHref(href: string): boolean {
  const trimmed = stripped(href);
  if (!trimmed) return false;
  const compact = trimmed.replace(/\s+/g, "");
  if (/^(javascript|data|vbscript):/i.test(compact)) return false;
  try {
    const url = new URL(trimmed, "https://example.invalid/");
    if (url.protocol === "javascript:" || url.protocol === "data:" || url.protocol === "vbscript:") {
      return false;
    }
    if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:") {
      return true;
    }
  } catch {
    return false;
  }
  if (trimmed.startsWith("#") || trimmed.startsWith("/") || trimmed.startsWith(".")) return true;
  if (trimmed.startsWith("//")) return true;
  return !/^[a-z][a-z0-9+.-]*:/i.test(trimmed);
}

// Absolute http(s) only — used when turning a stored anchorKey into an <a href>.
export function httpUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}
