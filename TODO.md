# TODO — Chrome Web Store Release

Tracks what's left before submitting Anchored Notes to the Chrome Web Store.
The code is functional (typecheck clean, 78/78 unit tests pass, backend live),
so everything below is **packaging / compliance**, not feature work.

Store draft item id: `dnmmgfkolmlieeempmfjghddbcehijgc`
→ OAuth redirect URI: `https://dnmmgfkolmlieeempmfjghddbcehijgc.chromiumapp.org/`
→ Google OAuth client (configured in PocketBase):
`314642322120-b3i962l3rt2gta218h8d1v4voh5ap25b.apps.googleusercontent.com`

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
- [x] 3 screenshots **1280×800** PNG (no alpha): `store-assets/screenshot-{1,2,3}.png`.
- [x] Small promo tile **440×280**: `store-assets/promo-small-440x280.png`.
- [x] Detailed description: `store-assets/listing.md`.
- [ ] Upload assets + paste description, pick Category (**Productivity →
  Workflow & Planning**) + language (English) in the dashboard; store icon =
  `icons/icon-128.png`.

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
- [x] Create the CWS item (draft upload) → id `dnmmgfkolmlieeempmfjghddbcehijgc`.
- [ ] Register the store-id redirect URI in the Google OAuth client
  (`314642322120-b3i962l3rt2gta218h8d1v4voh5ap25b.apps.googleusercontent.com`,
  Google Cloud Console → Credentials → Authorized redirect URIs):
  `https://dnmmgfkolmlieeempmfjghddbcehijgc.chromiumapp.org/`
  Keep the unpacked dev id's URI too until the `key` step below lands.
  Without this, first-run login on every store install throws
  `redirect_uri_mismatch`.
- [x] Copy the item's **public key** into `manifest.json` as `"key"` so the
  unpacked dev build shares the store id (`dist/` id verified =
  `dnmmgfkolmlieeempmfjghddbcehijgc`) and one redirect URI covers both.
  `package.mjs` strips `key` from the store zip (CWS packages must not carry
  it) while `dist/` keeps it for Load unpacked.
- Files: `manifest.json` (`key`), `src/auth.ts` (consumer, no change needed).

## Pre-submit checklist
- [ ] Bump `version` in `manifest.json` + `package.json` if needed (0.1.0 is OK
  for a first release).
- [ ] `npm run package` → produces `anchored-notes-<version>.zip` from `dist/`.
- [ ] Verify `https://dnmmgfkolmlieeempmfjghddbcehijgc.chromiumapp.org/` is
  registered in the Google OAuth client's authorized redirect URIs (item 6).
- [ ] Smoke test the packaged build via Load unpacked: create/edit/delete a
  note in each scope, sign in, sync across two browsers, switch language.

## Nice to have (not blocking)
- [ ] Integration/e2e test for the auth + sync round-trip (unit tests cover
  matching/i18n/manifest logic only).
- [ ] Error surfacing for sync failures in the UI (currently `sync()` throws and
  is only logged in the background worker).
