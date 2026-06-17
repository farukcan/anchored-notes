// Resolve a web app name from the page's linked manifest.json (PWA manifest).

interface WebManifest {
  short_name?: string;
  name?: string;
}

export function resolveManifestUrl(doc: Document = document): string | null {
  const link = doc.querySelector('link[rel="manifest"]');
  const href = link?.getAttribute("href");
  if (href) {
    try {
      return new URL(href, doc.location?.href ?? location.href).href;
    } catch {
      return null;
    }
  }

  try {
    return new URL("/manifest.json", doc.location?.href ?? location.href).href;
  } catch {
    return null;
  }
}

export function siteNameFromManifest(manifest: WebManifest): string | undefined {
  const raw = manifest.short_name ?? manifest.name;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed || undefined;
}

export async function fetchSiteNameFromManifest(doc: Document = document): Promise<string | undefined> {
  const url = resolveManifestUrl(doc);
  if (!url) return undefined;

  try {
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const manifest = (await res.json()) as WebManifest;
    return siteNameFromManifest(manifest);
  } catch {
    return undefined;
  }
}
