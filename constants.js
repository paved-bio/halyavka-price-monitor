/** Публичные константы расширения (открытый исходный код). */
const PM_EXTENSION = {
  get version() {
    try {
      return chrome.runtime.getManifest().version;
    } catch (_) {
      return "1.6.0";
    }
  },
  repoUrl: "https://github.com/paved-bio/halyavka-price-monitor",
  changelogPath: "/CHANGELOG.md",
  license: "MIT",
  supportedShops: [
    { id: "ozon", label: "Ozon", domains: ["ozon.ru"] },
    { id: "wb", label: "Wildberries", domains: ["wildberries.ru"] },
    { id: "steam", label: "Steam", domains: ["steampowered.com"] },
    { id: "avito", label: "Avito", domains: ["avito.ru"] },
    { id: "tutu", label: "Tutu.ru", domains: ["tutu.ru"] },
    { id: "yandex_market", label: "Яндекс Маркет", domains: ["market.yandex.ru"] },
    { id: "dns", label: "DNS", domains: ["dns-shop.ru"] },
    { id: "goldapple", label: "Золотое Яблоко", domains: ["goldapple.ru"] },
    { id: "citilink", label: "Ситилинк", domains: ["citilink.ru"] },
    { id: "mvideo", label: "М.Видео", domains: ["mvideo.ru"] },
    { id: "detmir", label: "Детский мир", domains: ["detmir.ru"] },
    { id: "leroymerlin", label: "Лемана ПРО", domains: ["lemanapro.ru", "leroymerlin.ru"] },
  ],
};

function pmOpenTransparencyPage() {
  chrome.tabs.create({ url: chrome.runtime.getURL("transparency.html") });
}

function pmOpenWorkerInfoPage() {
  chrome.tabs.create({ url: chrome.runtime.getURL("worker_info.html") });
}

function pmCompareVersions(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da < db) return -1;
    if (da > db) return 1;
  }
  return 0;
}

function pmUpdateAvailable(current, latest) {
  return pmCompareVersions(current, latest) < 0;
}
