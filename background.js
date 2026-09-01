importScripts("utils_price.js", "api_config.js", "constants.js", "session_store.js", "canonical_json.js", "integrity.js", "category_hosts.js", "shop_url_guard.js", "solo_tasks.js", "compare_match.js");

const ALARM_NAME = "price-monitor-heartbeat";
const SOLO_ALARM = "price-monitor-solo-check";
const UPDATE_ALARM = "price-monitor-update-check";
const HEARTBEAT_MINUTES = 2;
const WORKER_SESSION_MAX_JOBS = 40;
const WORKER_JOB_PAUSE_MIN_MS = 1500;
const WORKER_JOB_PAUSE_MAX_MS = 3000;
const UPDATE_CHECK_MINUTES = 2;
const UPDATE_CHECK_INTERVAL_MS = UPDATE_CHECK_MINUTES * 60 * 1000;
/** Сразу ставим файлы и reload — без «подождите 30с / нажмите кнопку». */
const UPDATE_AUTO_INSTALL_DELAY_MS = 0;
const UPDATE_APPLY_RETRY_MS = 45 * 1000;
const NATIVE_POLL_COOLDOWN_MS = 60 * 1000;
const NATIVE_HOST = "com.halyavka.pricemonitor";
const VERSION_JSON_URL = "https://halyavka.online/extension/version.json";
const EXTENSION_INSTALL_URL = "https://halyavka.online/extension/";
const AUTO_UPDATE_SETUP_URL = "https://halyavka.online/extension/auto-update.html";
const TAB_LOAD_TIMEOUT_MS = 50000;
const TAB_SETTLE_AFTER_LOAD_MS = 1200;
/** SPA/антибот часто отдаёт пустой body сразу после complete — ждём дольше перед вердиктом. */
const TAB_SPARSE_BODY_RETRY_MS = 7000;
const TAB_SPARSE_BODY_THRESHOLD = 800;
const SHOP_CONFIG_TTL_MS = 30 * 60 * 1000;
/**
 * После N «магазин не открывается» на этом воркере — не открываем вкладки TTL часов.
 * Храним в chrome.storage.local: MV3 service worker часто убивают, Map в памяти сбрасывается.
 */
const SESSION_SHOP_LOAD_FAIL_LIMIT = 2;
const SESSION_SHOP_SKIP_TTL_MS = 6 * 60 * 60 * 1000;
const SHOP_FAIL_STORAGE_KEY = "session_shop_load_fails";

/** Не стартовать второй drain, пока первый ещё крутит вкладки. */
let heartbeatInFlight = false;
let earnBatchInFlight = false;

/** Кэш в памяти + persist; подгружаем перед heartbeat. */
let sessionShopLoadFails = Object.create(null);

function pruneExpiredShopFails(map) {
  const now = Date.now();
  const src = map || sessionShopLoadFails;
  for (const shopId of Object.keys(src)) {
    const entry = src[shopId];
    if (entry?.skippedUntil && entry.skippedUntil <= now) {
      delete src[shopId];
    }
  }
  return src;
}

function isShopUnreachableError(parseError) {
  const t = String(parseError || "");
  if (!t || /^session_shop_skip:/i.test(t)) return false;
  return /таймаут|page_not_ready|antibot|пустой результат|не удалось определить|could not establish|frame was removed|no tab with id|net::|ERR_|connection|доступ ограничен|access denied|challenge|cloudflare|qrator|captcha/i.test(
    t
  );
}

async function loadShopFailState() {
  try {
    const stored = await chrome.storage.local.get([SHOP_FAIL_STORAGE_KEY]);
    const raw = stored[SHOP_FAIL_STORAGE_KEY];
    sessionShopLoadFails =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? { ...raw }
        : Object.create(null);
  } catch (_) {
    sessionShopLoadFails = Object.create(null);
  }
  pruneExpiredShopFails();
}

async function saveShopFailState() {
  pruneExpiredShopFails();
  try {
    await chrome.storage.local.set({ [SHOP_FAIL_STORAGE_KEY]: { ...sessionShopLoadFails } });
  } catch (_) {
    /* ignore */
  }
}

async function noteShopLoadOutcome(shopId, parseError) {
  if (!shopId) return;
  pruneExpiredShopFails();
  if (isShopUnreachableError(parseError)) {
    const prev = sessionShopLoadFails[shopId] || { count: 0, skippedUntil: 0 };
    const count = (prev.count || 0) + 1;
    const entry = { count, skippedUntil: prev.skippedUntil || 0 };
    if (count >= SESSION_SHOP_LOAD_FAIL_LIMIT) {
      entry.skippedUntil = Date.now() + SESSION_SHOP_SKIP_TTL_MS;
      console.warn(
        "[PriceMonitor] Магазин",
        shopId,
        "не открывается — пауза",
        Math.round(SESSION_SHOP_SKIP_TTL_MS / 3600000),
        "ч"
      );
    }
    sessionShopLoadFails[shopId] = entry;
    await saveShopFailState();
  } else if (!parseError) {
    if (sessionShopLoadFails[shopId]) {
      delete sessionShopLoadFails[shopId];
      await saveShopFailState();
    }
  }
}

function shopSkippedThisSession(shopId) {
  pruneExpiredShopFails();
  const entry = sessionShopLoadFails[shopId];
  if (!entry) return false;
  return (
    (entry.count || 0) >= SESSION_SHOP_LOAD_FAIL_LIMIT &&
    (entry.skippedUntil || 0) > Date.now()
  );
}

async function getIdleThresholdSec() {
  const { worker_idle_minutes, earn_run_mode } = await chrome.storage.local.get([
    "worker_idle_minutes",
    "earn_run_mode",
  ]);
  // 0 = always (treat as idle for P2P)
  const mins = worker_idle_minutes;
  if (mins === 0 || mins === "0") return 0;
  const n = parseInt(mins, 10);
  if ([5, 15, 30].includes(n)) return n * 60;
  if (earn_run_mode === "always") return 0;
  return 300;
}

