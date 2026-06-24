// Backend + PocketBase endpoints. PocketBase handles auth (Google OAuth); the
// Go backend mediates note sync and enforces per-plan limits.

// PocketBase instance used only for authentication.
export const PB_URL = "https://pb-forge.puhulab.com/anchored-notes";

// anchored-notes-backend base URL (deployed).
export const BACKEND_URL = "https://anchored-notes.puhulab.com";

// OAuth2 provider name as configured in PocketBase.
export const OAUTH_PROVIDER = "google";
