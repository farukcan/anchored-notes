// Turkish translations. Must provide every MessageKey defined by the English
// (canonical) dictionary; missing keys are a compile-time error.

import type { MessageKey } from "../i18n.js";

export const tr: Record<MessageKey, string> = {
  // popup
  addNote: "⚓ Bu sayfaya not ekle",
  noActivePage: "Aktif sayfa yok.",
  notesOnPage: "Bu sayfada {count} not",
  manageAllNotes: "Tüm notları yönet →",
  cantAddNote: "Bu sayfaya not eklenemez.",
  notesUsage: "{count} / {limit} not kullanıldı",
  noteLimitReached: "Not limitine ulaşıldı ({limit}). Yeni not eklemek için bir notu silin.",
  language: "Dil",
  // account
  accountSignIn: "Google ile giriş yap",
  accountSignOut: "Çıkış yap",
  accountSignInFailed: "Giriş başarısız.",
  accountDeleteAccount: "Hesabı sil",
  accountDeleteConfirm: "Hesabını ve eşitlenmiş tüm notları kalıcı olarak silmek için e-postanı yaz:",
  accountDeleteFailed: "Hesap silme başarısız.",
  // options
  optionsTitle: "Anchored Notes — Seçenekler",
  searchPlaceholder: "Notlarda ara…",
  exportJson: "JSON dışa aktar",
  importJson: "JSON içe aktar",
  colNote: "Not",
  colScope: "Kapsam",
  colAnchor: "Çapa",
  colCreated: "Oluşturulma",
  noNotesYet: "Henüz not yok.",
  invalidNotesFile: "Geçersiz not dosyası: bir not dizisi bekleniyordu.",
  importConfirm: "Mevcut tüm notlar içe aktarılan {count} notla değiştirilsin mi?",
  // shared
  delete: "Sil",
  deleteConfirm: "Bu not silinsin mi?",
  empty: "(boş)",
  // note card scopes
  scopeEverywhereLabel: "🌐 Her yerde",
  scopeSiteLabel: "🌍 Site",
  scopePageLabel: "📄 Sayfa",
  scopeTabLabel: "🗂️ Sekme",
  scopeEverywhereHint: "Her yere sabitlendi — açtığın her sayfada görünür",
  scopeSiteHint: "Bu siteye sabitlendi — bu alan adının her sayfasında görünür",
  scopePageHint: "Bu sayfaya sabitlendi — yalnızca bu URL'de görünür",
  scopeTabHint: "Bu sekmeye sabitlendi — gezinmede takip eder, yeniden başlatınca gider",
  scopeSiteHintNamed: "{name} sitesine sabitlendi — bu alan adının her sayfasında görünür",
  scopePageHintNamed: "Bu sayfaya sabitlendi ({title}) — yalnızca bu URL'de görünür",
  tabNoteWarning: "Sekme notları senkronize edilmez, saklanmaz ve oturum bitince silinir.",
  // note card tools
  anchorTitle: "Sabitlenme yeri",
  scopeSelectTitle: "⚓ Bu notun nereye sabitlendiği",
  colorTitle: "Renk",
  optionsMenuTitle: "Seçenekler",
  hide: "Gizle",
  // hidden-notes badge
  badgeTitle: "Gizli notlar (taşımak için sürükle)",
  showHiddenNote: "Gizli — göstermek için tıkla",
  // slash menu
  slashText: "Metin",
  slashHeading1: "Başlık 1",
  slashHeading2: "Başlık 2",
  slashHeading3: "Başlık 3",
  slashBulletList: "Madde Listesi",
  slashOrderedList: "Numaralı Liste",
  slashTaskList: "Görev Listesi",
  slashQuote: "Alıntı",
  slashCode: "Kod",
  slashTable: "Tablo",
  slashDivider: "Ayırıcı",
  // table toolbar
  tableAddColumn: "Sütun ekle",
  tableDeleteColumn: "Sütun sil",
  tableAddRow: "Satır ekle",
  tableDeleteRow: "Satır sil",
  tableDeleteTable: "Tabloyu sil",
  // background context menu
  addNoteHere: "Buraya Not Ekle"
};
