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