async function popupNotifyAllowed() {
  const { popup_notifications_enabled } = await chrome.storage.local.get([
    "popup_notifications_enabled",
  ]);
  return popup_notifications_enabled !== false;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function sortKeysDeep(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  return Object.keys(value).sort().reduce((acc, k) => {
    acc[k] = sortKeysDeep(value[k]);
    return acc;
  }, {});
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function proofFingerprint(proof, payload) {
  const blob = proofFingerprintCanonical(proof, payload);
  return sha256Hex(blob);
}

async function signJobReport(reportToken, jobId, ok, proof, payload) {
  if (!reportToken) return null;
  const fp = await proofFingerprint(proof, payload);
  const msg = `${jobId}:${ok ? 1 : 0}:${fp}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(reportToken),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function authFetch(url, options = {}) {
  const { session_token } = await chrome.storage.local.get(["session_token"]);
  if (!session_token) throw new Error("Нет session_token");
  const headers = {
    ...(options.headers || {}),
    Authorization: `Bearer ${session_token}`,
  };
  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  return fetch(url, { ...options, headers });
}

async function apiFetch(path, options = {}) {
  const url = await pmApiUrl(path);
  return authFetch(url, options);
}

async function isUserIdle() {
  const threshold = await getIdleThresholdSec();
  if (threshold === 0) return true;
  return new Promise((resolve) => {
    chrome.idle.queryState(threshold, (state) => {
      resolve(state === "idle" || state === "locked");
    });
  });
}

function waitForTabComplete(tabId) {
  return new Promise((resolve, reject) => {
    function cleanup() {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    }

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Таймаут загрузки вкладки"));
    }, TAB_LOAD_TIMEOUT_MS);

    function onUpdated(updatedId, info) {
      if (updatedId === tabId && info.status === "complete") {
        cleanup();
        setTimeout(resolve, TAB_SETTLE_AFTER_LOAD_MS);
      }
    }

    function onRemoved(closedId) {
      if (closedId === tabId) {
        cleanup();
        reject(new Error("Вкладка закрыта"));
      }
    }

    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        cleanup();
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (tab.status === "complete") {
        cleanup();
        setTimeout(resolve, TAB_SETTLE_AFTER_LOAD_MS);
        return;
      }
      chrome.tabs.onUpdated.addListener(onUpdated);
      chrome.tabs.onRemoved.addListener(onRemoved);
    });
  });
}

function injectAndParse(tabId, shopId, parseConfig) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Таймаут парсинга"));
    }, 20000);

    chrome.scripting.executeScript(
      { target: { tabId }, files: ["utils_price.js", "shop_parse_page.js"] },
      () => {
        if (chrome.runtime.lastError) {
          clearTimeout(timeout);
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        chrome.scripting.executeScript(
          {
            target: { tabId },
            func: (sid, cfg) => window.PM_parseShopPage(sid, cfg),
            args: [shopId || null, parseConfig || {}],
          },
          (results) => {
            clearTimeout(timeout);
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            const r = results?.[0]?.result;
            if (!r) {
              reject(new Error("Пустой результат парсинга"));
              return;
            }
            if (!r.parse_ok) {
              reject(new Error(`Не удалось определить цену/наличие (${r.raw || "пусто"})`));
              return;
            }
            resolve({
              price: r.price ?? 0,
              in_stock: r.in_stock,
              out_of_stock: Boolean(r.out_of_stock),
              listing_closed: Boolean(r.listing_closed),
              parse_status: r.parse_status || "ok",
              ean: r.ean || null,
              title: r.title || null,
              used_xpath: r.used_xpath || null,
              kind: r.kind || null,
            });
          }
        );
      }
    );
  });
}

async function syncShopParseConfigs({ force = false } = {}) {
  try {
    const stored = await chrome.storage.local.get([
      "shop_parse_configs_at",
      "shop_parse_config_version",
      "shop_parse_configs",
    ]);
    const withinTtl =
      stored.shop_parse_configs_at &&
      Date.now() - stored.shop_parse_configs_at < SHOP_CONFIG_TTL_MS;
    const hasCache =
      stored.shop_parse_configs && Object.keys(stored.shop_parse_configs).length > 0;

    const url = await pmApiUrl("/meta/shops");
    const res = await fetch(url);
    if (!res.ok) return;
    const data = await res.json();
    const remoteVer = data.parse_config_version || 0;
    const localVer = stored.shop_parse_config_version || 0;

    // Внутри TTL не пишем заново, пока сервер не поднял PARSE_CONFIG_VERSION
    if (!force && withinTtl && hasCache && remoteVer <= localVer) {
      return;
    }

    await chrome.storage.local.set({
      shop_parse_configs: data.shops || {},
      shop_parse_config_version: remoteVer,
      shop_parse_configs_at: Date.now(),
    });
    console.log("[PriceMonitor] shop parse configs synced, version=", remoteVer);
  } catch (e) {
    console.warn("[PriceMonitor] syncShopParseConfigs:", e.message || e);
  }
}

async function resolveParseConfig(shopId, xpathsOrConfig) {
  if (xpathsOrConfig && !Array.isArray(xpathsOrConfig) && typeof xpathsOrConfig === "object") {
    return xpathsOrConfig;
  }
  await syncShopParseConfigs();
  const { shop_parse_configs } = await chrome.storage.local.get(["shop_parse_configs"]);
  const cached = (shop_parse_configs && shop_parse_configs[shopId]) || {};
  const xpaths = Array.isArray(xpathsOrConfig)
    ? xpathsOrConfig
    : cached.price_xpaths || [];
  return {
    ...cached,
    price_xpaths: xpaths.length ? xpaths : cached.price_xpaths || [],
  };
}

async function injectJobOverlay(tabId, mode) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (m) => {
      self.PM_JOB_OVERLAY_MODE = m;
    },
    args: [mode],
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["job_overlay.js"],
  });
}

async function parseViaBackgroundTab(url, shopId, xpathsOrConfig) {
  if (shopId === "ozon" && typeof PMShopUrl !== "undefined") {
    const preErr = PMShopUrl.ozonUrlError(url);
    if (preErr) {
      console.warn("[PriceMonitor] ozon URL rejected before open:", url, preErr);
      throw new Error(preErr);
    }
  }

  const parseConfig = await resolveParseConfig(shopId, xpathsOrConfig);
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForTabComplete(tab.id);
    const tabInfo = await chrome.tabs.get(tab.id);
    let pageMeta = {};
    try {
      const metaRes = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({
          title: document.title || "",
          finalUrl: location.href,
          h1: document.querySelector("h1")?.innerText?.slice(0, 200) || "",
          bodyLen: document.body?.innerText?.length || 0,
          bodySample: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 220),
        }),
      });
      pageMeta = metaRes?.[0]?.result || {};
    } catch (_) {
      /* page may block script on some origins */
    }
    let finalUrl = pageMeta.finalUrl || tabInfo.url || url;
    if ((pageMeta.bodyLen || 0) < TAB_SPARSE_BODY_THRESHOLD) {
      await sleep(TAB_SPARSE_BODY_RETRY_MS);
      try {
        const metaRes2 = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => ({
            title: document.title || "",
            finalUrl: location.href,
            h1: document.querySelector("h1")?.innerText?.slice(0, 200) || "",
            bodyLen: document.body?.innerText?.length || 0,
            bodySample: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 220),
          }),
        });
        pageMeta = { ...pageMeta, ...(metaRes2?.[0]?.result || {}) };
        finalUrl = pageMeta.finalUrl || finalUrl;
      } catch (_) {
        /* keep first meta */
      }
    }
    console.log("[PriceMonitor] parse tab trace:", {
      requested_url: url,
      final_url: finalUrl,
      title: pageMeta.title || "",
      h1: pageMeta.h1 || "",
      body_len: pageMeta.bodyLen || 0,
      shop_id: shopId,
      parse_cfg_version: parseConfig.version || null,
    });
    const antibotHint = `${pageMeta.title || ""} ${pageMeta.h1 || ""} ${pageMeta.bodySample || ""}`.toLowerCase();
    const listingClosed =
      /не\s*посмотреть|объявление закрыто|объявление снято|снят с публикации|объявление недоступ/i.test(
        antibotHint
      );
    const captchaUi =
      /captcha|smartcaptcha|antibot|я не робот|доступ ограничен|почти готово|что-то не так|access denied|challenge|cloudflare|qrator/i.test(
        antibotHint
      );
    const pageEmpty = (pageMeta.bodyLen || 0) < 200;
    if (listingClosed) {
      // Успешный исход для репорта (не parse_error) — объявление снято
      return {
        price: 0,
        in_stock: false,
        out_of_stock: true,
        listing_closed: true,
        parse_status: "listing_closed",
        ean: null,
        title: pageMeta.h1 || pageMeta.title || null,
        used_xpath: null,
      };
    }
    if (captchaUi && (pageMeta.bodyLen || 0) < 2500) {
      throw new Error(
        `antibot: магазин показал защиту/капчу (title="${(pageMeta.title || "").slice(0, 80)}")`
      );
    }
    if (pageEmpty) {
      throw new Error(
        `page_not_ready: страница ещё пустая после ожидания (bodyLen=${pageMeta.bodyLen || 0})`
      );
    }
    if (shopId === "ozon" && typeof PMShopUrl !== "undefined") {
      const redirectErr = PMShopUrl.ozonUrlError(finalUrl);
      if (redirectErr) {
        console.warn("[PriceMonitor] ozon redirected to search:", {
          requested_url: url,
          final_url: finalUrl,
        });
        return {
          price: 0,
          in_stock: false,
          out_of_stock: true,
          listing_closed: true,
          parse_status: "listing_closed",
          ean: null,
          title: null,
          used_xpath: null,
        };
      }
    }
    await injectJobOverlay(tab.id, "monitor");
    await new Promise((r) => setTimeout(r, 800));
    return await injectAndParse(tab.id, shopId, parseConfig);
  } finally {
    try {
      await chrome.tabs.remove(tab.id);
    } catch (_) {
      /* tab may already be closed */
    }
  }
}

async function releaseTask(taskId, reason) {
  const res = await apiFetch("/tasks/release", {
    method: "POST",
    body: JSON.stringify({ task_id: taskId, reason: reason || "released" }),
  });
  return res.ok;
}

async function releaseLeftoverJobs(jobs, reason) {
  for (const job of jobs) {
    if (!job?.task_id) continue;
    try {
      await releaseTask(job.task_id, reason);
    } catch (_) {
      /* best-effort */
    }
  }
}

function shouldReportPrice(taskId, parsedPrice, lastKnownPrice) {
  if (parsedPrice <= 0) return true;
  if (lastKnownPrice == null || lastKnownPrice <= 0) {
    getPriceStabilizer(taskId).reset();
    return true;
  }
  const stabilizer = getPriceStabilizer(taskId);
  return stabilizer.shouldReport(parsedPrice, lastKnownPrice);
}

async function runIntegrityPing() {
  const { session_token, can_earn, earn_integrity_key } = await chrome.storage.local.get([
    "session_token",
    "can_earn",
    "earn_integrity_key",
  ]);
  if (!session_token || !can_earn || !earn_integrity_key) {
    return { skipped: "no_earn_integrity" };
  }
  try {
    const chRes = await apiFetch("/exchange/earn/integrity/challenge");
    if (!chRes.ok) {
      return { skipped: `challenge_${chRes.status}` };
    }
    const data = await chRes.json();
    const challenge = data.challenge;
    if (!challenge?.challenge_id) {
      return { skipped: "no_challenge" };
    }
    const pong = await self.PMIntegrity.buildPong(challenge, earn_integrity_key);
    const pongRes = await apiFetch("/exchange/earn/integrity/pong", {
      method: "POST",
      body: JSON.stringify(pong),
    });
    if (!pongRes.ok) {
      const err = await pongRes.json().catch(() => ({}));
      console.warn("[PriceMonitor] integrity pong rejected:", err.detail || pongRes.status);
      return { ok: false, error: err.detail || `pong ${pongRes.status}` };
    }
    return { ok: true };
  } catch (err) {
    console.warn("[PriceMonitor] integrity ping:", err.message);
    return { error: err.message };
  }
}

async function syncEarnPrefsFromServer() {
  try {
    const res = await apiFetch("/exchange/commander/status");
    if (!res.ok) return null;
    const st = await res.json();
    const prefs = st.preferences || {};
    const patch = {};
    if (Array.isArray(prefs.categories)) {
      patch.earn_allowed_categories = prefs.categories;
    }
    const mode = prefs.earn_run_mode;
    if (mode === "always" || mode === "idle") {
      patch.earn_run_mode = mode;
    }
    if (prefs.stealth && typeof prefs.stealth === "object") {
      patch.earn_user_stealth = prefs.stealth;
    }
    if (typeof prefs.max_daily === "number" && prefs.max_daily > 0) {
      patch.earn_max_daily = prefs.max_daily;
    }
    if (st.stealth_limits) {
      patch.earn_stealth_limits = st.stealth_limits;
    }
    if (Object.keys(patch).length) {
      await chrome.storage.local.set(patch);
    }
    return patch;
  } catch (err) {
    console.warn("[PriceMonitor] sync earn prefs:", err.message);
  }
  return null;
}

/** @deprecated use syncEarnPrefsFromServer */
async function syncEarnCategoriesFromServer() {
  const p = await syncEarnPrefsFromServer();
  return p?.earn_allowed_categories || null;
}

async function syncUserStatus() {
  try {
    const res = await apiFetch("/user/status");
    if (!res.ok) return null;
    const status = await res.json();
    const patch = {
      is_worker_mode: status.is_worker_mode,
      can_add_tasks: status.can_add_tasks,
      can_work: status.can_work,
      can_earn: Boolean(status.can_earn),
      can_use_widget: Boolean(status.can_use_widget),
      can_use_referrals: Boolean(status.can_use_referrals),
      tracker_mode: status.tracker_mode || "worker",
      exchange_public_enabled: Boolean(status.exchange_public_enabled),
      user_tier: status.user_tier || "subscriber",
      earn_balance_cents: status.earn_balance_cents || 0,
      reputation_points: status.reputation_points || 0,
      reputation_rank: status.reputation_rank || 0,
      tasks_frozen: Boolean(status.tasks_frozen),
      in_grace: Boolean(status.in_grace),
      worker_idle_minutes:
        status.worker_idle_minutes === 0 || status.worker_idle_minutes
          ? status.worker_idle_minutes
          : 5,
      user_status: status,
    };
    if (status.integrity_key) {
      patch.earn_integrity_key = status.integrity_key;
    }
    if (status.stealth_limits) {
      patch.earn_stealth_limits = status.stealth_limits;
    }
    if (status.earn_run_mode === "always" || status.earn_run_mode === "idle") {
      patch.earn_run_mode = status.earn_run_mode;
    }
    await chrome.storage.local.set(patch);
    if (status.can_earn) {
      await syncEarnCategoriesFromServer();
    }
    await pmPersistSession();
    return status;
  } catch (err) {
    console.warn("[PriceMonitor] sync status failed:", err.message);
    return null;
  }
}

async function fetchPublicMeta() {
  try {
    const url = await pmApiUrl("/meta/public");
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn("[PriceMonitor] meta/public failed:", err.message);
    return null;
  }
}

async function fetchSiteVersionJson() {
  try {
    const res = await fetch(VERSION_JSON_URL, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn("[PriceMonitor] version.json failed:", err.message);
    return null;
  }
}

async function resolveLatestVersion(sources) {
  let latest = null;
  for (const s of sources) {
    const v = s?.extension_latest_version || s?.version;
    if (!v) continue;
    if (!latest || pmCompareVersions(latest, v) < 0) latest = v;
  }
  return latest;
}

async function registerNativeHostOnce() {
  try {
    const resp = await chrome.runtime.sendNativeMessage(NATIVE_HOST, {
      action: "register",
      extension_id: chrome.runtime.id,
    });
    if (resp && resp.ok) {
      await chrome.storage.local.set({
        native_host_registered: chrome.runtime.id,
        native_update_available: true,
      });
      return true;
    }
  } catch (err) {
    console.log("[PriceMonitor] native register:", err.message);
    await chrome.storage.local.set({ native_update_available: false });
  }
  return false;
}

async function tryNativeAutoUpdate() {
  try {
    const resp = await chrome.runtime.sendNativeMessage(NATIVE_HOST, {
      action: "update",
      force: true,
      extension_id: chrome.runtime.id,
      extension_version: PM_EXTENSION.version,
    });
    await chrome.storage.local.set({ native_update_available: true });
    if (resp && resp.updated === true) return { ok: true, updated: true, detail: resp };
    if (
      resp &&
      resp.local &&
      resp.remote &&
      resp.local === resp.remote &&
      pmCompareVersions(PM_EXTENSION.version, resp.local) < 0
    ) {
      return { ok: true, updated: true, reloaded_only: true, detail: resp };
    }
    if (resp && resp.local && pmCompareVersions(PM_EXTENSION.version, resp.local) < 0) {
      return { ok: true, updated: true, reloaded_only: true, detail: resp };
    }
    return { ok: true, updated: false, detail: resp };
  } catch (err) {
    console.log("[PriceMonitor] native update:", err.message);
    await chrome.storage.local.set({ native_update_available: false });
    return { ok: false, updated: false, error: err.message };
  }
}

async function finishExtensionUpdate(latest, { silent = true } = {}) {
  await pmPersistSession();
  await chrome.storage.local.set({
    update_available: false,
    update_version: null,
    update_detected_at: null,
    native_update_available: true,
  });
  chrome.action.setBadgeText({ text: "" });
  if (!silent) {
    await notifyUpdate(`Обновление v${latest} установлено. Перезапускаем расширение…`);
  }
  console.log("[PriceMonitor] auto-update applied, reloading → v" + latest);
  chrome.runtime.reload();
}

async function pollNativeUpdateCycle({ force = false } = {}) {
  const { last_native_poll_at } = await chrome.storage.local.get(["last_native_poll_at"]);
  if (
    !force &&
    last_native_poll_at &&
    Date.now() - last_native_poll_at < NATIVE_POLL_COOLDOWN_MS
  ) {
    return;
  }

  await chrome.storage.local.set({ last_native_poll_at: Date.now() });
  await registerNativeHostOnce();

  try {
    const resp = await chrome.runtime.sendNativeMessage(NATIVE_HOST, {
      action: "poll",
      extension_version: PM_EXTENSION.version,
      extension_id: chrome.runtime.id,
      force: Boolean(force),
    });
    await chrome.storage.local.set({ native_update_available: true });

    if (resp?.reload_needed) {
      await finishExtensionUpdate(resp.disk_version || resp.to || resp.remote || "?");
      return;
    }
    if (resp?.updated && resp?.to) {
      await finishExtensionUpdate(resp.to);
    }
  } catch (err) {
    console.log("[PriceMonitor] native poll:", err.message);
    await chrome.storage.local.set({ native_update_available: false });
  }
}

async function applyNativeUpdateIfDue(latest, { force = false } = {}) {
  const { last_native_apply_at } = await chrome.storage.local.get(["last_native_apply_at"]);
  if (
    !force &&
    last_native_apply_at &&
    Date.now() - last_native_apply_at < UPDATE_APPLY_RETRY_MS
  ) {
    return { skipped: "cooldown" };
  }

  await chrome.storage.local.set({ last_native_apply_at: Date.now() });

  const result = await tryNativeAutoUpdate();
  if (result.updated) {
    await finishExtensionUpdate(latest);
    return { updated: true };
  }

  // Файлы уже на диске (scheduled task) — poll + reload.
  await pollNativeUpdateCycle({ force: true });

  if (!result.ok) {
    console.log("[PriceMonitor] native update pending, will retry:", result.error);
  }
  return result;
}

async function maybeAutoInstallPendingUpdate(latest, { force = false } = {}) {
  await registerNativeHostOnce();
  const { native_update_available } = await chrome.storage.local.get([
    "native_update_available",
  ]);

  if (native_update_available === false && !force) {
    // Не сдаёмся навсегда: пробуем poll (мог появиться allowlist после Sync).
    await pollNativeUpdateCycle({ force: true });
    const again = await chrome.storage.local.get(["native_update_available"]);
    if (again.native_update_available === false) {
      return { skipped: "no_native_host" };
    }
  }

  const { update_detected_at } = await chrome.storage.local.get(["update_detected_at"]);
  const detectedAt = update_detected_at || Date.now();
  const elapsed = Date.now() - detectedAt;
  if (!force && UPDATE_AUTO_INSTALL_DELAY_MS > 0 && elapsed < UPDATE_AUTO_INSTALL_DELAY_MS) {
    return {
      skipped: "waiting_user",
      auto_in_ms: UPDATE_AUTO_INSTALL_DELAY_MS - elapsed,
    };
  }

  console.log("[PriceMonitor] auto-install update v" + latest);
  return applyNativeUpdateIfDue(latest, { force: true });
}

async function notifyUpdate(message) {
  try {
    await chrome.notifications.create(`pm-update-${Date.now()}`, {
      type: "basic",
      title: "Price Monitor",
      message,
    });
  } catch (_) {
    /* notifications optional */
  }
}

async function applyExtensionUpdateHint(source) {
  const siteVer = await fetchSiteVersionJson();
  const latest = await resolveLatestVersion([source, siteVer]);
  if (!latest) return;

  const current = PM_EXTENSION.version;
  const downloadUrl =
    source?.extension_download_url ||
    (siteVer?.download_path
      ? `https://halyavka.online${siteVer.download_path}`
      : "https://halyavka.online/extension/price-monitor.zip");

  if (!pmUpdateAvailable(current, latest)) {
    await chrome.storage.local.set({ update_available: false, update_version: null });
    chrome.action.setBadgeText({ text: "" });
    return;
  }

  const prev = await chrome.storage.local.get(["update_detected_at", "update_version"]);
  const isNew = prev.update_version !== latest || !prev.update_detected_at;

  await chrome.storage.local.set({
    update_available: true,
    update_version: latest,
    update_download_url: downloadUrl,
    ...(isNew ? { update_detected_at: Date.now() } : {}),
  });

  if (isNew) {
    console.log("[PriceMonitor] update available:", latest, "→ auto-install now");
  }

  chrome.action.setBadgeText({ text: "" });

  await pollNativeUpdateCycle({ force: true });
  await maybeAutoInstallPendingUpdate(latest, { force: true });
}

async function retryPendingExtensionUpdate() {
  const { update_available, update_version } = await chrome.storage.local.get([
    "update_available",
    "update_version",
  ]);
  if (!update_available || !update_version) return;
  if (!pmUpdateAvailable(PM_EXTENSION.version, update_version)) {
    await chrome.storage.local.set({ update_available: false, update_version: null });
    chrome.action.setBadgeText({ text: "" });
    return;
  }
  await maybeAutoInstallPendingUpdate(update_version);
}

async function shouldCheckExtensionUpdate(force) {
  if (force) return true;
  const { last_update_check_at } = await chrome.storage.local.get(["last_update_check_at"]);
  if (!last_update_check_at) return true;
  return Date.now() - last_update_check_at >= UPDATE_CHECK_INTERVAL_MS;
}

async function checkExtensionUpdate(force = false) {
  if (!(await shouldCheckExtensionUpdate(force))) {
    await retryPendingExtensionUpdate();
    return null;
  }
  await chrome.storage.local.set({ last_update_check_at: Date.now() });
  await pmRestoreSession();
  const status = await syncUserStatus();
  if (status?.extension_latest_version) {
    await applyExtensionUpdateHint(status);
    return status;
  }
  const meta = await fetchPublicMeta();
  if (meta) await applyExtensionUpdateHint(meta);
  else {
    const siteVer = await fetchSiteVersionJson();
    if (siteVer) await applyExtensionUpdateHint(siteVer);
  }
  return meta;
}

async function startElementPicker(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["utils_price.js", "element_picker.js"],
  });
}

