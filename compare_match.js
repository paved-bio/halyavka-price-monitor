/**
 * Скоринг «тот же товар» для live-compare (зеркало compare_match.py).
 */
var PMCompareMatch = (function () {
  const KNOWN_BRANDS = [
    "apple",
    "samsung",
    "xiaomi",
    "redmi",
    "huawei",
    "honor",
    "sony",
    "lg",
    "asus",
    "acer",
    "lenovo",
    "hp",
    "dell",
    "msi",
    "dyson",
    "bosch",
    "philips",
    "realme",
    "poco",
    "nokia",
    "motorola",
    "canon",
    "nikon",
    "lego",
    "nike",
    "adidas",
    "goggins",
    "гоггинс",
    "magic books",
    "supptrue",
    "dexp",
  ];

  const STOPWORDS = new Set([
    "для",
    "the",
    "and",
    "with",
    "шт",
    "мм",
    "см",
    "гб",
    "gb",
    "ssd",
    "hdd",
    "ips",
    "rgb",
    "новый",
    "новая",
    "купить",
    "цена",
    "оригинал",
    "комплект",
    "набор",
    "black",
    "white",
    "черный",
    "белый",
    "серый",
    "silver",
    "home",
    "pro",
    "max",
    "ноутбук",
    "смартфон",
    "телефон",
    "планшет",
    "книга",
    "книги",
    "протеин",
    "наушники",
    "gadget",
    "ядерный",
    "windows",
    "home",
    "radeon",
    "пылесос",
    "мини",
    "смартфон",
  ]);

  const WEAK_MODEL_RE =
    /^(\d{1,4}(-?ядерн\w*)?|\d{1,4}(gb|гб|tb|тб|mb|мб|hz|гц|ггц|mm|мм)?|\d{1,2})$/i;

  const PLATFORM_TOKENS = new Set([
    "ryzen",
    "intel",
    "amd",
    "core",
    "radeon",
    "geforce",
    "snapdragon",
    "mediatek",
    "windows",
    "macos",
    "android",
    "ddr4",
    "ddr5",
    "whey",
  ]);

  const MIN_MATCH_SCORE = 6;
  const MIN_MATCH_SCORE_STRICT = 8;

  function isStrongModelToken(w) {
    if (!w || STOPWORDS.has(w)) return false;
    if (WEAK_MODEL_RE.test(w)) return false;
    return true;
  }

  function isDistinctiveModelToken(w) {
    if (!isStrongModelToken(w)) return false;
    if (PLATFORM_TOKENS.has(w)) return false;
    return true;
  }

  function normalizeText(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[«»"'()\[\]{},|/\\+._]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokenize(s) {
    const words = [];
    for (const w of normalizeText(s).split(" ")) {
      if (!w) continue;
      if (w.length < 3 && !/\d/.test(w)) continue;
      if (STOPWORDS.has(w)) continue;
      words.push(w);
    }
    return words;
  }

  function extractBrand(title) {
    const low = normalizeText(title);
    const brands = KNOWN_BRANDS.slice().sort((a, b) => b.length - a.length);
    for (const b of brands) {
      if (low.includes(b)) return b;
    }
    const m = String(title || "").match(/^\s*([A-Za-zА-Яа-я]{3,})/);
    if (!m) return null;
    const w = m[1].toLowerCase();
    if (STOPWORDS.has(w) || PLATFORM_TOKENS.has(w)) return null;
    return w;
  }

  function extractModelTokens(title) {
    const brand = extractBrand(title);
    const tokens = tokenize(title);
    const strong = [];
    const weak = [];
    for (const w of tokens) {
      if (brand && w === brand) continue;
      if (STOPWORDS.has(w)) continue;
      const hasDigit = /\d/.test(w);
      const looksCode = /^[a-zа-я]{2,}\d/i.test(w) || (hasDigit && /[a-zа-я]/i.test(w));
      const alphaModel = w.length >= 4 && !hasDigit;
      if (!(looksCode || alphaModel || hasDigit)) continue;
      if (isStrongModelToken(w)) {
        if (!strong.includes(w)) strong.push(w);
      } else if (!weak.includes(w)) {
        weak.push(w);
      }
    }
    return strong.concat(weak).slice(0, 8);
  }

  function isPlausibleEan(ean) {
    if (!ean) return false;
    const d = String(ean).replace(/\D/g, "");
    if (d.length < 8 || d.length > 14) return false;
    if (d === "9785000000000") return false;
    if ((d.match(/0/g) || []).length >= Math.max(6, d.length - 2)) return false;
    if (new Set(d).size === 1) return false;
    return true;
  }

  function buildSearchQuery(title, ean) {
    const brand = extractBrand(title);
    const models = extractModelTokens(title);
    const distinctive = models.filter(isDistinctiveModelToken);
    const rest = models.filter((m) => !distinctive.includes(m));
    const ordered = distinctive.concat(rest);
    const parts = [];
    if (brand) parts.push(brand);
    for (const m of ordered.slice(0, 5)) {
      if (m !== brand && !parts.includes(m)) parts.push(m);
    }
    if (parts.length < 2) {
      for (const w of tokenize(title).slice(0, 6)) {
        if (!parts.includes(w) && !PLATFORM_TOKENS.has(w)) parts.push(w);
      }
    }
    if (isPlausibleEan(ean) && parts.length < 2) {
      parts.push(String(ean).replace(/\D/g, ""));
    }
    return parts.slice(0, 7).join(" ").trim();
  }

  function extractArticleToken(title) {
    if (!title) return null;
    const m = String(title).match(
      /(?:артикул|article|sku|mpn|код\s*товара)\s*[:\s]+([a-z0-9][a-z0-9\-_./]{2,40})/i
    );
    if (m) return m[1].toLowerCase();
    const candidates = [];
    for (const t of tokenize(title)) {
      if (t.length < 5) continue;
      if (/^[a-z]{2,}\d{2,}[a-z0-9]*$/i.test(t) || /^[a-z]{2,}-\d/i.test(t)) {
        candidates.push(t);
      }
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => {
      const da = (a.match(/\d/g) || []).length;
      const db = (b.match(/\d/g) || []).length;
      return db - da || b.length - a.length;
    });
    return candidates[0];
  }

  function scoreCandidate(sourceTitle, candidateTitle, sourceEan, candidateEan) {
    const src = normalizeText(sourceTitle);
    const cand = normalizeText(candidateTitle);
    if (!src || !cand) return { score: 0, accept: false, reason: "empty_title" };

    if (
      isPlausibleEan(sourceEan) &&
      isPlausibleEan(candidateEan) &&
      String(sourceEan).replace(/\D/g, "") === String(candidateEan).replace(/\D/g, "")
    ) {
      return { score: 100, accept: true, reason: "ean_exact" };
    }

    const srcArticle = extractArticleToken(sourceTitle);
    const candArticle = extractArticleToken(candidateTitle);
    if (srcArticle && candArticle && srcArticle === candArticle) {
      return { score: 90, accept: true, reason: "article_exact", article: srcArticle };
    }

    const brand = extractBrand(sourceTitle);
    const candBrand = extractBrand(candidateTitle);
    let score = 0;
    const reasons = [];
    if (srcArticle && cand.includes(srcArticle)) {
      score += 8;
      reasons.push("article_in_title");
    }

    const srcModels = extractModelTokens(sourceTitle);
    const strongSrc = srcModels.filter(isStrongModelToken);
    const distinctiveSrc = strongSrc.filter(isDistinctiveModelToken);
    const hitModels = srcModels.filter((m) => cand.includes(m));
    const hitStrong = hitModels.filter(isStrongModelToken);
    const hitDistinctive = hitModels.filter(isDistinctiveModelToken);

    let brandOk = false;
    if (brand) {
      if (cand.includes(brand) || (candBrand && candBrand === brand)) {
        score += 4;
        reasons.push("brand");
        brandOk = true;
      } else if (hitDistinctive.length) {
        score += 2;
        reasons.push("brand_soft");
        brandOk = true;
      } else {
        return { score: 0, accept: false, reason: "brand_mismatch", brand };
      }
    }

    if (hitDistinctive.length) {
      score += Math.min(6, 2 * hitDistinctive.length);
      reasons.push("model:" + hitDistinctive.slice(0, 3).join(","));
    } else if (hitStrong.length) {
      score += Math.min(3, hitStrong.length);
      reasons.push("platform:" + hitStrong.slice(0, 2).join(","));
    } else if (hitModels.length) {
      score += 1;
      reasons.push("weak_model:" + hitModels.slice(0, 2).join(","));
    } else {
      reasons.push("no_model");
    }

    const srcToks = new Set(
      tokenize(sourceTitle).filter((t) => isDistinctiveModelToken(t) || t === brand)
    );
    const candToks = new Set(tokenize(candidateTitle));
    let overlap = 0;
    for (const t of srcToks) if (candToks.has(t)) overlap++;
    score += Math.min(3, overlap);

    let accept;
    if (distinctiveSrc.length) {
      accept = score >= MIN_MATCH_SCORE && hitDistinctive.length > 0 && (brandOk || !brand);
    } else {
      accept = score >= MIN_MATCH_SCORE && hitStrong.length > 0;
      if (brand && strongSrc.length && !hitStrong.length) {
        accept = false;
        reasons.push("need_strong_model");
      }
    }
    if (!strongSrc.length && !brand) {
      accept = score >= MIN_MATCH_SCORE_STRICT || (score >= MIN_MATCH_SCORE && overlap >= 2);
    }

    const versionSrc = distinctiveSrc.filter(
      (m) => /^v\d+/i.test(m) || /^\d{2}$/.test(m)
    );
    if (versionSrc.length && !versionSrc.some((v) => cand.includes(v))) {
      accept = false;
      reasons.push("version_mismatch");
    }

    return {
      score,
      accept,
      reason: reasons.join("+") || "weak",
      brand,
      models_hit: hitDistinctive.length ? hitDistinctive : hitStrong.length ? hitStrong : hitModels,
    };
  }

  /** Выбрать лучшую карточку на выдаче поиска. */
  function pickBestFromSearchDocument(sourceTitle, shopId) {
    const brand = extractBrand(sourceTitle);
    const models = extractModelTokens(sourceTitle);
    const needles = [...new Set([brand, ...models, ...tokenize(sourceTitle)].filter(Boolean))];

    const anchors = Array.from(document.querySelectorAll("a[href]"));
    const candidates = [];
    for (const a of anchors) {
      const href = a.href || "";
      const text = (a.innerText || a.getAttribute("aria-label") || "")
        .replace(/\s+/g, " ")
        .trim();
      if (text.length < 8 || text.length > 240) continue;

      const isWb = /wildberries\.ru\/catalog\/\d+\/detail/i.test(href);
      const isOzon = /ozon\.ru\/product\//i.test(href);
      const isYm = /market\.yandex\.ru\/(card|product--)/i.test(href);
      const isDns = /dns-shop\.ru\/product\//i.test(href);
      const isCitilink = /citilink\.ru\/product\//i.test(href);
      const isMvideo = /mvideo\.ru\/products\//i.test(href);
      const isDetmir = /detmir\.ru\/product\//i.test(href);
      const ok =
        (shopId === "wb" && isWb) ||
        (shopId === "ozon" && isOzon) ||
        (shopId === "yandex_market" && isYm) ||
        (shopId === "dns" && isDns) ||
        (shopId === "citilink" && isCitilink) ||
        (shopId === "mvideo" && isMvideo) ||
        (shopId === "detmir" && isDetmir) ||
        (!shopId && (isWb || isOzon || isYm || isDns || isCitilink));
      if (!ok) continue;

      const sc = scoreCandidate(sourceTitle, text, null, null);
      let score = sc.score;
      const wrap = (a.closest("article, div, li") || a).innerText || "";
      if (/\d[\d\s]{2,}\s*₽/.test(wrap)) score += 1;
      for (const n of needles) {
        if (n && text.toLowerCase().includes(n)) score += 0.5;
      }
      candidates.push({
        href,
        text: text.slice(0, 160),
        score,
        accept: sc.accept,
        reason: sc.reason,
      });
    }
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates.find((c) => c.accept) || null;
    return {
      best,
      top: candidates.slice(0, 8),
      count: candidates.length,
      query_hints: needles.slice(0, 8),
    };
  }

  function isSearchUrl(url) {
    const u = String(url || "").toLowerCase();
    return (
      /\/search/.test(u) ||
      /search\.aspx/.test(u) ||
      /product-list-page/.test(u) ||
      /catalogsearch/.test(u) ||
      /catalog\/0\/search/.test(u)
    );
  }

  function isProductUrl(url, shopId) {
    const u = String(url || "");
    if (shopId === "wb") return /\/catalog\/\d+\/detail/i.test(u);
    if (shopId === "ozon") return /\/product\//i.test(u);
    if (shopId === "yandex_market") return /\/(card|product--)/i.test(u);
    if (shopId === "dns") return /\/product\//i.test(u);
    if (shopId === "citilink") return /\/product\//i.test(u);
    if (shopId === "mvideo") return /\/products\//i.test(u);
    if (shopId === "detmir") return /\/product\//i.test(u);
    if (String(shopId || "").startsWith("mock_")) return true;
    return !isSearchUrl(u);
  }

  function extractProductIdFromUrl(url, shopId) {
    const u = String(url || "");
    if (shopId === "wb") {
      const m = u.match(/\/catalog\/(\d+)\/detail/i);
      return m ? m[1] : "";
    }
    if (shopId === "ozon") {
      const m = u.match(/-(\d+)\/?(?:\?|$)/) || u.match(/\/product\/[^/]*?(\d{6,})/i);
      return m ? m[1] : "";
    }
    if (shopId === "citilink") {
      const m = u.match(/-(\d+)\/?(?:\?|$)/);
      return m ? m[1] : "";
    }
    return "";
  }

  return {
    normalizeText,
    tokenize,
    extractBrand,
    extractModelTokens,
    isPlausibleEan,
    buildSearchQuery,
    scoreCandidate,
    pickBestFromSearchDocument,
    isSearchUrl,
    isProductUrl,
    extractProductIdFromUrl,
    MIN_MATCH_SCORE,
  };
})();
