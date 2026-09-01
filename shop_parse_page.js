/**
 * Парсинг цены и наличия на странице товара (инжектится в вкладку).
 * Конфиг синхронизирован с price-monitor/shops_config.py
 */
const PM_SHOP_PARSE_CONFIG = {
  ozon: {
    price_xpaths: [
      '//*[@data-widget="webPrice"]//span',
      '//*[@data-widget="webSalePrice"]//span',
      '//*[@data-widget="webCurrentPrice"]//span',
      "//meta[@itemprop='price']/@content",
    ],
    price_css: ["[data-widget='webPrice'] span", "[data-widget='webSalePrice'] span"],
    out_of_stock_phrases: [
      "нет в наличии",
      "раскупили",
      "недоступен для заказа",
      "сообщим о поступлении",
    ],
    out_of_stock_xpaths: ['//*[@data-widget="webOutOfStock"]'],
    in_stock_xpaths: ['//button[contains(., "В корзину")]', '//button[contains(., "Купить")]'],
  },
  wb: {
    price_xpaths: [
      "//*[contains(@class,'priceBlockFinalPrice')]",
      '//*[@id="priceBlock"]//ins',
      "//ins[contains(@class,'price-block__final-price')]",
      '//*[contains(@class,"price-block__final-price")]',
      '//*[contains(@class,"priceBlockPrice")]//span[contains(., "₽")]',
      "//meta[@itemprop='price']/@content",
      '//script[contains(.,"salePrice")]',
    ],
    price_css: [
      "ins.price-block__final-price",
      ".price-block__final-price",
      "[class*='priceBlockFinalPrice']",
      "[class*='price-block__final']",
      "meta[itemprop='price']",
    ],
    out_of_stock_phrases: ["нет в наличии", "нет в наличии в вашем регионе", "распродано"],
    out_of_stock_xpaths: [
      '//*[contains(@class,"sold-out")]',
      '//*[contains(text(),"Нет в наличии")]',
    ],
    in_stock_xpaths: [
      '//button[contains(., "В корзину")]',
      '//button[contains(., "Купить")]',
    ],
  },
  steam: {
    price_xpaths: [
      "//div[contains(@class,'game_purchase_price')]",
      '//*[@id="game_area_purchase"]//*[contains(@class,"discount_final_price")]',
    ],
    price_css: [".game_purchase_price", ".discount_final_price"],
    out_of_stock_phrases: ["not available", "недоступно в вашем регионе"],
    out_of_stock_xpaths: [],
    in_stock_xpaths: ['//div[contains(@class,"game_purchase_action")]//a'],
    free_phrases: ["бесплатн", "free"],
  },
  avito: {
    price_xpaths: [
      '//*[@data-marker="item-view/item-price"]',
      '//span[@itemprop="price"]',
      "//meta[@itemprop='price']/@content",
    ],
    price_css: ['[data-marker="item-view/item-price"]', 'span[itemprop="price"]'],
    out_of_stock_phrases: [
      "снят с публикации",
      "объявление снято",
      "объявление закрыто",
      "не посмотреть",
      "продано",
    ],
    listing_closed_phrases: [
      "объявление не посмотреть",
      "не посмотреть",
      "объявление закрыто",
      "объявление снято",
      "снят с публикации",
    ],
    out_of_stock_xpaths: ['//*[@data-marker="item-view/closed-warning"]'],
    in_stock_xpaths: ['//*[@data-marker="item-view/item-price"]'],
  },
  tutu: {
    price_xpaths: ['//*[@data-ti="price"]', '//*[contains(@class,"t-price")]'],
    price_css: ['[data-ti="price"]', ".t-price"],
    out_of_stock_phrases: ["мест нет", "билеты закончились", "нет билетов", "нет предложений"],
    out_of_stock_xpaths: ['//*[contains(text(),"Мест нет")]'],
    in_stock_xpaths: ['//button[contains(., "Выбрать")]', '//button[contains(., "Купить")]'],
    kind: "tickets",
  },
  yandex_market: {
    price_xpaths: [
      '//*[@data-auto="snippet-price-current"]',
      '//*[@data-auto="price-value"]',
      '//*[@data-auto="productCardPrice"]//span',
      '//*[contains(@data-zone-name,"price")]//span[contains(., "₽")]',
      '//h1/following::*[contains(., "₽")][1]',
      "//meta[@itemprop='price']/@content",
    ],
    price_css: [
      '[data-auto="snippet-price-current"]',
      '[data-auto="price-value"]',
      '[data-auto="productCardPrice"]',
      'meta[itemprop="price"]',
      '[itemprop="price"]',
    ],
    out_of_stock_phrases: ["нет в наличии", "распродано", "закончился"],
    out_of_stock_xpaths: ['//*[contains(text(),"Нет в наличии")]'],
    in_stock_xpaths: ['//button[contains(., "В корзину")]', '//*[@data-auto="buy-button"]'],
  },
  aviasales: {
    price_xpaths: [
      '//*[contains(@class,"ticket")]//*[contains(@class,"price")]',
      '//*[@data-test-id="price"]',
      '//*[contains(@data-test-id,"ticket-fare")]//*[contains(., "₽")]',
      "//meta[@itemprop='price']/@content",
    ],
    price_css: [
      "[class*='ticket'] [class*='price']",
      '[data-test-id="price"]',
      "meta[itemprop='price']",
    ],
    out_of_stock_phrases: ["нет билетов", "не найдено", "распроданы", "нет предложений"],
    out_of_stock_xpaths: ['//*[contains(text(),"Нет билетов")]'],
    in_stock_xpaths: ['//*[contains(@class,"ticket")]'],
    kind: "tickets",
  },
  dns: {
    price_xpaths: [
      "//meta[@itemprop='price']/@content",
      '//*[@class="product-buy__price"]',
    ],
    price_css: [".product-buy__price", 'meta[itemprop="price"]'],
    out_of_stock_phrases: ["нет в наличии", "недоступен для заказа"],
    out_of_stock_xpaths: ['//*[contains(text(),"Нет в наличии")]'],
    in_stock_xpaths: ['//button[contains(., "В корзину")]'],
  },
  goldapple: {
    price_xpaths: [
      "//meta[@itemprop='price']/@content",
      '//*[@data-test-id="product-price"]',
    ],
    price_css: ['meta[itemprop="price"]', '[data-test-id="product-price"]'],
    out_of_stock_phrases: ["нет в наличии", "распродано"],
    out_of_stock_xpaths: ['//*[contains(text(),"Нет в наличии")]'],
    in_stock_xpaths: ['//button[contains(., "В корзину")]', '//button[contains(., "Купить")]'],
  },
  citilink: {
    price_xpaths: [
      '//*[@data-meta-name="PriceBlock__price"]',
      '//*[@data-meta-name="PriceBlock"]',
      "//meta[@itemprop='price']/@content",
    ],
    price_css: ['[data-meta-name="PriceBlock__price"]', '[data-meta-name="PriceBlock"]'],
    out_of_stock_phrases: ["нет в наличии"],
    out_of_stock_xpaths: [],
    in_stock_xpaths: ['//button[contains(., "В корзину")]'],
  },
  mvideo: {
    price_xpaths: [
      '//*[contains(@class,"price__main-value")]',
      "//meta[@itemprop='price']/@content",
    ],
    price_css: [".price__main-value"],
    out_of_stock_phrases: ["нет в наличии"],
    out_of_stock_xpaths: [],
    in_stock_xpaths: ['//button[contains(., "В корзину")]'],
  },
  detmir: {
    price_xpaths: ['//*[@data-testid="price"]', "//meta[@itemprop='price']/@content"],
    price_css: ['[data-testid="price"]', '[data-testid="priceBlock"]'],
    out_of_stock_phrases: ["нет в наличии"],
    out_of_stock_xpaths: [],
    in_stock_xpaths: ['//button[contains(., "В корзину")]'],
  },
  leroymerlin: {
    price_xpaths: [
      '//*[@data-qa="navigation-product-price_mf-pdp"]',
      '//*[@data-testid="price-block-price"]',
      '//*[@data-testid="price-integer"]',
      '//*[@data-testid="price"]',
    ],
    price_css: [
      '[data-qa="navigation-product-price_mf-pdp"]',
      '[data-testid="price-block-price"]',
      '[data-testid="price-integer"]',
    ],
    out_of_stock_phrases: ["нет в наличии", "недоступен"],
    out_of_stock_xpaths: [],
    in_stock_xpaths: ['//button[contains(., "В корзину")]'],
  },
};