async function retryNativeHostRegistration() {
  const { native_update_available } = await chrome.storage.local.get(["native_update_available"]);
  if (native_update_available !== false) return;
  await registerNativeHostOnce();
  const again = await chrome.storage.local.get(["native_update_available"]);
  if (again.native_update_available !== false) {
    await retryPendingExtensionUpdate();
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await pmRestoreSession();
  await registerNativeHostOnce();
  const { native_update_available } = await chrome.storage.local.get(["native_update_available"]);
  if (native_update_available === false && details.reason === "install") {
    await notifyUpdate(
      `Расширение установлено. Для автообновлений запустите Установить.bat — ${EXTENSION_INSTALL_URL} (один раз).`,
    );
  }
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: HEARTBEAT_MINUTES });
  chrome.alarms.create(SOLO_ALARM, { periodInMinutes: 360 });
  chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: UPDATE_CHECK_MINUTES });
  syncShopParseConfigs({ force: true });
  pollNativeUpdateCycle();
  checkExtensionUpdate(true);
  console.log("[PriceMonitor] Service worker установлен");
});

chrome.runtime.onStartup.addListener(() => {
  pmRestoreSession();
  registerNativeHostOnce();
  syncShopParseConfigs({ force: true });
  pollNativeUpdateCycle();
  checkExtensionUpdate(false);
});

