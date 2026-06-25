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
- [ ] Add a "Delete my account & data" action (options page or popup).
- [ ] Backend endpoint to hard-delete the user's notes + account.
- [ ] On success, clear local `auth` + `notes` and sign out.
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
- [ ] Write a one-line justification per permission for the dashboard:
  - `<all_urls>` host permission — notes can be placed on any page.
  - `tabs` — tab-scoped notes need tab ids.
  - `identity` — Google OAuth sign-in.
  - `contextMenus`, `storage`, `activeTab`, `alarms` — brief each.
- [ ] Single-purpose statement: "sticky notes anchored to pages/sites/tabs".
- Why: `<all_urls>` + `identity` trigger **manual review**. Clear
  justifications reduce review friction and rejection risk.

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
