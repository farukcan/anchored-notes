// Minimal JWT expiry parsing for the auth-refresh scheduling decision. No
// project imports (like crypto.ts), so it's unit-testable under `node --test`
// without a browser/extension runtime.

// Decodes a JWT's `exp` claim (seconds since epoch) into milliseconds, without
// verifying the signature. Only used to decide *when* to refresh a token; the
// claim itself is never trusted for anything security-sensitive.
export function decodeJwtExpiryMs(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  try {
    const payload = JSON.parse(atob(padded)) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

// Pure refresh decision: an undecodable expiry means "don't know" (false),
// deferring to the reactive 401-retry instead of refreshing blind.
export function shouldRefresh(expiryMs: number | null, nowMs: number, marginMs: number): boolean {
  if (expiryMs === null) return false;
  return expiryMs - nowMs <= marginMs;
}