async function fetchShopParseConfig(shopId) {
  await syncShopParseConfigs();
  const { shop_parse_configs } = await chrome.storage.local.get(["shop_parse_configs"]);
  return (shop_parse_configs && shop_parse_configs[shopId]) || null;
}

async function fetchShopXpaths(shopId) {
  const cfg = await fetchShopParseConfig(shopId);
  return cfg?.price_xpaths || [];
}

async function runSoloChecks() {
  const { tracker_mode } = await chrome.storage.local.get(["tracker_mode"]);
  if (tracker_mode !== "solo") return;
  const tasks = await SoloTasks.list();
  for (const task of tasks) {
    const url = task.source_url;
    if (!url) continue;
    try {
      const cfg = await fetchShopParseConfig(task.shop_id);
      const parsed = await parseViaBackgroundTab(url, task.shop_id, cfg || []);
      const price = parsed?.price || 0;
      if (price <= 0) continue;
      await SoloTasks.update(task.id, { last_price: price });
      const hit =
        task.monitor_type === "in_stock"
          ? parsed.in_stock
          : task.target_price > 0 && price <= task.target_price;
      if (hit && (await popupNotifyAllowed())) {
        chrome.notifications.create(`solo-${task.id}-${Date.now()}`, {
          type: "basic",
          iconUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
          title: "Price Monitor (Соло)",
          message: `${task.title || task.product_id}: ${price} ₽`,
        });
      }
    } catch (err) {
      console.warn("[PriceMonitor] solo check failed:", task.id, err.message);
    }
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    runHeartbeat(false);
    runEarnBatch(false);
    retryNativeHostRegistration();
    pollNativeUpdateCycle();
    retryPendingExtensionUpdate();
    chrome.storage.local.get(["can_earn"]).then(({ can_earn }) => {
      if (can_earn) runIntegrityPing();
    });
  }
  if (alarm.name === SOLO_ALARM) runSoloChecks();
  if (alarm.name === UPDATE_ALARM) checkExtensionUpdate();
});

