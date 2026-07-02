importScripts("utils_price.js", "api_config.js", "constants.js", "session_store.js", "canonical_json.js", "integrity.js", "category_hosts.js", "shop_url_guard.js");

const ALARM_NAME = "price-monitor-heartbeat";
const UPDATE_ALARM = "price-monitor-update-check";
const HEARTBEAT_MINUTES = 2;
const UPDATE_CHECK_MINUTES = 2;
const UPDATE_CHECK_INTERVAL_MS = UPDATE_CHECK_MINUTES * 60 * 1000;
const UPDATE_AUTO_INSTALL_DELAY_MS = 30 * 1000;
const UPDATE_APPLY_RETRY_MS = 90 * 1000;
const NATIVE_POLL_COOLDOWN_MS = 90 * 1000;
const NATIVE_HOST = "com.halyavka.pricemonitor";
const VERSION_JSON_URL = "https://halyavka.online/extension/version.json";
const EXTENSION_INSTALL_URL = "https://halyavka.online/extension/";
const IDLE_THRESHOLD_SEC = 300;
const TAB_LOAD_TIMEOUT_MS = 50000;
const TAB_SETTLE_AFTER_LOAD_MS = 1200;

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

function isUserIdle() {
  return new Promise((resolve) => {
    chrome.idle.queryState(IDLE_THRESHOLD_SEC, (state) => {
      resolve(state === "idle" || state === "locked");
    });
  });
}

function waitForTabComplete(tabId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Таймаут загрузки вкладки"));
    }, TAB_LOAD_TIMEOUT_MS);

    function listener(updatedId, info) {
      if (updatedId === tabId && info.status === "complete") {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, TAB_SETTLE_AFTER_LOAD_MS);
      }
    }

    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (tab.status === "complete") {
        clearTimeout(timeout);
        setTimeout(resolve, TAB_SETTLE_AFTER_LOAD_MS);
        return;
      }
      chrome.tabs.onUpdated.addListener(listener);
    });
  });
}

function injectAndParse(tabId, shopId, xpaths) {
  const xpathList = Array.isArray(xpaths) ? xpaths : [xpaths];
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Таймаут парсинга"));
    }, 20000);

    chrome.scripting.executeScript(
      { target: { tabId }, files: ["shop_parse_page.js"] },
      () => {
        if (chrome.runtime.lastError) {
          clearTimeout(timeout);
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        chrome.scripting.executeScript(
          {
            target: { tabId },
            func: (sid, xpathArgs) => window.PM_parseShopPage(sid, xpathArgs),
            args: [shopId || null, xpathList],
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
              ean: r.ean || null,
              title: r.title || null,
              used_xpath: r.used_xpath || null,
            });
          }
        );
      }
    );
  });
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

async function parseViaBackgroundTab(url, shopId, xpaths) {
  if (shopId === "ozon" && typeof PMShopUrl !== "undefined") {
    const preErr = PMShopUrl.ozonUrlError(url);
    if (preErr) {
      console.warn("[PriceMonitor] ozon URL rejected before open:", url, preErr);
      throw new Error(preErr);
    }
  }

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
        }),
      });
      pageMeta = metaRes?.[0]?.result || {};
    } catch (_) {
      /* page may block script on some origins */
    }
    const finalUrl = pageMeta.finalUrl || tabInfo.url || url;
    console.log("[PriceMonitor] parse tab trace:", {
      requested_url: url,
      final_url: finalUrl,
      title: pageMeta.title || "",
      h1: pageMeta.h1 || "",
      body_len: pageMeta.bodyLen || 0,
      shop_id: shopId,
    });
    if (shopId === "ozon" && typeof PMShopUrl !== "undefined") {
      const redirectErr = PMShopUrl.ozonUrlError(finalUrl);
      if (redirectErr) {
        console.warn("[PriceMonitor] ozon redirected to search:", {
          requested_url: url,
          final_url: finalUrl,
        });
        throw new Error(redirectErr);
      }
    }
    await injectJobOverlay(tab.id, "monitor");
    await new Promise((r) => setTimeout(r, 800));
    return await injectAndParse(tab.id, shopId, xpaths);
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
      user_tier: status.user_tier || "subscriber",
      earn_balance_cents: status.earn_balance_cents || 0,
      reputation_points: status.reputation_points || 0,
      reputation_rank: status.reputation_rank || 0,
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
    const resp = await chrome.runtime.sendNativeMessage(NATIVE_HOST, { action: "update" });
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
  if (force) {
    await notifyUpdate(`Обновляем до v${latest}… Подождите несколько секунд.`);
  }

  const result = await tryNativeAutoUpdate();
  if (result.updated) {
    await finishExtensionUpdate(latest);
    return { updated: true };
  }

  if (!result.ok) {
    console.log("[PriceMonitor] native update pending, will retry:", result.error);
  }
  return result;
}

