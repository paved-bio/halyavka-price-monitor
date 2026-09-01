/**
 * In-Context Comparison Widget: только по кнопке «Сравнить» (без автопрогона).
 * EAN / артикул / title-match; маршруты — Tutu/Aviasales.
 */
(function () {
  const WIDGET_ID = "pm-compare-widget";
  const DEBOUNCE_MS = 2000;
  const DEBOUNCE_MAX_MS = 5000;
  const DISMISS_KEY = "pm_compare_dismiss";
  const SNOOZE_MS = 6 * 60 * 60 * 1000;
  let lastOfferKey = "";
  let debounceTimer = null;
  let debounceFirstAt = 0;
  let hideTimer = null;
  let lastMatchMethod = "title";
  let comparing = false;

  const parsePrice = PMUtils.parsePrice;

  const ROUTE_SHOPS = new Set(["tutu", "aviasales"]);

  const SHOP_DETECT = [
    { shop_id: "ozon", regex: /(?:https?:\/\/)?(?:www\.)?ozon\.ru(\/product\/(?:[^/?#]+-)?\d{5,}\/?)/i },
    {
      shop_id: "wb",
      regex: /(?:https?:\/\/)?(?:www\.)?wildberries\.ru(\/catalog\/\d+\/detail\.aspx)/i,
    },
    {
      shop_id: "yandex_market",
      regex:
        /(?:https?:\/\/)?(?:www\.)?market\.yandex\.ru(\/(?:card\/[^?#]+\/\d+|product--[^?#]+\/\d+))/i,
    },
    {
      shop_id: "dns",
      regex: /(?:https?:\/\/)?(?:www\.)?dns-shop\.ru(\/product\/[^?#]+)/i,
    },
    {
      shop_id: "citilink",
      regex: /(?:https?:\/\/)?(?:www\.)?citilink\.ru(\/product\/[^?#]+)/i,
    },
    {
      shop_id: "mvideo",
      regex: /(?:https?:\/\/)?(?:www\.)?mvideo\.ru(\/products\/[^?#]+)/i,
    },
    {
      shop_id: "detmir",
      regex: /(?:https?:\/\/)?(?:www\.)?detmir\.ru(\/product\/index\/id\/\d+)/i,
    },
    {
      shop_id: "goldapple",
      regex: /(?:https?:\/\/)?(?:www\.)?goldapple\.ru(\/\d{5,}[^?#]*)/i,
    },
    {
      shop_id: "tutu",
      regex:
        /(?:https?:\/\/)?(?:www\.|avia\.)?tutu\.ru(\/(?:poezda|aviabilety|route|f)\/[^?#]+)/i,
    },
    {
      shop_id: "aviasales",
      regex: /(?:https?:\/\/)?(?:www\.)?aviasales\.ru(\/search\/[^?#]+)/i,
    },
  ];

  function detectShop(url) {
    for (const s of SHOP_DETECT) {
      const m = url.match(s.regex);
      if (m) return { shop_id: s.shop_id, product_id: m[1] };
    }
    return null;
  }

  function routeKeyFromUrl(url, shopId) {
    const low = url.toLowerCase();
    if (shopId === "tutu") {
      const m = low.match(/(?:www\.)?tutu\.ru\/(poezda|aviabilety)\/([^?#]+)/);
      if (m) return `tutu:${m[1]}:${m[2]}`.slice(0, 120);
      const m2 = low.match(/avia\.tutu\.ru\/(route|f)\/([^?#]+)/);
      if (m2) {
        let key = `tutu:${m2[1]}:${m2[2]}`;
        const qm = low.match(/route\[0\]=([^&]+)/);
        if (qm) key += `:${qm[1]}`;
        return key.slice(0, 120);
      }
    }
    if (shopId === "aviasales") {
      const m = low.match(/aviasales\.ru\/search\/([^?#]+)/);
      if (m) return `aviasales:${m[1]}`.slice(0, 120);
    }
    return null;
  }

  function pageKey() {
    return (location.href || "").split("?")[0].split("#")[0];
  }

  function isDismissed() {
    try {
      const raw = sessionStorage.getItem(DISMISS_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || data.url !== pageKey()) return false;
      return Date.now() - Number(data.at || 0) < SNOOZE_MS;
    } catch (_) {
      return false;
    }
  }

  function dismissWidget() {
    try {
      sessionStorage.setItem(
        DISMISS_KEY,
        JSON.stringify({ url: pageKey(), at: Date.now() })
      );
    } catch (_) {
      /* ignore */
    }
    removeWidget();
  }

  function wireDismiss(el) {
    el.querySelector("#pm-compare-dismiss")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dismissWidget();
    });
  }

  function scheduleAutoHide(ms) {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => removeWidget(), ms);
  }

  async function canUseWidget() {
    const stored = await chrome.storage.local.get([
      "can_use_widget",
      "tracker_mode",
      "session_token",
      "tasks_frozen",
      "in_grace",
    ]);
    if (!stored.session_token) return false;
    if (stored.tasks_frozen || stored.in_grace) return false;
    return (
      stored.can_use_widget === true ||
      stored.tracker_mode === "worker" ||
      stored.tracker_mode === "premium"
    );
  }

  function ensureChipShell() {
    let el = document.getElementById(WIDGET_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = WIDGET_ID;
      el.style.cssText =
        "position:fixed;bottom:16px;right:16px;z-index:2147483645;background:#1e293b;color:#fff;" +
        "font:13px/1.4 system-ui,sans-serif;padding:10px 14px;border-radius:10px;" +
        "box-shadow:0 4px 16px rgba(0,0,0,.25);max-width:300px";
      document.documentElement.appendChild(el);
    }
    return el;
  }

  function chipActionsHtml(primaryId, primaryLabel) {
    return (
      "<div style='margin-top:8px;display:flex;gap:8px;flex-wrap:wrap'>" +
      `<button type='button' id='${primaryId}' style='background:#334155;color:#fff;border:0;border-radius:6px;padding:6px 10px;cursor:pointer'>${primaryLabel}</button>` +
      "<button type='button' id='pm-compare-dismiss' style='background:transparent;color:#94a3b8;border:0;padding:6px 4px;cursor:pointer'>Скрыть</button>" +
      "</div>"
    );
  }

  /** Тихий оффер — без запросов и без кликов по странице. */
  function showOfferChip() {
    const el = ensureChipShell();
    clearTimeout(hideTimer);
    el.innerHTML =
      "<div style='opacity:.95'>Сравнить цены на других площадках?</div>" +
      chipActionsHtml("pm-compare-go", "Сравнить");
    el.querySelector("#pm-compare-go")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      runComparison();
    });
    wireDismiss(el);
  }

  function showLoadingChip() {
    const el = ensureChipShell();
    el.innerHTML =
      "<div style='opacity:.9'>Сравниваем цены…</div>" +
      chipActionsHtml("pm-compare-retry", "Обновить");
    el.querySelector("#pm-compare-retry")?.addEventListener("click", () => {
      runComparison();
    });
    wireDismiss(el);
  }

  function showStatusChip(text, { autoHideMs = 0 } = {}) {
    const el = ensureChipShell();
    el.innerHTML =
      "<div style='opacity:.95'>" +
      String(text || "").replace(/[<>&]/g, "") +
      "</div>" +
      chipActionsHtml("pm-compare-retry", "Ещё раз");
    el.querySelector("#pm-compare-retry")?.addEventListener("click", () => {
      runComparison();
    });
    wireDismiss(el);
    if (autoHideMs > 0) scheduleAutoHide(autoHideMs);
  }

  function extractEAN() {
    if (typeof PMUtils !== "undefined" && PMUtils.extractEanFromDocument) {
      return PMUtils.extractEanFromDocument(document);
    }
    return null;
  }

  function extractArticle() {
    if (typeof PMUtils !== "undefined" && PMUtils.extractArticleFromDocument) {
      return PMUtils.extractArticleFromDocument(document);
    }
    return null;
  }

  /**
   * Мягко раскрыть характеристики только если пассивный поиск EAN/артикула пуст.
   * Без scrollIntoView — не дёргаем страницу.
   */
  function prepareCharacteristics({ force = false } = {}) {
    if (!force && (extractEAN() || extractArticle())) return;
    for (const el of document.querySelectorAll("button, [role='button']")) {
      if (el.tagName === "A" || el.closest("a[href*='features']")) continue;
      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (t.length > 48) continue;
      if (/^(все )?характеристики|показать (все|полностью)|развернуть/i.test(t)) {
        try {
          el.click();
        } catch (_) {
          /* ignore */
        }
        break;
      }
    }
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function extractCurrentPrice() {
    const selectors = [
      "[data-widget='webPrice'] span",
      "[data-widget='webCurrentPrice'] span",
      "[class*='priceBlockFinalPrice']",
      "ins[class*='priceBlockFinalPrice']",
      "ins.price-block__final-price",
      "[data-auto='snippet-price-current']",
      "[data-auto='price-value']",
      ".product-buy__price",
      "[data-meta-name='PriceBlock__price']",
      ".price__main-value",
      "[class*='price__main-value']",
      "[data-testid='price']",
      "[data-test-id='product-price']",
      "[data-qa='navigation-product-price_mf-pdp']",
      "[data-testid='price-integer']",
      "[data-ti='price']",
      ".t-price",
      "meta[itemprop='price']",
    ];
    for (const sel of selectors) {
      if (sel.startsWith("meta")) {
        const meta = document.querySelector(sel);
        if (meta?.content) {
          const p = parsePrice(meta.content);
          if (p && p > 0) return p;
        }
        continue;
      }
      for (const el of document.querySelectorAll(sel)) {
        if (
          el.closest(
            ".product-card, .cards-list, .recommendations, .j-card, [class*='product-carousel'], [data-meta-name='Snippet__price']"
          )
        ) {
          continue;
        }
        const p = parsePrice(el.textContent || el.getAttribute("content"));
        if (p && p > 0) return p;
      }
    }
    return null;
  }

  function extractTitle() {
    return document.querySelector("h1")?.textContent?.trim().slice(0, 200) || null;
  }

  function removeWidget() {
    document.getElementById(WIDGET_ID)?.remove();
  }

  function formatRub(n) {
    return new Intl.NumberFormat("ru-RU").format(Math.round(n));
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderWidget(data, label) {
    const currentShop = data.current_shop_id;
    const currentPrice = Number(data.current_price) || 0;
    const cheaper = (data.all_offers || data.offers || [])
      .filter(
        (o) =>
          o &&
          o.shop_id !== currentShop &&
          Number(o.price) > 0 &&
          Number(o.price) < currentPrice
      )
      .sort((a, b) => Number(a.price) - Number(b.price));

    if (!data.has_cheaper && !cheaper.length) {
      const how =
        lastMatchMethod === "ean"
          ? "по штрихкоду"
          : lastMatchMethod === "article"
            ? "по артикулу"
            : "по названию";
      showStatusChip(
        `Пока нет цены ниже на других площадках (${how}).`,
        { autoHideMs: 5000 }
      );
      return;
    }

    const list = cheaper.length
      ? cheaper
      : data.best_offer
        ? [data.best_offer]
        : [];
    if (!list.length) {
      showStatusChip("Дешевле на других площадках не нашли");
      return;
    }

    const rows = list
      .slice(0, 4)
      .map((o) => {
        const href = escapeHtml(o.referral_url || o.url || "#");
        const shop = escapeHtml(o.shop_label || o.shop_id);
        const price = formatRub(o.price);
        const save = formatRub(o.savings || Math.max(0, currentPrice - o.price));
        return (
          `<li class="pm-offer">` +
          `<span class="pm-offer-shop">${shop}</span>` +
          `<span class="pm-offer-price">${price} ₽</span>` +
          `<span class="pm-offer-save">−${save} ₽</span>` +
          `<a class="pm-btn pm-btn-sm" href="${href}" target="_blank" rel="noopener">Купить</a>` +
          `</li>`
        );
      })
      .join("");

    const best = list[0];
    const methodLabel =
      lastMatchMethod === "ean"
        ? "по штрихкоду"
        : lastMatchMethod === "article"
          ? "по артикулу и названию"
          : "по названию и модели";
    const wrap = ensureChipShell();
    clearTimeout(hideTimer);
    wrap.innerHTML = `
      <div class="pm-header">Халявка — дешевле за тот же товар
        <button type="button" id="pm-compare-dismiss" aria-label="Скрыть"
          style="float:right;background:transparent;border:0;color:#94a3b8;cursor:pointer;font-size:16px;line-height:1">×</button>
      </div>
      <div class="pm-body">
        ${escapeHtml(label || "Этот же товар")} на других площадках:
        лучшая цена <span class="pm-savings">${formatRub(best.price)} ₽</span>
        (−${formatRub(best.savings || currentPrice - best.price)} ₽)
      </div>
      <ul class="pm-offers">${rows}</ul>
      <div class="pm-footer">Сравнение ${methodLabel}</div>
    `;
    wireDismiss(wrap);
  }

  function requestCompare(type, payload) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type, payload }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(resp);
      });
    });
  }

  async function runComparison() {
    if (comparing) return;
    if (!(await canUseWidget())) {
      removeWidget();
      return;
    }
    if (isDismissed()) {
      removeWidget();
      return;
    }

    const url = location.href;
    const shop = detectShop(url);
    if (!shop) return;

    const currentPrice = extractCurrentPrice();
    if (!currentPrice) {
      showStatusChip("Цена ещё не загрузилась — подождите и нажмите «Ещё раз».");
      return;
    }

    comparing = true;
    showLoadingChip();

    try {
      const routeKey = routeKeyFromUrl(url, shop.shop_id);
      if (routeKey || ROUTE_SHOPS.has(shop.shop_id)) {
        if (!routeKey) {
          removeWidget();
          return;
        }
        lastMatchMethod = "route";
        const resp = await requestCompare("ROUTE_COMPARE_LOOKUP", {
          route_key: routeKey,
          current_shop_id: shop.shop_id,
          current_price: currentPrice,
          title: extractTitle(),
          product_id: shop.product_id,
        });
        if (resp?.error) {
          showStatusChip("Не удалось сравнить маршрут", { autoHideMs: 4000 });
          return;
        }
        renderWidget(resp, "этот маршрут");
        return;
      }

      // Только по клику: пассивный EAN/артикул, один клик по характеристикам при необходимости
      let ean = extractEAN();
      let article = extractArticle();
      if (!ean && !article) {
        prepareCharacteristics({ force: true });
        await sleep(500);
        ean = extractEAN();
        article = extractArticle();
      }

      const titleBase = extractTitle();
      if (ean === "9785000000000" || (ean && (ean.match(/0/g) || []).length >= ean.length - 2)) {
        ean = null;
      }
      const title = [titleBase, article].filter(Boolean).join(" ").slice(0, 220) || null;
      if (!ean && !title) {
        showStatusChip("Не удалось снять название товара", { autoHideMs: 4000 });
        return;
      }

      lastMatchMethod = ean ? "ean" : article ? "article" : "title";

      const livePayload = {
        current_shop_id: shop.shop_id,
        current_product_id: shop.product_id,
        current_price: currentPrice,
        title: title || undefined,
      };
      if (ean) livePayload.ean = ean;

      let resp = await requestCompare("COMPARE_LIVE", livePayload);
      if (resp?.error && ean) {
        resp = await requestCompare("COMPARE_LOOKUP", {
          ean,
          current_shop_id: shop.shop_id,
          current_product_id: shop.product_id,
          current_price: currentPrice,
          title: title || undefined,
        });
      }
      if (resp?.error) {
        showStatusChip("Не удалось сравнить", { autoHideMs: 4000 });
        return;
      }
      if (resp && !resp.ean && ean) resp.ean = ean;
      renderWidget(resp, "этот же товар");

      const sessionId = resp.session_id;
      if (!sessionId) return;

      const deadline = Date.now() + 45000;
      while (Date.now() < deadline) {
        await sleep(2000);
        if (isDismissed()) {
          removeWidget();
          return;
        }
        let polled;
        try {
          polled = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
              { type: "COMPARE_SESSION_POLL", session_id: sessionId },
              (r) => {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                  return;
                }
                resolve(r);
              }
            );
          });
        } catch (_) {
          break;
        }
        if (polled?.error) break;
        if (polled && !polled.ean && ean) polled.ean = ean;
        renderWidget(polled, "этот же товар");
        const st = polled.status || "";
        if (
          st === "done" ||
          st === "expired" ||
          (polled.targets_open === 0 && polled.targets_total > 0)
        ) {
          break;
        }
      }
    } catch (err) {
      console.debug("[PriceMonitor widget]", err.message);
      showStatusChip(err.message || "Ошибка сравнения", { autoHideMs: 4000 });
    } finally {
      comparing = false;
    }
  }

  /** Только показать оффер — без сети и без кликов по DOM. */
  async function maybeShowOffer() {
    if (comparing || isDismissed()) return;
    if (!(await canUseWidget())) {
      removeWidget();
      return;
    }
    const url = location.href;
    const shop = detectShop(url);
    if (!shop) {
      removeWidget();
      lastOfferKey = "";
      return;
    }
    const price = extractCurrentPrice();
    if (!price) return;
    const key = pageKey();
    if (key === lastOfferKey && document.getElementById(WIDGET_ID)) return;
    lastOfferKey = key;
    showOfferChip();
  }

  function scheduleOffer() {
    if (isDismissed() || comparing) return;
    const now = Date.now();
    if (!debounceFirstAt) debounceFirstAt = now;
    const waited = now - debounceFirstAt;
    const delay = waited >= DEBOUNCE_MAX_MS ? 0 : DEBOUNCE_MS;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceFirstAt = 0;
      maybeShowOffer();
    }, delay);
  }

  // Лёгкий observer: только чтобы появился оффер после загрузки цены, не сравнение
  const observer = new MutationObserver(scheduleOffer);
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
    scheduleOffer();
  } else {
    document.addEventListener("DOMContentLoaded", () => {
      observer.observe(document.body, { childList: true, subtree: true });
      scheduleOffer();
    });
  }
  window.addEventListener("popstate", () => {
    lastOfferKey = "";
    scheduleOffer();
  });
})();