function randEarnPause(stealth) {
  const p = stealth?.pause_between_jobs_ms || [3000, 12000];
  const lo = Math.min(p[0], p[1]);
  const hi = Math.max(p[0], p[1]);
  return randBetween(lo, hi);
}

function randBetween(min, max) {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

/** Подключить PMScenarioRunner после навигации (скрипты сбрасываются при reload). */
async function injectScenarioScripts(tabId, stealthConfig = {}) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (cfg) => {
      self.PMStealthConfig = cfg || {};
    },
    args: [stealthConfig || {}],
  });
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["humanize.js", "scenario_runner.js"],
  });
}

async function runScenarioStepExec(tabId, step, params) {
  const [exec] = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (s, p) => {
      if (typeof PMScenarioRunner === "undefined") {
        throw new Error("PMScenarioRunner not loaded after navigation");
      }
      return PMScenarioRunner.runStep(s, p);
    },
    args: [step, params],
  });
  if (exec?.error) {
    throw new Error(exec.error.message || String(exec.error));
  }
  return exec?.result;
}

/** Выполнить сценарий: navigate в background, остальное в content script. */
async function runScenarioSteps(tabId, steps, params = {}, stealthConfig = {}) {
  await injectScenarioScripts(tabId, stealthConfig);

  const merged = {};
  for (const step of steps || []) {
    const action = step.action;
    if (action === "goto" || action === "navigate") {
      let url = step.url || "";
      for (const [k, v] of Object.entries(params)) {
        url = url.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), String(v));
      }
      if (url) {
        let needsNav = true;
        try {
          const tab = await chrome.tabs.get(tabId);
          needsNav = tab.url !== url;
        } catch (_) {
          needsNav = true;
        }
        if (needsNav) {
          await chrome.tabs.update(tabId, { url });
          await waitForTabComplete(tabId);
        } else {
          await sleep(TAB_SETTLE_AFTER_LOAD_MS);
        }
        await injectScenarioScripts(tabId, stealthConfig);
      }
      if (step.min_ms || step.dwell_min_ms) {
        await sleep(randBetween(step.min_ms || step.dwell_min_ms, step.max_ms || step.dwell_max_ms || 2000));
      }
      continue;
    }

    const result = await runScenarioStepExec(tabId, step, params);
    if (result && typeof result === "object") {
      Object.assign(merged, result);
    }
    if (action === "click") {
      await waitForTabComplete(tabId);
      await injectScenarioScripts(tabId, stealthConfig);
    }
  }
  return merged;
}

