// Generates _locales/<chrome-locale>/messages.json for the store-facing
// extension name and description. The runtime UI strings live in
// src/locales/*.ts; these two keys exist only to localize the manifest, which
// references them via __MSG_extName__ / __MSG_extDesc__.
import { mkdirSync, writeFileSync } from "node:fs";

// Keyed by Chrome locale code (en, pt_BR, zh_CN, ...). default_locale is "en".
// Chrome Web Store limits: name ≤ 75 chars, short description ≤ 132 chars.
const MESSAGES = {
  en: {
    name: "Anchored Notes: Sticky Notes on Web Pages — Markdown, Sync & Encrypted",
    desc: "Leave sticky notes anchored to a page, site, tab or globally. Full markdown editor and encrypted sync across your devices."
  },
  tr: {
    name: "Anchored Notes: Web Sayfalarına Yapışkan Notlar — Markdown, Senkronizasyon",
    desc: "Bir sayfaya, siteye, sekmeye veya her yere sabitlenen yapışkan notlar bırakın. Markdown editörü ve şifreli senkronizasyon."
  },
  es: {
    name: "Anchored Notes: Notas Adhesivas en Páginas Web — Markdown y Sincronización",
    desc: "Notas adhesivas ancladas a una página, sitio, pestaña o globalmente. Editor markdown y sincronización cifrada entre dispositivos."
  },
  de: {
    name: "Anchored Notes: Haftnotizen für Webseiten — Markdown, Sync & verschlüsselt",
    desc: "Haftnotizen verankert an Seite, Website, Tab oder global. Markdown-Editor und verschlüsselte Synchronisation zwischen Geräten."
  },
  ja: {
    name: "Anchored Notes: ウェブページに貼れる付箋メモ｜Markdown対応・同期",
    desc: "Anchored Notes（アンカーノート）はウェブページに付箋メモを貼れる拡張機能。ページ・サイト・タブ・全ページに固定でき、Markdown対応、暗号化同期。"
  },
  fr: {
    name: "Anchored Notes: Notes autocollantes et pense-bêtes web — Markdown, synchro",
    desc: "Laissez des notes autocollantes ancrées à une page, un site, un onglet ou partout. Éditeur markdown et synchronisation chiffrée."
  },
  pt_BR: {
    name: "Anchored Notes: Notas Adesivas em Páginas Web — Markdown e Sincronização",
    desc: "Deixe notas adesivas ancoradas a uma página, site, aba ou globalmente. Editor markdown e sincronização criptografada."
  },
  ru: {
    name: "Anchored Notes: Стикеры и заметки на сайтах — Markdown и синхронизация",
    desc: "Anchored Notes («Анкорд Ноутс») — стикеры и заметки на веб-страницах: страница, сайт, вкладка или везде. Markdown и синхронизация."
  },
  it: {
    name: "Anchored Notes: Note adesive e appunti su pagine web — Markdown e sync",
    desc: "Note adesive ancorate a pagina, sito, scheda o ovunque. Editor markdown e sincronizzazione crittografata tra dispositivi."
  },
  nl: {
    name: "Anchored Notes: Plaknotities op webpagina's — Markdown, sync & versleuteld",
    desc: "Laat plaknotities achter op een pagina, site, tabblad of overal. Markdown-editor en versleutelde synchronisatie tussen apparaten."
  },
  pl: {
    name: "Anchored Notes: Karteczki samoprzylepne na stronach — Markdown i sync",
    desc: "Karteczki przypięte do strony, witryny, karty lub globalnie. Edytor Markdown i szyfrowana synchronizacja między urządzeniami."
  },
  zh_CN: {
    name: "Anchored Notes: 网页便签·便利贴笔记 — Markdown、同步与加密",
    desc: "Anchored Notes（锚定便签）让你在网页上添加便利贴笔记：可固定到页面、网站、标签页或全局，支持 Markdown、多设备加密同步。"
  },
  fa: {
    name: "Anchored Notes: یادداشت‌های چسبان روی صفحات وب — Markdown و همگام‌سازی",
    desc: "Anchored Notes (انکرد نوتس): یادداشت‌های چسبان روی صفحات وب — صفحه، سایت، تب یا همه‌جا؛ Markdown و همگام‌سازی رمزگذاری‌شده."
  },
  ar: {
    name: "Anchored Notes: ملاحظات لاصقة على صفحات الويب — Markdown ومزامنة مشفرة",
    desc: "Anchored Notes (أنكورد نوتس): ملاحظات لاصقة على صفحات الويب — صفحة أو موقع أو تبويب أو الكل، مع Markdown ومزامنة مشفرة."
  },
  vi: {
    name: "Anchored Notes: Ghi chú dán trên trang web — Markdown, đồng bộ & mã hóa",
    desc: "Ghi chú dán được ghim vào một trang, trang web, tab hoặc mọi nơi. Trình soạn thảo Markdown, đồng bộ mã hóa giữa các thiết bị."
  },
  ko: {
    name: "Anchored Notes: 웹페이지에 붙이는 스티커 메모 — 마크다운·동기화·암호화",
    desc: "Anchored Notes(앵커드 노트)는 웹페이지에 스티커 메모를 붙이는 확장 프로그램입니다. 페이지·사이트·탭·전체에 고정, 마크다운 지원, 암호화 동기화."
  }
};

for (const [locale, { name, desc }] of Object.entries(MESSAGES)) {
  const dir = `_locales/${locale}`;
  mkdirSync(dir, { recursive: true });
  const json = JSON.stringify(
    { extName: { message: name }, extDesc: { message: desc } },
    null,
    2
  );
  writeFileSync(`${dir}/messages.json`, `${json}\n`);
}

console.log(`_locales written for ${Object.keys(MESSAGES).length} locales`);
