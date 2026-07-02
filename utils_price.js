/**
 * Нормализация цен и стабилизация readings (debounce ложных срабатываний).
 */
var PMUtils = (function () {
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
        if (newPrice <= 0) return true;
        const { stable, value } = this.push(newPrice);
        if (!stable) return false;
        if (lastKnownPrice == null || lastKnownPrice <= 0) return true;
        if (pricesClose(value, lastKnownPrice, pct)) return true;
        const dropPct = (lastKnownPrice - value) / lastKnownPrice;
        return dropPct >= pct || dropPct <= -pct;
      },
    };
  }

  return { parsePrice, pricesClose, createStabilizer };
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