async function processOneEarnJob(job) {
  const started = Date.now();
  const steps = job.scenario?.steps || [];
  const firstNav = steps.find((s) => s.action === "goto" || s.action === "navigate");
  const url = firstNav?.url?.replace(/\{\{target_url\}\}/g, job.target_url || "") || job.target_url;
  if (!url) throw new Error("earn job missing url");

  if (
    self.PMCategoryHosts &&
    !self.PMCategoryHosts.isUrlAllowedForCategory(job.category, url)
  ) {
    throw new Error(
      `URL не разрешён для категории ${job.category} (ограничение безопасности)`,
    );
  }

  const params = {
    target_url: job.target_url,
    text: job.params?.text || "",
    base_url: job.params?.base_url || new URL(url).origin,
    ...(job.params || {}),
  };

  await chrome.storage.local.set({
    current_earn_job: {
      job_id: job.job_id,
      category: job.category,
      target_url: url,
      started_at: new Date().toISOString(),
    },
  });

  let tabId;
  try {
    const tab = await chrome.tabs.create({ url, active: false });
    tabId = tab.id;
    await waitForTabComplete(tabId);
    await injectJobOverlay(tabId, "earn");

    const payload = await runScenarioSteps(tabId, steps, params, {
      ...(job.stealth || {}),
      job_id: job.job_id,
      category: job.category,
    });
    await chrome.tabs.remove(tabId);
    tabId = null;

    const proof = { final_url: url, payload };
    const report_signature = await signJobReport(
      job.report_token,
      job.job_id,
      true,
      proof,
      payload,
    );
    const reportRes = await apiFetch("/exchange/earn/jobs/report", {
      method: "POST",
      body: JSON.stringify({
        job_id: job.job_id,
        ok: true,
        payload,
        proof,
        duration_ms: Date.now() - started,
        report_signature,
      }),
    });
    if (!reportRes.ok) {
      const err = await reportRes.json().catch(() => ({}));
      const detail = String(err.detail || `report ${reportRes.status}`);
      if (/job report rejected|invalid report signature/i.test(detail)) {
        await chrome.storage.local.remove("current_earn_job");
        return { ok: false, job_id: job.job_id, error: detail, rejected: true };
      }
      throw new Error(detail);
    }
    await chrome.storage.local.remove("current_earn_job");
    return { ok: true, job_id: job.job_id, payload, report: await reportRes.json() };
    } catch (err) {
    if (tabId) {
      try {
        await chrome.tabs.remove(tabId);
      } catch (_) {
        /* ignore */
      }
    }
    const errMsg = String(err.message || err);
    if (/job report rejected|invalid report signature/i.test(errMsg)) {
      await chrome.storage.local.remove("current_earn_job");
      return { ok: false, job_id: job.job_id, error: errMsg, rejected: true };
    }
    const failProof = { final_url: url, error: errMsg };
    const report_signature = await signJobReport(
      job.report_token,
      job.job_id,
      false,
      failProof,
      null,
    );
    await apiFetch("/exchange/earn/jobs/report", {
      method: "POST",
      body: JSON.stringify({
        job_id: job.job_id,
        ok: false,
        error_message: errMsg,
        proof: failProof,
        duration_ms: Date.now() - started,
        report_signature,
      }),
    }).catch(() => {});
    await chrome.storage.local.remove("current_earn_job");
    return { ok: false, job_id: job.job_id, error: errMsg };
  }
}

async function runEarnBatch(forceIdle) {
  if (earnBatchInFlight) {
    console.log("[PriceMonitor] Earn уже идёт — пропуск параллельного батча");
    return { skipped: "earn_busy" };
  }
  earnBatchInFlight = true;
  try {
    const { session_token, can_earn } = await chrome.storage.local.get([
      "session_token",
      "can_earn",
    ]);
    if (!session_token || !can_earn) {
      return { skipped: "earn_off" };
    }

    await runIntegrityPing();

    const { earn_run_mode } = await chrome.storage.local.get(["earn_run_mode"]);
    const runMode = earn_run_mode === "always" ? "always" : "idle";

    if (!forceIdle && runMode !== "always") {
      const idle = await isUserIdle();
      if (!idle) return { skipped: "not_idle" };
    }

    let { earn_allowed_categories } = await chrome.storage.local.get(["earn_allowed_categories"]);
    let allowed = Array.isArray(earn_allowed_categories) ? earn_allowed_categories : [];
    if (!allowed.length) {
      const synced = await syncEarnCategoriesFromServer();
      if (synced) allowed = synced;
    }
    if (!allowed.length) {
      console.log("[PriceMonitor] Earn: категории не выбраны — откройте popup или сохраните на сервере");
      return { skipped: "no_categories_selected" };
    }

    const jobRes = await apiFetch("/exchange/earn/jobs/next");
    if (!jobRes.ok) {
      return { error: `earn jobs ${jobRes.status}` };
    }
    const data = await jobRes.json();
    await chrome.storage.local.set({
      earn_stealth_limits: data.stealth_limits || null,
      earn_throttle: data.throttle || null,
    });
    if (!data.jobs?.length) {
      return { skipped: "no_earn_jobs", throttle: data.throttle || null, stealth_limits: data.stealth_limits || null };
    }

    console.log("[PriceMonitor] Earn пакет", data.package_id, "—", data.jobs.length, "job(s)");
    let lastStealth = {};
    const results = [];
    for (const job of data.jobs) {
      if (!allowed.includes(job.category)) {
        console.log("[PriceMonitor] Пропуск job", job.job_id, job.category, "— не в ваших категориях");
        results.push({
          skipped: true,
          job_id: job.job_id,
          category: job.category,
          reason: "category_not_allowed",
        });
        continue;
      }
      lastStealth = job.stealth || lastStealth;
      results.push(await processOneEarnJob(job));
      await new Promise((r) => setTimeout(r, randEarnPause(lastStealth)));
    }
    return { ok: results.some((r) => r.ok), package_id: data.package_id, results };
  } finally {
    earnBatchInFlight = false;
  }
}

/**
 * Live-compare: поиск → выбор карточки по скору → парсинг цены.
 * Прямой product URL (mock / кэш) — сразу парсим + проверяем title match.
 */
async function parseCompareViaBackgroundTab(job, parseConfig) {
  const sourceTitle = job.title || "";
  const shopId = job.shop_id;
  let url = job.url;
  const Match = typeof PMCompareMatch !== "undefined" ? PMCompareMatch : null;

  const resolvedConfig = await resolveParseConfig(shopId, parseConfig);
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForTabComplete(tab.id);
    await sleep(TAB_SETTLE_AFTER_LOAD_MS);

    let pickedProductId = job.product_id || "";
    let matchMeta = { score: 0, accept: true, reason: "direct" };

    const needSearch =
      Match &&
      (Match.isSearchUrl(url) || !Match.isProductUrl(url, shopId)) &&
      !String(shopId || "").startsWith("mock_");

    if (needSearch && sourceTitle) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["compare_match.js"],
      });
      const pickRes = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (srcTitle, sid) => {
          if (typeof PMCompareMatch === "undefined") return { best: null, count: 0 };
          return PMCompareMatch.pickBestFromSearchDocument(srcTitle, sid);
        },
        args: [sourceTitle, shopId],
      });
      const pick = pickRes?.[0]?.result || {};
      console.log("[PriceMonitor] compare pick:", {
        count: pick.count,
        best: pick.best,
        top: (pick.top || []).slice(0, 3),
      });
      if (!pick.best?.href) {
        throw new Error("compare_not_found: нет подходящей карточки в выдаче");
      }
      matchMeta = {
        score: pick.best.score,
        accept: pick.best.accept,
        reason: pick.best.reason,
      };
      await chrome.tabs.update(tab.id, { url: pick.best.href });
      await waitForTabComplete(tab.id);
      await sleep(TAB_SETTLE_AFTER_LOAD_MS);
      url = pick.best.href;
      pickedProductId =
        Match.extractProductIdFromUrl(url, shopId) || pickedProductId;
    }

    await injectJobOverlay(tab.id, "monitor");
    await sleep(800);
    const parsed = await injectAndParse(tab.id, shopId, resolvedConfig);
    const tabInfo = await chrome.tabs.get(tab.id);
    const finalUrl = tabInfo.url || url;
    if (!pickedProductId && Match) {
      pickedProductId = Match.extractProductIdFromUrl(finalUrl, shopId) || "";
    }

    const candTitle = parsed?.title || "";
    if (Match && sourceTitle && candTitle && !String(shopId || "").startsWith("mock_")) {
      matchMeta = Match.scoreCandidate(
        sourceTitle,
        candTitle,
        job.ean,
        parsed?.ean || null
      );
      if (!matchMeta.accept) {
        return {
          price: 0,
          ean: parsed?.ean || null,
          title: candTitle,
          product_id: pickedProductId,
          match: matchMeta,
          not_found: true,
          parse_status: "match_rejected",
        };
      }
    }

    return {
      price: parsed?.price ?? 0,
      ean: parsed?.ean || null,
      title: candTitle || sourceTitle,
      product_id: pickedProductId,
      match: matchMeta,
      not_found: false,
      parse_status: parsed?.parse_status || "ok",
      in_stock: parsed?.in_stock,
      out_of_stock: parsed?.out_of_stock,
    };
  } finally {
    try {
      await chrome.tabs.remove(tab.id);
    } catch (_) {
      /* tab may already be closed */
    }
  }
}

