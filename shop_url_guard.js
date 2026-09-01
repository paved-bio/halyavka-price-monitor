/**
 * Проверка URL перед открытием вкладки воркером (Ozon: journey / search redirect).
 */
var PMShopUrl = (function () {
  const OZON_BAD_MARKERS = [
    /\/product\/journey-/i,
    /\/product\/halyavka-sim-/i,
    /\/product\/highlight-/i,
    /\/product\/category\//i,
    /\/product\/virt_/i,
    /\/product\/combat_/i,
    /\/product\/day-/i,
  ];
  const OZON_PRODUCT_PATH = /\/product\/(?:[^/?#]+-)?\d{5,}\/?$/i;

  function isOzonSearchUrl(url) {
    return /ozon\.ru\/search(?:\/|\?)/i.test(url || "");
  }

  function isOzonProductPath(path) {
    const p = String(path || "")
      .split("?")[0]
      .split("#")[0]
      .replace(/\/$/, "");
    if (!p.includes("/product/")) return false;
    if (OZON_BAD_MARKERS.some((re) => re.test(p))) return false;
    return OZON_PRODUCT_PATH.test(p);
  }

  function isOzonProductUrl(url) {
    if (!url || !/ozon\.ru/i.test(url)) return false;
    if (isOzonSearchUrl(url)) return false;
    try {
      return isOzonProductPath(new URL(url).pathname);
    } catch (_) {
      const m = String(url).match(/ozon\.ru(\/[^?#]*)/i);
      return m ? isOzonProductPath(m[1]) : false;
    }
  }

  function ozonUrlError(url) {
    if (!url || !/ozon\.ru/i.test(url)) return null;
    if (isOzonSearchUrl(url)) {
      return (
        "Ozon открыл поиск вместо карточки товара — неверная ссылка в задаче " +
        "(часто journey или только product_id). Вставьте ссылку /product/...-ID"
      );
    }
    if (!isOzonProductUrl(url)) {
      return "URL не является карточкой товара Ozon (/product/slug-1234567890)";
    }
    return null;
  }

  return {
    isOzonSearchUrl,
    isOzonProductUrl,
    ozonUrlError,
  };
})();