function PM_parsePrice(text) {
  if (text == null || text === "") return null;
  const lower = String(text).toLowerCase();
  if (/бесплатн|^free$/i.test(lower.trim())) return 0;
  let s = String(text).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/руб\.?|₽|rub\.?|rur\.?/gi, "");
  s = s.replace(/[^\d,.\-]/g, "");
  if (!s) return null;
  if (s.includes(",") && s.includes(".")) {
    const lastComma = s.lastIndexOf(",");
    const lastDot = s.lastIndexOf(".");
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else {
    s = s.replace(",", ".");
  }
  const num = parseFloat(s);
  if (isNaN(num) || num < 0 || num > 1e9) return null;
  return Math.round(num * 100) / 100;
}

function PM_priceFromXPath(xp) {
  if (xp.includes("@content") && xp.includes("meta")) {
    const meta = document.querySelector('meta[itemprop="price"]');
    const raw = meta?.getAttribute("content") || "";
    return { raw, price: PM_parsePrice(raw), xpath: xp };
  }
  const node = document.evaluate(
    xp,
    document,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null
  ).singleNodeValue;
  const raw = node ? (node.textContent || node.value || "").trim() : "";
  return { raw, price: PM_parsePrice(raw), xpath: xp };
}

/** EAN/GTIN/ISBN для global_products — общая логика с PMUtils (utils_price.js). */
function PM_extractEAN() {
  if (typeof PMUtils !== "undefined" && typeof PMUtils.extractEanFromDocument === "function") {
    return PMUtils.extractEanFromDocument(document);
  }
  // fallback без utils_price
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(script.textContent);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const gtin = item.gtin13 || item.gtin12 || item.gtin || item.isbn;
        const digits = String(gtin || "").replace(/\D/g, "");
        if (digits.length >= 8 && digits.length <= 14) return digits;
      }
    } catch (_) {
      /* ignore */
    }
  }
  const m = (document.body?.innerText || "").match(
    /(?:штрих[-\s]?код|isbn|ean|gtin)\s*[:\n]\s*([\dXx\-\s]{8,20})/i
  );
  if (m) {
    const digits = m[1].replace(/\D/g, "");
    if (digits.length >= 8 && digits.length <= 14) return digits;
  }
  return null;
}