async function processOneJob(job) {
  const isCompare = job.kind === "compare_target";
  const parseConfig =
    job.parse_config && typeof job.parse_config === "object"
      ? job.parse_config
      : job.xpaths?.length > 0
        ? job.xpaths
        : job.xpath
          ? [job.xpath]
          : [];

  console.log(
    "[PriceMonitor] Задача",
    job.task_id,
    isCompare ? "(compare_live)" : "",
    job.url
  );

  if (!isCompare && shopSkippedThisSession(job.shop_id)) {
    const hrs = Math.round(SESSION_SHOP_SKIP_TTL_MS / 3600000);
    console.warn(
      "[PriceMonitor] session_shop_skip:",
      job.shop_id,
      `— не открываем вкладку, release на ${hrs}ч`
    );
    try {
      await releaseTask(job.task_id, "shop_session_cooldown");
    } catch (_) {
      /* best-effort */
    }
    return {
      ok: false,
      skipped: "shop_session_fail",
      task_id: job.task_id,
      shop_id: job.shop_id,
      parse_error: `session_shop_skip: ${job.shop_id}`,
      reported: false,
      released: true,
    };
  }

  let parsed;
  let parseError = null;
  try {
    if (isCompare) {
      parsed = await parseCompareViaBackgroundTab(job, parseConfig);
    } else {
      parsed = await parseViaBackgroundTab(job.url, job.shop_id, parseConfig);
    }
  } catch (parseErr) {
    console.error("[PriceMonitor] Ошибка парсинга:", parseErr.message);
    parseError = parseErr.message;
  }

  if (!isCompare) {
    await noteShopLoadOutcome(job.shop_id, parseError);
  }

  if (isCompare) {
    const parsedPrice = parsed?.price ?? 0;
    const foundEan = parsed?.ean || null;
    const Match = typeof PMCompareMatch !== "undefined" ? PMCompareMatch : null;
    const eanPlausible = Match ? Match.isPlausibleEan(job.ean) : Boolean(job.ean);
    const eanOk =
      !eanPlausible ||
      !foundEan ||
      !Match.isPlausibleEan(foundEan) ||
      String(foundEan) === String(job.ean);
    const matchRejected = Boolean(parsed?.not_found) || parsed?.parse_status === "match_rejected";
    const notFound =
      Boolean(parseError) ||
      matchRejected ||
      parsedPrice <= 0 ||
      !eanOk;
    const reportRes = await apiFetch("/tasks/report", {
      method: "POST",
      body: JSON.stringify({
        task_id: job.task_id,
        parsed_price: notFound ? 0 : parsedPrice,
        ean: eanPlausible ? job.ean : foundEan || undefined,
        title: parsed?.title || job.title || undefined,
        product_id: parsed?.product_id || job.product_id || undefined,
        kind: "compare_target",
        session_id: job.session_id || undefined,
        not_found: notFound,
        parse_error: parseError || (matchRejected ? "match_rejected" : undefined),
      }),
    });
    return {
      ok: reportRes.ok && !notFound,
      task_id: job.task_id,
      kind: "compare_target",
      parsed_price: notFound ? 0 : parsedPrice,
      ean: foundEan,
      match: parsed?.match,
      reported: reportRes.ok,
      not_found: notFound,
    };
  }

  if (parseError) {
    const reportRes = await apiFetch("/tasks/report", {
      method: "POST",
      body: JSON.stringify({
        task_id: job.task_id,
        parsed_price: 0,
        parse_error: parseError,
      }),
    });
    return {
      ok: false,
      task_id: job.task_id,
      parse_error: parseError,
      reported: reportRes.ok,
    };
  }

  const parsedPrice = parsed.price ?? 0;
  const parseStatus = parsed.parse_status || (parsed.listing_closed ? "listing_closed" : "ok");

  const reportRes = await apiFetch("/tasks/report", {
    method: "POST",
    body: JSON.stringify({
      task_id: job.task_id,
      parsed_price: parsedPrice,
      ean: parsed.ean || undefined,
      title: parsed.title || undefined,
      in_stock: parsed.in_stock,
      parse_status: parseStatus,
    }),
  });

  if (!reportRes.ok) {
    console.warn("[PriceMonitor] report ошибка:", reportRes.status);
    return { error: `report ${reportRes.status}`, task_id: job.task_id };
  }

  const report = await reportRes.json();
  console.log("[PriceMonitor] Отчёт:", report);
  return {
    ok: true,
    task_id: job.task_id,
    parsed_price: parsedPrice,
    notified: report.notified,
    ean: parsed.ean,
    parse_error: parseError,
    job_url: job.url,
    job_xpath: job.xpath,
  };
}

async function runHeartbeat(forceIdle) {
  if (heartbeatInFlight) {
    console.log("[PriceMonitor] Heartbeat уже идёт — пропуск параллельного drain");
    return { skipped: "heartbeat_busy" };
  }
  heartbeatInFlight = true;
  try {
    const { session_token, is_worker_mode } = await chrome.storage.local.get([
      "session_token",
      "is_worker_mode",
    ]);

    if (!session_token) {
      console.log("[PriceMonitor] Нет сессии — пропуск heartbeat");
      return { skipped: "no_session" };
    }

    await syncUserStatus();
    await syncShopParseConfigs();
    const stored = await chrome.storage.local.get(["is_worker_mode"]);
    if (!stored.is_worker_mode) {
      console.log("[PriceMonitor] Режим воркера выключен — пропуск");
      return { skipped: "worker_off" };
    }

    try {
      await apiFetch("/user/worker_ping", { method: "POST" });
    } catch (e) {
      console.warn("[PriceMonitor] worker_ping:", e);
    }

    if (!forceIdle) {
      const idle = await isUserIdle();
      if (!idle) {
        console.log("[PriceMonitor] Пользователь активен — ждём idle");
        return { skipped: "not_idle" };
      }
    }

    try {
      const allResults = [];
      let packages = 0;
      let processed = 0;
      await loadShopFailState();

      while (processed < WORKER_SESSION_MAX_JOBS) {
        if (!forceIdle) {
          const stillIdle = await isUserIdle();
          if (!stillIdle) {
            console.log("[PriceMonitor] Пользователь вернулся — стоп сессии");
            break;
          }
        }

        const jobRes = await apiFetch("/tasks/get_job");
        if (!jobRes.ok) {
          console.warn("[PriceMonitor] get_job ошибка:", jobRes.status);
          return { error: `get_job ${jobRes.status}`, processed, packages, results: allResults };
        }

        const job = await jobRes.json();
        const jobs =
          job.jobs?.length > 0
            ? job.jobs
            : job.task_id && job.url
              ? [job]
              : [];

        if (!jobs.length) {
          if (packages === 0) {
            console.log("[PriceMonitor] Нет задач в очереди");
            return { skipped: "no_jobs" };
          }
          console.log("[PriceMonitor] Очередь пуста — сессия завершена");
          break;
        }

        packages += 1;
        console.log(
          "[PriceMonitor] Пакет",
          job.package_id || "legacy",
          "—",
          jobs.length,
          "товар(ов); сессия",
          processed,
          "/",
          WORKER_SESSION_MAX_JOBS
        );

        const packageResults = [];
        for (let i = 0; i < jobs.length; i++) {
          const item = jobs[i];
          if (processed >= WORKER_SESSION_MAX_JOBS) {
            await releaseLeftoverJobs(jobs.slice(i), "session_limit");
            break;
          }
          if (!forceIdle) {
            const stillIdle = await isUserIdle();
            if (!stillIdle) {
              await releaseLeftoverJobs(jobs.slice(i), "worker_interrupted");
              break;
            }
          }
          // Магазин на паузе — отпустить весь хвост этого шопа без вкладок.
          if (item.kind !== "compare_target" && shopSkippedThisSession(item.shop_id)) {
            const batch = [];
            let j = i;
            while (j < jobs.length && jobs[j].shop_id === item.shop_id) {
              batch.push(jobs[j]);
              j += 1;
            }
            await releaseLeftoverJobs(batch, "shop_session_cooldown");
            for (const sj of batch) {
              const r = {
                ok: false,
                skipped: "shop_session_fail",
                task_id: sj.task_id,
                shop_id: sj.shop_id,
                released: true,
              };
              packageResults.push(r);
              allResults.push(r);
              processed += 1;
            }
            i = j - 1;
            continue;
          }
          const one = await processOneJob(item);
          packageResults.push(one);
          allResults.push(one);
          processed += 1;
          const pause =
            WORKER_JOB_PAUSE_MIN_MS +
            Math.floor(
              Math.random() * (WORKER_JOB_PAUSE_MAX_MS - WORKER_JOB_PAUSE_MIN_MS + 1)
            );
          await sleep(pause);
        }

        const onlySkips =
          packageResults.length > 0 &&
          packageResults.every((r) => r?.skipped === "shop_session_fail");
        if (onlySkips) {
          console.log(
            "[PriceMonitor] Пакет только из магазинов на паузе — стоп drain"
          );
          break;
        }
      }

      const last = allResults[allResults.length - 1] || {};
      return {
        ok: allResults.some((r) => r.ok),
        packages,
        processed: allResults.length,
        results: allResults,
        ...last,
      };
    } catch (err) {
      console.error("[PriceMonitor] Heartbeat failed:", err);
      return { error: err.message };
    }
  } finally {
    heartbeatInFlight = false;
  }
}

