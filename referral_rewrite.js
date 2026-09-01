/**
 * Подмена ссылок на whitelist-доменах (CPA) для worker/premium.
 * Только product-like URL — не трогаем корзину/каталог/помощь.
 */
(function () {
  const SHOP_HOSTS = {
    "ozon.ru": "ozon",
    "wildberries.ru": "wb",
    "steampowered.com": "steam",
    "avito.ru": "avito",
    "tutu.ru": "tutu",
    "avia.tutu.ru": "tutu",
    "market.yandex.ru": "yandex_market",
    "dns-shop.ru": "dns",
    "goldapple.ru": "goldapple",
    "citilink.ru": "citilink",
    "mvideo.ru": "mvideo",
    "detmir.ru": "detmir",
    "lemanapro.ru": "leroymerlin",
    "leroymerlin.ru": "leroymerlin",
    "aviasales.ru": "aviasales",
  };

  const PRODUCT_PATH = {
    ozon: /\/product\//i,
    wb: /\/catalog\/\d+\/detail/i,
    steam: /\/app\/\d+/i,
    avito: /\/\d+$/i,
    tutu: /\/(train|avia|bus|tours|poezda|aviabilety|route|f)\//i,
    aviasales: /\/(search|hotels)\//i,
    yandex_market: /\/(card|product--)\//i,
    dns: /\/product\//i,
    goldapple: /\/\d{5,}/i,
    citilink: /\/product\//i,
    mvideo: /\/products\//i,
    detmir: /\/product\//i,
    leroymerlin: /\/product\//i,
  };

  function hostShopId(hostname) {
    const h = (hostname || "").toLowerCase().replace(/^www\./, "");
    for (const [dom, sid] of Object.entries(SHOP_HOSTS)) {
      if (h === dom || h.endsWith("." + dom)) return sid;
    }
    return null;
  }

  function isProductPath(shopId, pathname) {
    const re = PRODUCT_PATH[shopId];
    if (!re) return false;
    return re.test(pathname || "");
  }

  function productIdFromPath(shopId, pathname) {
    if (!pathname) return "";
    return pathname.split("?")[0].split("#")[0];
  }

  document.addEventListener(
    "click",
    async (ev) => {
      const a = ev.target.closest("a[href]");
      if (!a) return;
      let url;
      try {
        url = new URL(a.href, location.href);
      } catch {
        return;
      }
      const shopId = hostShopId(url.hostname);
      if (!shopId) return;
      if (!isProductPath(shopId, url.pathname)) return;

      const stored = await chrome.storage.local.get([
        "session_token",
        "can_use_referrals",
      ]);
      // Server sets can_use_referrals only when CPA_LINKS_JSON has real templates
      if (!stored.session_token || stored.can_use_referrals !== true) return;

      const productId = productIdFromPath(shopId, url.pathname);
      try {
        const res = await chrome.runtime.sendMessage({
          type: "REFERRAL_URL",
          shop_id: shopId,
          product_id: productId,
        });
        if (res?.referral_url) {
          a.href = res.referral_url;
        }
      } catch {
        /* ignore — never block navigation */
      }
    },
    true,
  );
})();