async function maybeAutoInstallPendingUpdate(latest, { force = false } = {}) {
  const { update_detected_at, native_update_available } = await chrome.storage.local.get([
    "update_detected_at",
    "native_update_available",
  ]);

  if (native_update_available === false && !force) {
    await registerNativeHostOnce();
    const again = await chrome.storage.local.get(["native_update_available"]);
    if (again.native_update_available === false) {
      return { skipped: "no_native_host" };
    }
  }

  const detectedAt = update_detected_at || Date.now();
  const elapsed = Date.now() - detectedAt;
  if (!force && elapsed < UPDATE_AUTO_INSTALL_DELAY_MS) {
    return {
      skipped: "waiting_user",
      auto_in_ms: UPDATE_AUTO_INSTALL_DELAY_MS - elapsed,
    };
  }

  if (!force) {
    console.log("[PriceMonitor] auto-install pending update v" + latest);
  }

  return applyNativeUpdateIfDue(latest, { force });
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
    console.log("[PriceMonitor] update available:", latest, "→ auto-install scheduled");
  }

  chrome.action.setBadgeText({ text: "" });

  await maybeAutoInstallPendingUpdate(latest);
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
  chrome.alarms.create(UPDATE_ALARM, { periodInMinutes: UPDATE_CHECK_MINUTES });
  pollNativeUpdateCycle();
  checkExtensionUpdate(true);
  console.log("[PriceMonitor] Service worker установлен");
});

chrome.runtime.onStartup.addListener(() => {
  pmRestoreSession();
  registerNativeHostOnce();
  pollNativeUpdateCycle();
  checkExtensionUpdate(false);
});

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
}

async function processOneJob(job) {
  const xpaths =
    job.xpaths?.length > 0 ? job.xpaths : job.xpath ? [job.xpath] : [];

  console.log("[PriceMonitor] Задача", job.task_id, job.url);

  let parsed;
  let parseError = null;
  try {
    parsed = await parseViaBackgroundTab(job.url, job.shop_id, xpaths);
  } catch (parseErr) {
    console.error("[PriceMonitor] Ошибка парсинга:", parseErr.message);
    parseError = parseErr.message;
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

  if (parsedPrice <= 0 && !parsed.in_stock && parsed.in_stock !== false) {
    // out_of_stock=false with price 0 — всё равно отчитываемся
  }

  if (!shouldReportPrice(job.task_id, parsedPrice, job.last_price)) {
    console.log(
      "[PriceMonitor] Цена нестабильна, пропуск report:",
      parsedPrice,
      "last:",
      job.last_price
    );
    await releaseTask(job.task_id, "unstable_price");
    return { skipped: "unstable_price", task_id: job.task_id, price: parsedPrice };
  }

  getPriceStabilizer(job.task_id).reset();

  const reportRes = await apiFetch("/tasks/report", {
    method: "POST",
    body: JSON.stringify({
      task_id: job.task_id,
      parsed_price: parsedPrice,
      ean: parsed.ean || undefined,
      title: parsed.title || undefined,
      in_stock: parsed.in_stock,
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
  const { session_token, is_worker_mode } = await chrome.storage.local.get([
    "session_token",
    "is_worker_mode",
  ]);

  if (!session_token) {
    console.log("[PriceMonitor] Нет сессии — пропуск heartbeat");
    return { skipped: "no_session" };
  }

  await syncUserStatus();
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
    const jobRes = await apiFetch("/tasks/get_job");
    if (!jobRes.ok) {
      console.warn("[PriceMonitor] get_job ошибка:", jobRes.status);
      return { error: `get_job ${jobRes.status}` };
    }

    const job = await jobRes.json();
    const jobs =
      job.jobs?.length > 0
        ? job.jobs
        : job.task_id && job.url
          ? [job]
          : [];

    if (!jobs.length) {
      console.log("[PriceMonitor] Нет задач в очереди");
      return { skipped: "no_jobs" };
    }

    console.log(
      "[PriceMonitor] Пакет",
      job.package_id || "legacy",
      "—",
      jobs.length,
      "товар(ов)"
    );

    const results = [];
    for (const item of jobs) {
      results.push(await processOneJob(item));
    }

    const last = results[results.length - 1];
    return {
      ok: results.some((r) => r.ok),
      package_id: job.package_id,
      processed: results.length,
      results,
      ...last,
    };
  } catch (err) {
    console.error("[PriceMonitor] Heartbeat failed:", err);
    return { error: err.message };
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
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(message.payload),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          sendResponse({ error: err.detail || `HTTP ${res.status}` });
          return;
        }
        sendResponse(await res.json());
      } catch (err) {
        sendResponse({ error: err.message });
      }
    })();
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
});
