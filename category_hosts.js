/**
 * Разрешённые домены по категории earn (авантюрист).
 * Воркер мониторинга — отдельный SAFE_SHOPS в background.js.
 */
(function () {
  const MONITOR_HOSTS = [
    "ozon.ru",
    "wildberries.ru",
    "steampowered.com",
    "avito.ru",
    "tutu.ru",
    "halyavka.online",
    "127.0.0.1",
    "localhost",
  ];

  const CATEGORY_HOSTS = {
    mock_vk_like: MONITOR_HOSTS,
    mock_vk_comment: MONITOR_HOSTS,
    mock_page_dwell: MONITOR_HOSTS,
    monitor_extract: MONITOR_HOSTS,
    vk_like: ["vk.com", "vk.ru", "m.vk.com"],
    vk_comment: ["vk.com", "vk.ru", "m.vk.com"],
    youtube_like: ["youtube.com", "youtu.be", "m.youtube.com", "halyavka.online", "127.0.0.1", "localhost"],
    youtube_watch: ["youtube.com", "youtu.be", "halyavka.online", "127.0.0.1", "localhost"],
    twitch_dwell: ["twitch.tv", "halyavka.online", "127.0.0.1", "localhost"],
    instagram_like: ["instagram.com"],
    instagram_comment: ["instagram.com"],
    telegram_reaction: ["t.me", "telegram.org", "web.telegram.org"],
    avito_price: ["avito.ru"],
    mock_avito_call: MONITOR_HOSTS,
    avito_call_click: ["avito.ru"],
    tutu_price: ["tutu.ru"],
    wb_price: ["wildberries.ru"],
    ozon_price: ["ozon.ru"],
    avito_review: ["avito.ru"],
    ozon_review: ["ozon.ru"],
    wildberries_review: ["wildberries.ru"],
    yandex_maps_review: ["yandex.ru", "yandex.com"],
    google_maps_review: ["google.com", "google.ru"],
    promo_parse_categories: ["pikabu.ru", "promokod.pikabu.ru", "halyavka.online"],
    promo_parse_shops: ["pikabu.ru", "promokod.pikabu.ru", "halyavka.online"],
    promo_parse_shop: ["pikabu.ru", "promokod.pikabu.ru", "halyavka.online"],
    custom_site_crawl: null,
  };

  function hostMatches(hostname, pattern) {
    const h = String(hostname || "").toLowerCase().replace(/^\./, "");
    const p = String(pattern || "").toLowerCase().replace(/^\./, "");
    if (!h || !p) return false;
    if (h === p) return true;
    return h.endsWith("." + p);
  }

  function isUrlAllowedForCategory(category, url) {
    const cat = String(category || "");
    if (cat.startsWith("mock_")) return true;
    const allowed = CATEGORY_HOSTS[cat];
    if (allowed === null) {
      return true;
    }
    if (!allowed || !allowed.length) return false;
    let host;
    try {
      host = new URL(url).hostname;
    } catch (_) {
      return false;
    }
    return allowed.some((pat) => hostMatches(host, pat));
  }

  const api = { CATEGORY_HOSTS, isUrlAllowedForCategory, MONITOR_HOSTS };
  if (typeof self !== "undefined") self.PMCategoryHosts = api;
  if (typeof globalThis !== "undefined") globalThis.PMCategoryHosts = api;
})();
