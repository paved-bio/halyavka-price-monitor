/**
 * Нормализация цен, EAN/GTIN/ISBN и стабилизация readings.
 */
var PMUtils = (function () {
  /** EAN/GTIN/ISBN → только цифры 8–14 (ISBN с дефисами тоже). */
  function normalizeEanCandidate(raw) {
    if (raw == null || raw === "") return null;
    const digits = String(raw).replace(/\D/g, "");
    if (digits.length >= 8 && digits.length <= 14) return digits;
    return null;
  }

  function parsePrice(text) {
    if (text == null || text === "") return null;
    let s = String(text)
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    s = s.replace(/руб\.?|₽|rub\.?|rur\.?/gi, "");
    s = s.replace(/[^\d,.\-]/g, "");
    if (!s) return null;
    if (s.includes(",") && s.includes(".")) {
      const lastComma = s.lastIndexOf(",");
      const lastDot = s.lastIndexOf(".");
      if (lastComma > lastDot) {
        s = s.replace(/\./g, "").replace(",", ".");
      } else {
        s = s.replace(/,/g, "");
      }
    } else {
      s = s.replace(",", ".");
    }
    const num = parseFloat(s);
    if (isNaN(num) || num <= 0 || num > 1e9) return null;
    return Math.round(num * 100) / 100;
  }

  function pricesClose(a, b, pctThreshold) {
    if (a == null || b == null) return false;
    const pct = pctThreshold ?? 0.005;
    const diff = Math.abs(a - b);
    const base = Math.max(a, b, 1);
    return diff / base <= pct;
  }

  function createStabilizer(requiredMatches, pctThreshold) {
    const required = requiredMatches ?? 2;
    const pct = pctThreshold ?? 0.005;
    const buf = [];

    return {
      push(price) {
        if (price == null || price <= 0) return { stable: false, value: null };
        buf.push(price);
        if (buf.length > 5) buf.shift();
        if (buf.length < required) return { stable: false, value: null };
        const tail = buf.slice(-required);
        const first = tail[0];
        const allClose = tail.every((p) => pricesClose(p, first, pct));
        return { stable: allClose, value: allClose ? first : null };
      },
      reset() {
        buf.length = 0;
      },
      shouldReport(newPrice, lastKnownPrice) {
        // Один parse на job: ту же цену подтверждаем сразу.
        // Смену цены подтверждаем 2 близкими readings (буфер между визитами).
        if (newPrice <= 0) return true;
        if (lastKnownPrice == null || lastKnownPrice <= 0) {
          this.reset();
          return true;
        }
        if (pricesClose(newPrice, lastKnownPrice, pct)) {
          this.reset();
          return true;
        }
        const { stable } = this.push(newPrice);
        return Boolean(stable);
      },
    };
  }

  /**
   * Извлечь EAN/GTIN/ISBN со страницы карточки (DOM + JSON-LD + inline state).
   * ISBN с дефисами нормализуется в цифры.
   */
  function extractEanFromDocument(doc) {
    const document = doc || (typeof window !== "undefined" ? window.document : null);
    const win = typeof window !== "undefined" ? window : null;
    if (!document) return null;

    function scanJson(obj, depth) {
      if (depth > 8 || obj == null) return null;
      if (typeof obj === "string" || typeof obj === "number") {
        return normalizeEanCandidate(obj);
      }
      if (typeof obj !== "object") return null;
      const keys = [
        "barcode",
        "ean",
        "gtin",
        "gtin13",
        "gtin12",
        "gtin8",
        "isbn",
        "isbn13",
        "штрихкод",
      ];
      for (const k of keys) {
        if (obj[k] != null) {
          const hit = normalizeEanCandidate(obj[k]);
          if (hit) return hit;
        }
      }
      // пары { name/key: "Штрихкод"|"ISBN", value: "..." }
      const label = String(obj.name || obj.key || obj.title || "").toLowerCase();
      if (/штрих|ean|gtin|isbn|barcode/.test(label) && obj.value != null) {
        const hit = normalizeEanCandidate(obj.value);
        if (hit) return hit;
      }
      for (const v of Object.values(obj)) {
        const found = scanJson(v, depth + 1);
        if (found) return found;
      }
      return null;
    }

    if (win?.__NUXT__?.data) {
      const fromNuxt = scanJson(win.__NUXT__.data, 0);
      if (fromNuxt) return fromNuxt;
    }

    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(script.textContent);
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          const gtin =
            item.gtin13 || item.gtin12 || item.gtin || item.gtin8 || item.isbn || item.isbn13;
          const hit = normalizeEanCandidate(gtin);
          if (hit) return hit;
          const offers = item.offers;
          const offer = Array.isArray(offers) ? offers[0] : offers;
          const oh = normalizeEanCandidate(offer?.gtin13 || offer?.gtin || offer?.isbn);
          if (oh) return oh;
        }
      } catch (_) {
        /* ignore */
      }
    }

    for (const script of document.querySelectorAll("script:not([src])")) {
      const t = script.textContent;
      if (!t || t.length > 800000) continue;
      if (!/barcode|gtin|ean|штрих|isbn/i.test(t)) continue;
      const patterns = [
        /"(?:barcode|gtin13|gtin12|gtin8|gtin|ean|isbn13|isbn)"\s*:\s*"([\dXx\-]{8,20})"/i,
        /"(?:barcode|gtin13|gtin12|gtin8|gtin|ean|isbn13|isbn)"\s*:\s*(\d{8,14})/i,
        /"(?:name|key|title)"\s*:\s*"(?:Штрихкод|ISBN|EAN|GTIN)"[^}]{0,120}"value"\s*:\s*"([\dXx\-\s]{8,20})"/i,
      ];
      for (const re of patterns) {
        const m = t.match(re);
        if (m) {
          const hit = normalizeEanCandidate(m[1]);
          if (hit) return hit;
        }
      }
      if (t.trim().startsWith("{") || t.trim().startsWith("[")) {
        try {
          const hit = scanJson(JSON.parse(t), 0);
          if (hit) return hit;
        } catch (_) {
          /* ignore */
        }
      }
    }

    const labelRe = /^(штрих\s*код|штрихкод|ean|barcode|upc|gtin|isbn)$/i;
    for (const el of document.querySelectorAll("dt, span, div, td, th, li, p")) {
      const label = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!label || label.length > 40) continue;
      if (labelRe.test(label)) {
        const sibling =
          el.nextElementSibling ||
          el.parentElement?.querySelector("dd, span + span, div + div");
        const hit = normalizeEanCandidate(sibling?.textContent || "");
        if (hit) return hit;
      }
      // «ISBN 978-5-…» / «Штрихкод 4600…» в одной строке
      const inline = label.match(
        /^(?:штрих\s*код|штрихкод|ean|barcode|upc|gtin|isbn)\s*[:\s]+([\dXx\-\s]{8,20})$/i
      );
      if (inline) {
        const hit = normalizeEanCandidate(inline[1]);
        if (hit) return hit;
      }
    }

    const body = document.body?.innerText || "";
    const bodyPatterns = [
      /штрих[-\s]?код\s*[:\n]\s*([\d\-\s]{8,20})/i,
      /ISBN\s*[:\n]\s*([\dXx\-\s]{8,20})/i,
      /EAN\s*[:\n]\s*([\d\-\s]{8,20})/i,
      /GTIN\s*[:\n]\s*([\d\-\s]{8,20})/i,
      /barcode\s*[:\n]\s*([\d\-\s]{8,20})/i,
    ];
    for (const re of bodyPatterns) {
      const m = body.match(re);
      if (m) {
        const hit = normalizeEanCandidate(m[1]);
        if (hit) return hit;
      }
    }
    return null;
  }

  /**
   * Артикул / SKU / vendor code — запасной ключ сравнения, когда EAN нет.
   */
  function extractArticleFromDocument(doc) {
    const document = doc || (typeof window !== "undefined" ? window.document : null);
    if (!document) return null;
    const labelRe = /^(артикул|article|sku|код\s*товара|model\s*number|mpn)$/i;
    for (const el of document.querySelectorAll("dt, span, div, td, th, li, p")) {
      const label = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (!label || label.length > 40) continue;
      if (labelRe.test(label)) {
        const sibling =
          el.nextElementSibling ||
          el.parentElement?.querySelector("dd, span + span, div + div");
        const val = (sibling?.textContent || "").replace(/\s+/g, " ").trim();
        if (val && /^[A-Za-z0-9][A-Za-z0-9\-_./]{2,40}$/.test(val)) return val;
      }
      const inline = label.match(
        /^(?:артикул|article|sku|код\s*товара|mpn)\s*[:\s]+([A-Za-z0-9][A-Za-z0-9\-_./]{2,40})$/i
      );
      if (inline) return inline[1];
    }
    const body = document.body?.innerText || "";
    const m = body.match(
      /(?:артикул|article|sku|код\s*товара|mpn)\s*[:\n]\s*([A-Za-z0-9][A-Za-z0-9\-_./]{2,40})/i
    );
    return m ? m[1] : null;
  }

  return {
    parsePrice,
    pricesClose,
    createStabilizer,
    normalizeEanCandidate,
    extractEanFromDocument,
    extractArticleFromDocument,
  };
})();

// Service worker (importScripts)
if (typeof self !== "undefined" && self.PriceStabilizers === undefined) {
  self.PriceStabilizers = new Map();
  self.getPriceStabilizer = function (taskId) {
    if (!self.PriceStabilizers.has(taskId)) {
      self.PriceStabilizers.set(taskId, PMUtils.createStabilizer(2, 0.005));
    }
    return self.PriceStabilizers.get(taskId);
  };
}