async function runEarnHeartbeatForced() {
  return runEarnBatch(true);
}
self.runEarnHeartbeatForced = runEarnHeartbeatForced;

/** E2E: вызов из Playwright без ожидания idle */
async function runHeartbeatForced() {
  return runHeartbeat(true);
}
self.runHeartbeatForced = runHeartbeatForced;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "RUN_HEARTBEAT") {
    runHeartbeat(Boolean(message.force)).then(sendResponse);
    return true;
  }

  if (message.type === "RUN_EARN_HEARTBEAT") {
    runEarnBatch(Boolean(message.force)).then(sendResponse);
    return true;
  }

  if (message.type === "PM_WATCH_HEARTBEAT") {
    (async () => {
      try {
        const jobId = message.job_id;
        if (jobId) {
          await apiFetch(`/exchange/earn/jobs/${jobId}/watch-heartbeat`, {
            method: "POST",
            body: JSON.stringify({
              elapsed_ms: message.elapsed_ms || 0,
              url: message.url || "",
            }),
          });
        }
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: String(err.message || err) });
      }
    })();
    return true;
  }

  if (message.type === "COMPARE_LOOKUP") {
    (async () => {
      try {
        const url = await pmApiUrl("/compare/lookup");
        const res = await authFetch(url, {
          method: "POST",
          body: JSON.stringify(message.payload),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          sendResponse({ error: err.detail?.message || err.detail || `HTTP ${res.status}` });
          return;
        }
        sendResponse(await res.json());
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  if (message.type === "COMPARE_LIVE") {
    (async () => {
      try {
        const url = await pmApiUrl("/compare/live");
        const res = await authFetch(url, {
          method: "POST",
          body: JSON.stringify(message.payload),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          sendResponse({ error: err.detail?.message || err.detail || `HTTP ${res.status}` });
          return;
        }
        sendResponse(await res.json());
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  if (message.type === "COMPARE_SESSION_POLL") {
    (async () => {
      try {
        const sid = message.session_id || message.payload?.session_id;
        const url = await pmApiUrl(`/compare/sessions/${sid}`);
        const res = await authFetch(url);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          sendResponse({ error: err.detail?.message || err.detail || `HTTP ${res.status}` });
          return;
        }
        sendResponse(await res.json());
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  if (message.type === "ROUTE_COMPARE_LOOKUP") {
    (async () => {
      try {
        const url = await pmApiUrl("/compare/route-lookup");
        const res = await authFetch(url, {
          method: "POST",
          body: JSON.stringify(message.payload),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          sendResponse({ error: err.detail?.message || err.detail || `HTTP ${res.status}` });
          return;
        }
        sendResponse(await res.json());
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  if (message.type === "REFERRAL_URL") {
    (async () => {
      try {
        const q = new URLSearchParams({
          shop_id: message.shop_id,
          product_id: message.product_id || "/",
        });
        const url = await pmApiUrl(`/meta/referral-url?${q}`);
        const res = await authFetch(url);
        if (!res.ok) {
          sendResponse({ error: `HTTP ${res.status}` });
          return;
        }
        sendResponse(await res.json());
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  if (message.type === "SOLO_SCHEDULE_CHECK") {
    runSoloChecks().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.type === "GET_SESSION_FOR_EARN_PAGE") {
    chrome.storage.local.get(["session_token"]).then(({ session_token }) => {
      sendResponse({ session_token: session_token || null });
    });
    return true;
  }

  if (message.type === "START_PICKER") {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) throw new Error("Нет активной вкладки");
        await startElementPicker(tab.id);
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
    return true;
  }

  if (message.type === "PICKER_RESULT") {
    chrome.storage.local.set({
      picked_xpath: message.xpath,
      picked_preview: message.preview,
      picked_price: message.parsed_price,
    });
    return false;
  }

  if (message.type === "PICKER_CANCELLED") {
    return false;
  }

  if (message.type === "CHECK_EXTENSION_UPDATE") {
    checkExtensionUpdate(Boolean(message.force)).then((meta) => sendResponse({ ok: true, meta }));
    return true;
  }

  if (message.type === "POLL_NATIVE_UPDATE") {
    pollNativeUpdateCycle({ force: Boolean(message.force) }).then(() =>
      sendResponse({ ok: true }),
    );
    return true;
  }

  if (message.type === "APPLY_EXTENSION_UPDATE") {
    (async () => {
      const siteVer = await fetchSiteVersionJson();
      const meta = await fetchPublicMeta();
      const latest = await resolveLatestVersion([meta, siteVer]);
      if (!latest || !pmUpdateAvailable(PM_EXTENSION.version, latest)) {
        sendResponse({ ok: true, updated: false, reason: "already_latest" });
        return;
      }
      await chrome.storage.local.set({
        update_available: true,
        update_version: latest,
        update_download_url: siteVer?.download_path
          ? `https://halyavka.online${siteVer.download_path}`
          : "https://halyavka.online/extension/price-monitor.zip",
        update_detected_at: Date.now(),
      });
      await registerNativeHostOnce();
      const result = await applyNativeUpdateIfDue(latest, { force: true });
      sendResponse({ ok: true, ...result });
    })();
    return true;
  }

  if (message.type === "OPEN_AUTO_UPDATE_SETUP") {
    chrome.tabs.create({ url: AUTO_UPDATE_SETUP_URL, active: true }).then(() => sendResponse({ ok: true }));
    return true;
  }
});