function PM_stripJobOverlayTitle(raw) {
  if (!raw) return "";
  return String(raw)
    .replace(/^⏳\s*/u, "")
    .replace(/^Халявка\s*·\s*(проверка цены|задача биржи|задача)\s*·\s*/iu, "")
    .trim();
}

function PM_extractTitle() {
  const h1 = PM_stripJobOverlayTitle(document.querySelector("h1")?.textContent);
  if (h1 && h1.length > 3 && !/^[\d,\.\s₽руб]+$/i.test(h1) && !/^Халявка\s*·/i.test(h1)) {
    return h1.slice(0, 200);
  }
  const t = PM_stripJobOverlayTitle(document.title)
    .split(" купить")[0]
    ?.split(" | ")[0]
    ?.trim();
  if (t && !/^Халявка\s*·/i.test(t)) return t.slice(0, 200);
  return null;
}

function PM_detectShopId(url) {
  const u = url || location.href;
  if (/ozon\.ru/i.test(u)) return "ozon";
  if (/wildberries\.ru/i.test(u)) return "wb";
  if (/steampowered\.com/i.test(u)) return "steam";
  if (/avito\.ru/i.test(u)) return "avito";
  if (/tutu\.ru/i.test(u)) return "tutu";
  if (/aviasales\.ru/i.test(u)) return "aviasales";
  if (/market\.yandex\.ru/i.test(u)) return "yandex_market";
  if (/dns-shop\.ru/i.test(u)) return "dns";
  if (/goldapple\.ru/i.test(u)) return "goldapple";
  if (/citilink\.ru/i.test(u)) return "citilink";
  if (/mvideo\.ru/i.test(u)) return "mvideo";
  if (/detmir\.ru/i.test(u)) return "detmir";
  if (/lemanapro\.ru|leroymerlin\.ru/i.test(u)) return "leroymerlin";
  return null;
}

