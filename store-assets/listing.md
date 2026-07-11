# Chrome Web Store listing copy & assets

Assets in this directory (upload on the dashboard's **Store listing** tab):

| File | Slot | Size |
| ---- | ---- | ---- |
| `screenshot-1.png` | Screenshot 1 (hero: notes on a page) | 1280×800 |
| `screenshot-2.png` | Screenshot 2 (markdown editor) | 1280×800 |
| `screenshot-3.png` | Screenshot 3 (sync / encryption / i18n) | 1280×800 |
| `promo-small-440x280.png` | Small promo tile | 440×280 |
| `promo-marquee-1400x560.png` | Marquee promo tile | 1400×560 |

Store icon: upload `../icons/icon-128.png` (128×128).
Category: **Productivity → Workflow & Planning**. Language: **English**.

Localized variants of all five assets live under `store-assets/<lang>/` for the
15 other extension languages (`tr`, `de`, `es`, `fr`, `it`, `nl`, `pl`,
`pt_BR`, `ru`, `vi`, `ja`, `ko`, `zh_CN`, `ar`, `fa` — same folder codes the
CWS dashboard uses). The demo page, the note contents, the extension UI and
the marketing copy are all translated; `ar`/`fa` are mirrored RTL. In the
dashboard, add each language on the Store listing tab and upload its folder's
files into the same slots.

## Detailed description

```
Anchored Notes lets you leave sticky notes anchored to web pages. Each note is pinned to one of four scopes and reappears wherever that scope matches:

• Global — shows on every page
• Site — shows on every page of a site
• Page — shows on one exact URL
• Tab — follows a single tab until it closes

Write in a full markdown editor: headings, lists, task lists with clickable checkboxes, tables, quotes and code blocks, with a Notion-style "/" menu. Drag, resize and recolor notes (7 colors). Available in 16 languages.

Sign in with Google to sync your notes across devices. Synced notes are always encrypted; set an optional passphrase to upgrade to end-to-end encryption so only you can read them.

Free: 10 notes without an account, 30 with a free account. Pro: unlimited notes.
```

The screenshots were generated from the real extension running in Chrome for
Testing (notes seeded into `chrome.storage.local`, shot at 1280×800), composed
into marketing tiles. To regenerate after UI or copy changes, see
[`gen/README.md`](gen/README.md) (`cd store-assets/gen && npm run shoot`).

## Privacy practices — permission justifications

Paste these on the dashboard's **Privacy practices** tab (English). Reused on
every submission; keep in sync with `manifest.json` when permissions change.

Single purpose:

```
Anchored Notes lets users attach persistent sticky notes to web pages, anchored to a page, site, tab or globally, and reappear when that scope matches.
```

| Permission | Justification |
| ---------- | ------------- |
| `scripting` | Programmatically injects our bundled content script (`content.js`) into tabs that were already open before the extension was installed or updated. Declarative content scripts only load into pages navigated after install, so pre-existing tabs cannot receive notes until manually reloaded — making the extension look broken on first use. We inject on install/update into open http(s) tabs, and on demand (with retry) when the user clicks "Add note" via the popup or right-click. We only inject our own static `files: ["content.js"]`; never remote or dynamically generated code. |
| `host_permissions` (`<all_urls>`) | The core feature is attaching notes to any web page the user visits, so the content script and note rendering must run on all sites the user chooses to annotate. |
| `activeTab` | Lets the popup act on the current tab (read its URL to match notes, inject/retry the content script on user action) without a broad grant when a narrower one suffices. |
| `contextMenus` | Adds an "Add note here" right-click menu item to create a note on the current page. |
| `storage` | Stores the user's notes, language choice and settings locally (`chrome.storage.local`) and transient UI state (`chrome.storage.session`). |
| `identity` | Optional Google sign-in (OAuth) to sync notes across devices; used only when the user chooses to sign in. |
| `alarms` | Schedules a periodic background sync for signed-in users to pull note changes made on other devices. |

Remote code: **No.** All executed code is bundled in the package; `scripting`
injects only the packaged `content.js`.
