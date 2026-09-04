// Page copy for stages that are not in the store-asset deck.
//
// `article` is absent on purpose: it shares store-assets/gen/i18n.mjs with the
// screenshots, which is what keeps a video and the store listing describing the
// same fictional site. These two stages exist only for videos, so their words
// live here instead of swelling the store deck.
//
// A stage listed here is built only for the languages it names — no fallback to
// English, so a missing translation is a missing file rather than a video that
// quietly speaks the wrong language.
//
// Neither site has a name or a wordmark. An invented brand is noise the viewer
// has to parse, and a real one would be an imitation — so the page says what
// kind of site it is through its layout, and the copy stays generic.

export const STAGE_COPY: Record<string, Record<string, Record<string, string>>> = {
  "video-watch": {
    en: {
      vwNav1: "Home",
      vwNav2: "Subscriptions",
      vwNav3: "Library",
      vwSearch: "Search",
      vwTitle: "Hand-cut soba, from flour to bowl",
      vwChannel: "Kaneko Kitchen",
      vwSubs: "128K subscribers",
      vwMeta: "94,210 views · 3 days ago",
      vwDesc:
        "The whole method, no shortcuts: hydration, kneading, the long rest, and the cut. Everything you need is in this one take.",
      vwTime: "12:04 / 24:31",
      vwUpHead: "Up next",
      vwUp1: "Why your dough tears — and how to stop it",
      vwUp1m: "Kaneko Kitchen · 61K views",
      vwUp2: "A knife worth sharpening",
      vwUp2m: "Tsubame Works · 22K views",
      vwUp3: "Dashi in eight minutes",
      vwUp3m: "Kaneko Kitchen · 143K views"
    },
    tr: {
      vwNav1: "Ana sayfa",
      vwNav2: "Abonelikler",
      vwNav3: "Kitaplık",
      vwSearch: "Ara",
      vwTitle: "Elde kesilen soba: undan kâseye",
      vwChannel: "Kaneko Mutfağı",
      vwSubs: "128 B abone",
      vwMeta: "94.210 görüntülenme · 3 gün önce",
      vwDesc:
        "Kısa yoldan değil, baştan sona: su oranı, yoğurma, uzun dinlendirme ve kesim. İhtiyacın olan her şey tek çekimde.",
      vwTime: "12:04 / 24:31",
      vwUpHead: "Sıradaki",
      vwUp1: "Hamurun neden yırtılıyor — ve nasıl önlenir",
      vwUp1m: "Kaneko Mutfağı · 61 B görüntülenme",
      vwUp2: "Bilenmeye değer bir bıçak",
      vwUp2m: "Tsubame Works · 22 B görüntülenme",
      vwUp3: "Sekiz dakikada dashi",
      vwUp3m: "Kaneko Mutfağı · 143 B görüntülenme"
    }
  },
  "ai-chat": {
    en: {
      acNew: "New chat",
      acHist1: "Freelance rate",
      acHist2: "Reading a contract",
      acHist3: "Invoice template",
      acHist4: "Scope creep",
      acTitle: "Setting a freelance rate",
      acAsk: "How do I set my freelance hourly rate?",
      acLead:
        "Start from what you need to earn, not from what others charge. Three things decide the number:",
      acQuote1: "Divide your income by 1,000 hours, not 2,000.",
      acBody1:
        "Half of a working year goes to admin, sales and the gaps between projects. Rates built on 2,000 hours quietly assume none of that exists.",
      acQuote2: "Never discount — reduce the scope instead.",
      acBody2:
        "A discount tells the client your first number was invented. Removing a deliverable tells them it was not, and leaves the rate intact for the next project.",
      acClose: "Want me to work through the arithmetic with your own numbers?",
      acInput: "Ask anything"
    },
    tr: {
      acNew: "Yeni sohbet",
      acHist1: "Freelance ücret",
      acHist2: "Sözleşme okuma",
      acHist3: "Fatura şablonu",
      acHist4: "Kapsam kayması",
      acTitle: "Freelance ücret belirleme",
      acAsk: "Freelance işte saatlik ücretimi nasıl belirlerim?",
      acLead:
        "Başkalarının ne aldığından değil, senin ne kazanman gerektiğinden başla. Rakamı üç şey belirler:",
      acQuote1: "Gelirini 2.000 saate değil, 1.000 saate böl.",
      acBody1:
        "Çalışma yılının yarısı idari işlere, satışa ve projeler arasındaki boşluklara gider. 2.000 saat üzerine kurulu ücretler bunların hiçbirinin var olmadığını varsayar.",
      acQuote2: "İndirim yapma — kapsamı küçült.",
      acBody2:
        "İndirim, müşteriye ilk rakamı uydurduğunu söyler. Bir kalemi çıkarmak ise uydurmadığını söyler ve ücreti sonraki proje için olduğu gibi bırakır.",
      acClose: "İstersen kendi rakamlarınla hesabı birlikte yapalım mı?",
      acInput: "Bir şey sor"
    }
  },
  profile: {
    en: {
      prNav1: "Home",
      prNav2: "Network",
      prNav3: "Jobs",
      prSearch: "Search",
      prName: "Mira Halvorsen",
      prHeadline: "Design systems lead · Tooling for editorial teams",
      prLocation: "Oslo, Norway · 500+ connections",
      prConnect: "Connect",
      prMessage: "Message",
      prAboutHead: "About",
      prAbout:
        "Twelve years turning sprawling component libraries into something teams actually reach for. Currently writing about documentation as a design surface.",
      prExpHead: "Experience",
      prExp1: "Head of Design Systems",
      prExp1org: "Fathom Editorial · 2021 — present",
      prExp2: "Senior Product Designer",
      prExp2org: "Northlight · 2016 — 2021"
    },
    tr: {
      prNav1: "Ana sayfa",
      prNav2: "Ağım",
      prNav3: "İlanlar",
      prSearch: "Ara",
      prName: "Mira Halvorsen",
      prHeadline: "Tasarım sistemleri lideri · Editoryal ekipler için araçlar",
      prLocation: "Oslo, Norveç · 500+ bağlantı",
      prConnect: "Bağlantı kur",
      prMessage: "Mesaj",
      prAboutHead: "Hakkında",
      prAbout:
        "On iki yıldır dağılmış bileşen kütüphanelerini ekiplerin gerçekten uzandığı şeylere dönüştürüyor. Şu sıralar dokümantasyonu bir tasarım yüzeyi olarak ele alan yazılar yazıyor.",
      prExpHead: "Deneyim",
      prExp1: "Tasarım Sistemleri Direktörü",
      prExp1org: "Fathom Editorial · 2021 — bugün",
      prExp2: "Kıdemli Ürün Tasarımcısı",
      prExp2org: "Northlight · 2016 — 2021"
    }
  }
};
