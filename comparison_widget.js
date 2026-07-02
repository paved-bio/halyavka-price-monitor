/**
 * In-Context Comparison Widget + улучшенный EAN (JSON-state Ozon/WB).
 */
(function () {
  const WIDGET_ID = "pm-compare-widget";
  const DEBOUNCE_MS = 1500;
  let lastUrl = "";
  let debounceTimer = null;

  const parsePrice = PMUtils.parsePrice;

  const SHOP_DETECT = [
    { shop_id: "ozon", regex: /(?:https?:\/\/)?(?:www\.)?ozon\.ru(\/product\/[^/?#]+)/i },
    {
      shop_id: "wb",
      regex: /(?:https?:\/\/)?(?:www\.)?wildberries\.ru(\/catalog\/\d+\/detail\.aspx)/i,
    },
  ];

  function detectShop(url) {
    for (const s of SHOP_DETECT) {
      const m = url.match(s.regex);
      if (m) return { shop_id: s.shop_id, product_id: m[1] };
    }
    return null;
  }

  function scanJsonForEAN(obj, depth) {
    if (depth > 8 || obj == null) return null;
    if (typeof obj === "string") {
      const m = obj.match(/^\d{8,14}$/);
      if (m) return m[0];
      return null;
    }
    if (typeof obj !== "object") return null;

    const keys = ["barcode", "ean", "gtin", "gtin13", "gtin12", "штрихкод", "sku"];
    for (const k of keys) {
      if (obj[k] != null) {
        const v = String(obj[k]).replace(/\D/g, "");
        if (v.length >= 8 && v.length <= 14) return v;
      }
    }

    for (const v of Object.values(obj)) {
      const found = scanJsonForEAN(v, depth + 1);
      if (found) return found;
    }
    return null;
  }

  function extractEANFromScripts() {
    if (window.__NUXT__?.data) {
      const ean = scanJsonForEAN(window.__NUXT__.data, 0);
      if (ean) return ean;
    }

    for (const script of document.querySelectorAll("script:not([src])")) {
      const t = script.textContent;
      if (!t || t.length > 800000) continue;
      if (!/barcode|gtin|ean|штрих/i.test(t)) continue;

      const patterns = [
        /"(?:barcode|gtin13|gtin12|gtin|ean)"\s*:\s*"(\d{8,14})"/i,
        /"(?:barcode|gtin13|gtin12|gtin|ean)"\s*:\s*(\d{8,14})/i,
        /штрих[^"]*"\s*:\s*"(\d{8,14})"/i,
      ];
      for (const re of patterns) {
        const m = t.match(re);
        if (m) return m[1];
      }

      if (t.trim().startsWith("{")) {
        try {
          const ean = scanJsonForEAN(JSON.parse(t), 0);
          if (ean) return ean;
        } catch (_) {
          /* ignore */
        }
      }
    }
    return null;
  }

  function extractEANFromDOM() {
    const labels = /^(штрих\s*код|штрихкод|ean|barcode|upc|gtin)$/i;
    for (const el of document.querySelectorAll("dt, span, div, td, th, button")) {
      const label = el.textContent?.trim();
      if (!label || label.length > 30 || !labels.test(label)) continue;
      const sibling =
        el.nextElementSibling ||
        el.parentElement?.querySelector("dd, span + span, div + div");
      const val = sibling?.textContent?.trim() || "";
      const m = val.match(/\b(\d{8,14})\b/);
      if (m) return m[1];
    }
    return null;
  }

  function extractEANFromLdJson() {
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(script.textContent);
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          const gtin = item.gtin13 || item.gtin12 || item.gtin || item.gtin8;
          if (gtin) return String(gtin).replace(/\D/g, "");
        }
      } catch (_) {
        /* ignore */
      }
    }
    return null;
  }

  function extractEAN() {
    return (
      extractEANFromScripts() ||
      extractEANFromDOM() ||
      extractEANFromLdJson() ||
      (document.body.innerText.match(/(?:штрих\s*код|ean|barcode)[:\s]*(\d{8,14})/i) || [])[1] ||
      null
    );
  }

  function extractCurrentPrice() {
    const selectors = [
      "[class*='priceBlockFinalPrice']",
      "[data-widget='webPrice'] span",
      "[data-widget='webCurrentPrice'] span",
      "ins[class*='priceBlockFinalPrice']",
      "span[class*='priceBlockPrice']",
    ];
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (el.closest(".product-card, .cards-list, .recommendations")) continue;
        const p = parsePrice(el.textContent);
        if (p && p > 0) return p;
      }
    }
    const meta = document.querySelector('meta[itemprop="price"]');
    if (meta?.content) {
      const p = parsePrice(meta.content);
      if (p) return p;
    }
    return null;
  }

  function extractTitle() {
    return document.querySelector("h1")?.textContent?.trim().slice(0, 200) || null;
  }

  function findAnchor() {
    const selectors = [
      "[data-widget='webAddToCart']",
      "[data-widget='webOneClickButton']",
      "button[class*='addToCart']",
      ".product-page__btn-wrap",
      "#addBasket",
      ".order__button",
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return document.querySelector("h1");
  }

  function removeWidget() {
    document.getElementById(WIDGET_ID)?.remove();
  }

  function formatRub(n) {
    return new Intl.NumberFormat("ru-RU").format(Math.round(n));
  }

  function renderWidget(data) {
    removeWidget();
    if (!data.has_cheaper || !data.best_offer) return;

    const anchor = findAnchor();
    if (!anchor) return;

    const o = data.best_offer;
    const wrap = document.createElement("div");
    wrap.id = WIDGET_ID;
    wrap.innerHTML = `
      <div class="pm-header">Price Monitor — нашли дешевле</div>
      <div class="pm-body">
        На <strong>${o.shop_label}</strong> этот же товар дешевле на
        <span class="pm-savings">${formatRub(o.savings)} ₽</span>
        (${formatRub(o.price)} ₽)
      </div>
      <a class="pm-btn" href="${o.referral_url}" target="_blank" rel="noopener">
        Купить со скидкой →
      </a>
      <div class="pm-footer">Сравнение по EAN · CPA-ссылка</div>
    `;
    anchor.parentNode?.insertBefore(wrap, anchor.nextSibling);
  }

  function requestCompare(payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "COMPARE_LOOKUP", payload }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(resp);
      });
    });
  }

  async function runComparison() {
    const url = location.href;
    if (!url.includes("/product/") && !url.includes("/detail.aspx")) return;

    const shop = detectShop(url);
    if (!shop) return;

    const ean = extractEAN();
    if (!ean) return;

    const currentPrice = extractCurrentPrice();
    if (!currentPrice) return;

    try {
      const resp = await requestCompare({
        ean,
        current_shop_id: shop.shop_id,
        current_product_id: shop.product_id,
        current_price: currentPrice,
        title: extractTitle(),
      });
      if (resp?.error) return;
      renderWidget(resp);
    } catch (err) {
      console.debug("[PriceMonitor widget]", err.message);
    }
  }

  function scheduleRun() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (location.href === lastUrl) {
        runComparison();
        return;
      }
      lastUrl = location.href;
      runComparison();
    }, DEBOUNCE_MS);
  }

  const observer = new MutationObserver(scheduleRun);
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
    scheduleRun();
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      observer.observe(document.body, { childList: true, subtree: true });
      scheduleRun();
    });
  }
})();
