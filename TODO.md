# TODO — Chrome Web Store Release

Tracks what's left before submitting Anchored Notes to the Chrome Web Store.
The code is functional (typecheck clean, 70/70 unit tests pass, backend live),
so everything below is **packaging / compliance**, not feature work.

## Blockers (store will reject without these)

### 1. Privacy policy
- [x] Write and host a privacy policy at a public URL.
  Served by the backend at `https://anchored-notes.puhulab.com/privacy`
  (static HTML embedded in `anchored-notes-backend`, route `GET /privacy`).
- [ ] Add the URL to the store listing's Privacy tab.
- Why: the extension requests `identity`, collects the user's Google email, and
  syncs note content to a remote backend. The Web Store requires a privacy
  policy for any extension that handles personal/auth data.
- Must disclose: what's collected (email, note content, note metadata), where
  it's stored (PocketBase + `anchored-notes-backend` at `puhulab.com`), why,
  retention, and how to request deletion (see item 4).

### 2. Account / data deletion
- [x] Add a "Delete my account & data" action (options page or popup).
  Options page account section: type-your-email-to-confirm "Delete account"
  (also adds sign-in / sign-out, previously missing on the options page).
- [x] Backend endpoint to hard-delete the user's notes + account.
  `DELETE /api/account` (`account.go` → `pb.Client.DeleteUser`); notes
  cascade-delete via the `notes.user` relation.
- [x] On success, clear local `auth` + `notes` and sign out.
  `deleteAccount()` signs out, then `wipeLocalNotes()` clears notes + tombstones.
- Why: `logout()` only clears `chrome.storage.local`; backend notes persist.
  Chrome's data policy (and GDPR) expect a user-initiated deletion path. Likely
  rejection reason if missing.
- Files: `src/auth.ts` (logout flow), options/popup UI, backend.

### 3. Store listing assets
- [ ] At least 1 screenshot, **1280×800** (or 640×400) PNG/JPG. Recommend 3–5.
- [ ] Small promo tile **440×280** (optional but recommended).
- [ ] Detailed description (the README intro is a good base).
- [ ] Category + language selection in the dashboard.
- Why: required fields in the submission form. None exist in the repo yet.

### 4. Permission justifications
- [x] One-line justification per permission for the dashboard:
  - `<all_urls>` (host) — the content script injects the sticky-note UI into
    every page so a note can be anchored to any URL the user visits.
  - `identity` — Google OAuth2 sign-in via `chrome.identity.launchWebAuthFlow`
    to authenticate the user for cross-device note sync.
  - `activeTab` — the popup reads the current tab (`chrome.tabs.query`) to
    create/show a note for the page the user is looking at.
  - `contextMenus` — right-click menu entry to add a note to the current page.
  - `storage` — persists notes, tombstones, and the auth token in
    `chrome.storage.local`.
  - `alarms` — a periodic alarm (every 5 min) triggers background sync with the
    backend.
- [x] Single-purpose statement: "sticky notes anchored to pages/sites/tabs".
- Where to paste (dashboard **Privacy** tab, not the package upload step):
  - Single purpose → "Single purpose" field.
  - The 6 API permissions → each gets its own "Permission justification" box
    (auto-listed from the manifest).
  - `<all_urls>` → the separate "Host permission justification" box.
  - Privacy policy URL (item 1) + data-usage disclosures also live here.
  - Note: uploading the zip only stores the package; these Privacy-tab fields
    must be filled or the submission is blocked / rejected on review.
  - Ref: https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- Why: `<all_urls>` + `identity` trigger **manual review**. Clear
  justifications reduce review friction and rejection risk.

### 5. OAuth consent screen must be in Production
- [ ] In Google Cloud Console, publish the OAuth consent screen (**Testing →
  Production**). While in Testing, only manually-added test users can sign in,
  so published-extension users would all fail login.
- `email` / `profile` are non-sensitive scopes, so Google verification is not
  required — but the app must still be **published**, otherwise tokens are
  capped/short-lived and only test users get through.
- Why: a Testing-mode consent screen silently blocks every real user. Login
  works locally only because your account is the test user.
- Files: none (Google Cloud Console config), affects `src/auth.ts` flow.

### 6. Stabilize the extension id for the OAuth redirect URI
- [ ] The unpacked dev id ≠ the Web Store id, and
  `chrome.identity.getRedirectURL()` (`https://<id>.chromiumapp.org/`) depends on
  it. Pick one:
  - **Preferred:** create the CWS item (draft upload), copy its **public key**
    from the dashboard into `manifest.json` as `"key": "..."`, so local and store
    share one id → a single redirect URI covers both.
  - **Alternative:** register both ids' `https://<id>.chromiumapp.org/` in the
    Google OAuth client's Authorized redirect URIs (multiple allowed).
- [ ] Add the published-id redirect URI to the Google OAuth client **before**
  publishing, or first-run login throws `redirect_uri_mismatch`.
- Why: without this, sign-in is broken for every store install even though it
  works in local dev. (Expanded from the redirect-URI item below.)
- Files: `manifest.json` (`key`), `src/auth.ts` (consumer, no change needed).

## Pre-submit checklist
- [ ] Bump `version` in `manifest.json` + `package.json` if needed (0.1.0 is OK
  for a first release).
- [ ] `npm run package` → produces `anchored-notes-<version>.zip` from `dist/`.
- [ ] Verify the OAuth `redirectUrl` (`chrome.identity.getRedirectURL()`,
  `https://<extension-id>.chromiumapp.org/`) is registered in the Google OAuth
  client's authorized redirect URIs **for the published extension id** (the id
  changes once it's in the store).
- [ ] Smoke test the packaged build via Load unpacked: create/edit/delete a
  note in each scope, sign in, sync across two browsers, switch language.

## Nice to have (not blocking)
- [ ] Integration/e2e test for the auth + sync round-trip (unit tests cover
  matching/i18n/manifest logic only).
- [ ] Error surfacing for sync failures in the UI (currently `sync()` throws and
  is only logged in the background worker).