/**
 * @param {string|null} shopId
 * @param {string[]|{price_xpaths?:string[],price_css?:string[],...}} xpathsOrConfig
 *   Массив xpath (legacy) ИЛИ полный parse_config с сервера (/meta/shops, job.parse_config).
 *   Серверный конфиг приоритетнее локального PM_SHOP_PARSE_CONFIG — селекторы правятся без релиза расширения.
 */
function PM_parseShopPage(shopId, xpathsOrConfig) {
  const href = location.href;
  if (/ozon\.ru\/search(?:\/|\?)/i.test(href)) {
    return {
      parse_ok: false,
      parse_status: "bad_url",
      raw: "Ozon: открыта страница поиска, не карточка товара",
      price: null,
      in_stock: null,
    };
  }

  const sid = shopId || PM_detectShopId();
  const baked = (sid && PM_SHOP_PARSE_CONFIG[sid]) || {};
  let serverCfg = {};
  let legacyXpaths = [];
  if (Array.isArray(xpathsOrConfig)) {
    legacyXpaths = xpathsOrConfig;
  } else if (xpathsOrConfig && typeof xpathsOrConfig === "object") {
    serverCfg = xpathsOrConfig;
  }

  const cfg = {
    price_xpaths: serverCfg.price_xpaths || baked.price_xpaths || [],
    price_css: serverCfg.price_css || baked.price_css || [],
    out_of_stock_phrases: serverCfg.out_of_stock_phrases || baked.out_of_stock_phrases || [],
    listing_closed_phrases:
      serverCfg.listing_closed_phrases || baked.listing_closed_phrases || [],
    out_of_stock_xpaths: serverCfg.out_of_stock_xpaths || baked.out_of_stock_xpaths || [],
    in_stock_xpaths: serverCfg.in_stock_xpaths || baked.in_stock_xpaths || [],
    free_phrases: serverCfg.free_phrases || baked.free_phrases || [],
    kind: serverCfg.kind || baked.kind || "product",
  };

  const xpaths = [
    ...legacyXpaths,
    ...(cfg.price_xpaths || []).filter((x) => !legacyXpaths.includes(x)),
  ];

  let best = { raw: "", price: null, used_xpath: null };
  const ticketMinPrices = [];
  const collectTicketPrice = (hit) => {
    if (hit.price != null && hit.price > 0) ticketMinPrices.push(hit);
  };
  const ticketSearch =
    cfg.kind === "tickets" &&
    ((sid === "tutu" && /\/f\//i.test(href)) ||
      (sid === "aviasales" && /\/search\//i.test(href)));
  for (const xp of xpaths) {
    const hit = PM_priceFromXPath(xp);
    if (ticketSearch) {
      if (!xp.includes("@content")) {
        const snap = document.evaluate(
          xp,
          document,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null
        );
        for (let i = 0; i < snap.snapshotLength; i++) {
          const node = snap.snapshotItem(i);
          if (sid === "aviasales" && !node.closest('[data-test-id="ticket-preview"]')) {
            continue;
          }
          const raw = (node.textContent || node.value || "").trim();
          collectTicketPrice({ raw, price: PM_parsePrice(raw), xpath: xp });
        }
      } else if (hit.price != null && hit.price > 0) {
        collectTicketPrice(hit);
      }
      continue;
    }
    if (hit.price != null && hit.price > 0) {
      best = { raw: hit.raw, price: hit.price, used_xpath: hit.xpath };
      break;
    }
    if (!best.raw && hit.raw) best = { raw: hit.raw, price: hit.price, used_xpath: hit.xpath };
  }
  if (ticketMinPrices.length) {
    const minHit = ticketMinPrices.reduce((a, b) => (a.price <= b.price ? a : b));
    best = { raw: minHit.raw, price: minHit.price, used_xpath: minHit.xpath };
  }

  if (best.price == null && !ticketMinPrices.length) {
    for (const sel of cfg.price_css || []) {
      for (const el of document.querySelectorAll(sel)) {
        if (
          el.closest(
            ".product-card, .cards-list, .recommendations, .j-card, [class*='product-carousel'], [data-meta-name='Snippet__price']"
          )
        ) {
          continue;
        }
        const p = PM_parsePrice(el.textContent);
        if (p != null && p > 0) {
          best = { raw: el.textContent.trim(), price: p, used_xpath: sel };
          break;
        }
      }
      if (best.price != null && best.price > 0) break;
    }
  }

  let jsonLdInStock = null;
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(script.textContent);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const offers = item.offers || (Array.isArray(item.offers) ? item.offers[0] : null);
        if (offers?.price && best.price == null) {
          best.price = PM_parsePrice(String(offers.price));
          best.used_xpath = "json-ld:offers.price";
        }
        if (offers?.availability) {
          jsonLdInStock = /InStock/i.test(offers.availability);
        }
      }
    } catch (_) {}
  }

  const bodyLower = (document.body?.innerText || "").toLowerCase().slice(0, 25000);
  const h1Lower = (document.querySelector("h1")?.innerText || "").toLowerCase();
  const closedHints = `${h1Lower} ${bodyLower}`;

  let listingClosed = (cfg.listing_closed_phrases || []).some((p) =>
    closedHints.includes(String(p).toLowerCase())
  );
  let outOfStock = (cfg.out_of_stock_phrases || []).some((p) => bodyLower.includes(p));
  for (const xp of cfg.out_of_stock_xpaths || []) {
    const n = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
      .singleNodeValue;
    if (n) outOfStock = true;
  }
  if (listingClosed) outOfStock = true;

  let inStockHint = false;
  for (const xp of cfg.in_stock_xpaths || []) {
    const n = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
      .singleNodeValue;
    if (n) inStockHint = true;
  }

  const isFree = (cfg.free_phrases || []).some((p) => bodyLower.includes(p));
  let in_stock = !outOfStock && (inStockHint || (best.price != null && best.price >= 0) || isFree);
  if (jsonLdInStock === true) in_stock = true;
  if (jsonLdInStock === false) in_stock = false;
  if (listingClosed) in_stock = false;

  const parse_ok = best.price != null || in_stock || outOfStock || inStockHint || listingClosed;
  let parse_status = "ok";
  if (listingClosed) parse_status = "listing_closed";
  else if (outOfStock && !in_stock) parse_status = "out_of_stock";
  else if (!parse_ok) parse_status = "parse_failed";

  return {
    raw: best.raw,
    price: best.price ?? 0,
    in_stock,
    out_of_stock: outOfStock,
    listing_closed: listingClosed,
    parse_ok,
    parse_status,
    used_xpath: best.used_xpath,
    ean: PM_extractEAN(),
    title: PM_extractTitle(),
    shop_id: sid,
    kind: cfg.kind || "product",
  };
}

if (typeof self !== "undefined") {
  self.PM_parseShopPage = PM_parseShopPage;
  self.PM_SHOP_PARSE_CONFIG = PM_SHOP_PARSE_CONFIG;
}
