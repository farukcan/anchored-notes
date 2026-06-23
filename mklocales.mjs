// Generates _locales/<chrome-locale>/messages.json for the store-facing
// extension name and description. The runtime UI strings live in
// src/locales/*.ts; these two keys exist only to localize the manifest, which
// references them via __MSG_extName__ / __MSG_extDesc__.
import { mkdirSync, writeFileSync } from "node:fs";

// Keyed by Chrome locale code (en, pt_BR, zh_CN, ...). default_locale is "en".
const MESSAGES = {
  en: { name: "Anchored Notes", desc: "Leave sticky notes anchored to a page, site, tab or globally." },
  tr: { name: "Sabitlenmiş Notlar", desc: "Bir sayfaya, siteye, sekmeye veya her yere sabitlenen yapışkan notlar bırakın." },
  es: { name: "Notas Ancladas", desc: "Deja notas adhesivas ancladas a una página, un sitio, una pestaña o de forma global." },
  de: { name: "Verankerte Notizen", desc: "Hinterlasse Haftnotizen, verankert an einer Seite, Website, einem Tab oder global." },
  ja: { name: "アンカーノート", desc: "ページ、サイト、タブ、または全体に固定できる付箋を残せます。" },
  fr: { name: "Notes Ancrées", desc: "Laissez des notes autocollantes ancrées à une page, un site, un onglet ou partout." },
  pt_BR: { name: "Notas Ancoradas", desc: "Deixe notas adesivas ancoradas a uma página, site, aba ou globalmente." },
  ru: { name: "Закреплённые заметки", desc: "Оставляйте стикеры, закреплённые за страницей, сайтом, вкладкой или глобально." },
  it: { name: "Note Ancorate", desc: "Lascia note adesive ancorate a una pagina, un sito, una scheda o ovunque." },
  nl: { name: "Verankerde Notities", desc: "Laat plaknotities achter, verankerd aan een pagina, site, tabblad of overal." },
  pl: { name: "Zakotwiczone Notatki", desc: "Zostawiaj karteczki przypięte do strony, witryny, karty lub globalnie." },
  zh_CN: { name: "锚定便签", desc: "在页面、网站、标签页或全局留下锚定的便签。" },
  fa: { name: "یادداشت‌های لنگرانداخته", desc: "یادداشت‌های چسبان لنگرانداخته به یک صفحه، سایت، برگه یا به‌صورت سراسری بگذارید." },
  ar: { name: "ملاحظات مثبتة", desc: "اترك ملاحظات لاصقة مثبتة على صفحة أو موقع أو علامة تبويب أو بشكل عام." },
  vi: { name: "Ghi Chú Đã Ghim", desc: "Để lại ghi chú dán được ghim vào một trang, trang web, tab hoặc toàn cục." },
  ko: { name: "고정된 메모", desc: "페이지, 사이트, 탭 또는 전역에 고정되는 스티커 메모를 남기세요." }
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
