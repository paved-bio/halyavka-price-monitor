async function authFetch(url, options = {}) {
  const { session_token } = await chrome.storage.local.get(["session_token"]);
  if (!session_token) throw new Error("Сначала подключите аккаунт");
  const headers = {
    ...(options.headers || {}),
    Authorization: `Bearer ${session_token}`,
  };
  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  return fetch(url, { ...options, headers });
}

async function publicFetch(path, options = {}) {
  const url = await pmApiUrl(path);
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  return fetch(url, { ...options, headers });
}

async function apiFetch(path, options = {}) {
  const url = await pmApiUrl(path);
  return authFetch(url, options);
}

const SHOP_PATTERNS = [
  {
    shop_id: "mock_ozon",
    regex: /127\.0\.0\.1:\d+\/ozon(\/product\/[^/?#]+)/i,
    product_id: (match) => match[1],
  },
  {
    shop_id: "mock_wb",
    regex: /127\.0\.0\.1:\d+\/wb(\/catalog\/\d+)/i,
    product_id: (match) => match[1],
  },
  {
    shop_id: "ozon",
    regex: /(?:https?:\/\/)?(?:www\.)?ozon\.ru(\/product\/(?:[^/?#]+-)?\d{5,}\/?)/i,
    product_id: (match) => match[1].replace(/\/$/, ""),
  },
  {
    shop_id: "wb",
    regex: /(?:https?:\/\/)?(?:www\.)?wildberries\.ru\/catalog\/(\d+)\/detail\.aspx/i,
    product_id: (match) => `/catalog/${match[1]}`,
  },
  {
    shop_id: "steam",
    regex: /(?:https?:\/\/)?(?:store\.)?steampowered\.com\/app\/(\d+)/i,
    product_id: (match) => `/app/${match[1]}`,
  },
  {
    shop_id: "avito",
    regex: /(?:https?:\/\/)?(?:www\.)?avito\.ru(\/[^?#]*?_\d+)(?:\?|#|$)/i,
    product_id: (match) => match[1],
  },
  {
    shop_id: "tutu",
    regex:
      /(?:https?:\/\/)?(?:www\.|avia\.)?tutu\.ru(\/(?:poezda|aviabilety|route|f)\/[^?#]+)/i,
    product_id: (match) => match[1],
  },
  {
    shop_id: "aviasales",
    regex: /(?:https?:\/\/)?(?:www\.)?aviasales\.ru(\/search\/[^?#]+)/i,
    product_id: (match) => match[1],
  },
  {
    shop_id: "yandex_market",
    regex: /(?:https?:\/\/)?(?:www\.)?market\.yandex\.ru(\/(?:card\/[^?#]+\/\d+|product--[^?#]+\/\d+))/i,
    product_id: (match) => match[1],
  },
  {
    shop_id: "dns",
    regex: /(?:https?:\/\/)?(?:www\.)?dns-shop\.ru(\/product\/[^?#]+)/i,
    product_id: (match) => match[1],
  },
  {
    shop_id: "goldapple",
    regex: /(?:https?:\/\/)?(?:www\.)?goldapple\.ru(\/\d{5,}[^?#]*)/i,
    product_id: (match) => match[1],
  },
  {
    shop_id: "citilink",
    regex: /(?:https?:\/\/)?(?:www\.)?citilink\.ru(\/product\/[^?#]+)/i,
    product_id: (match) => match[1],
  },
  {
    shop_id: "mvideo",
    regex: /(?:https?:\/\/)?(?:www\.)?mvideo\.ru(\/products\/[^?#]+)/i,
    product_id: (match) => match[1],
  },
  {
    shop_id: "detmir",
    regex: /(?:https?:\/\/)?(?:www\.)?detmir\.ru(\/product\/index\/id\/\d+)/i,
    product_id: (match) => match[1],
  },
  {
    shop_id: "leroymerlin",
    regex: /(?:https?:\/\/)?(?:www\.)?(?:lemanapro|leroymerlin)\.ru(\/product\/[^?#]+)/i,
    product_id: (match) => match[1],
  },
];

function shopLabel(shopId) {
  const hit = PM_EXTENSION.supportedShops.find((s) => s.id === shopId);
  return hit?.label || shopId;
}

const TUTU_ROUTE0_TOKEN = /^\d+-\d{8}-\d+$/;

function tutuProductIdWithRoute(url, productId) {
  const base = productId.replace(/\/$/, "");
  if (!base.startsWith("/f/")) return base;
  const last = base.split("/").pop();
  if (TUTU_ROUTE0_TOKEN.test(last)) return base;
  const m = url.match(/route\[0\]=([^&#]+)/i);
  if (!m) return base;
  const token = m[1].trim();
  return TUTU_ROUTE0_TOKEN.test(token) ? `${base}/${token}` : base;
}

function formatTutuProductLabel(product) {
  if (product.shop_id !== "tutu") return product.product_id;
  const m = product.product_id.match(/(\d+)-(\d{2})(\d{2})(\d{4})-(\d+)$/);
  if (!m) return product.product_id;
  const routePart = product.product_id.replace(/\/\d+-\d{8}-\d+$/, "");
  return `${routePart} · ${parseInt(m[2], 10)}.${m[3]}.${m[4]}`;
}

function parseProductFromUrl(url) {
  const clean = url.split("?")[0].split("#")[0].trim();
  if (/ozon\.ru\/search(?:\/|\?)/i.test(url)) {
    return null;
  }
  for (const shop of SHOP_PATTERNS) {
    const match = clean.match(shop.regex);
    if (match) {
      let product_id = shop.product_id(match);
      if (shop.shop_id === "ozon" && /\/product\/journey-/i.test(product_id)) {
        return null;
      }
      if (shop.shop_id === "tutu") {
        product_id = tutuProductIdWithRoute(url, product_id);
      }
      // avia.tutu.ru/f/… — дата рейса в query, сохраняем полный URL
      const source_url = /avia\.tutu\.ru\/f\//i.test(url)
        ? url.split("#")[0].trim()
        : clean;
      return { shop_id: shop.shop_id, product_id, source_url };
    }
  }
  return null;
}

function showStatus(el, text, type) {
  el.textContent = text;
  el.className = `status ${type}`;
  el.classList.remove("hidden");
}

async function getActiveTabUrl() {
  const tabs = await chrome.tabs.query({});
  const shopUrls = tabs
    .map((t) => t.url)
    .filter((url) => url && parseProductFromUrl(url));

  if (shopUrls.length === 0) return null;

  const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (active?.url && parseProductFromUrl(active.url)) {
    return active.url;
  }

  return shopUrls[0];
}

async function triggerWorkerHeartbeat(taskId = null) {
  const status = await fetchUserStatus();
  if (!status.is_worker_mode) {
    await setWorkerMode(true);
  }
  const hb = await chrome.runtime.sendMessage({ type: "RUN_HEARTBEAT", force: true });
  if (!hb || hb.skipped === "worker_off") {
    throw new Error("Включите режим воркера в настройках расширения");
  }
  if (hb.error) {
    throw new Error(hb.error);
  }
  if (taskId && hb.results?.length) {
    return hb.results.find((r) => r.task_id === taskId) || hb.results[0];
  }
  return hb;
}

function formatHeartbeatResult(hb, taskId) {
  if (!hb) return null;
  const hit =
    (taskId && hb.results?.find((r) => r.task_id === taskId)) ||
    hb.results?.find((r) => r.ok) ||
    hb;
  if (hit?.ok && hit.parsed_price > 0) {
    return `Проверено: ${formatPrice(hit.parsed_price)}`;
  }
  if (hit?.parse_error) return `Ошибка: ${hit.parse_error}`;
  if (hit?.error) return `Ошибка: ${hit.error}`;
  if (hb.skipped === "no_jobs") return "В очереди нет задач — повторите через минуту";
  return null;
}

async function fetchUserStatus() {
  const res = await apiFetch("/user/status");
  if (!res.ok) throw new Error(`Статус: ошибка ${res.status}`);
  const status = await res.json();
  await chrome.storage.local.set({
    is_worker_mode: status.is_worker_mode,
    can_add_tasks: status.can_add_tasks,
    can_use_widget: status.can_use_widget,
    can_use_referrals: status.can_use_referrals,
    tracker_mode: status.tracker_mode || "worker",
    exchange_public_enabled: status.exchange_public_enabled,
    user_status: status,
  });
  return status;
}

async function setTrackerMode(mode) {
  const res = await apiFetch("/user/tracker_mode", {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail?.message || err.detail || `Ошибка ${res.status}`);
  }
  const data = await res.json();
  if (mode !== "solo") {
    const solo = await SoloTasks.list();
    if (solo.length > 0 && confirm(`Перенести ${solo.length} локальных задач в облако?`)) {
      await migrateSoloTasksToCloud();
    }
  }
  await fetchUserStatus();
  return data;
}

async function migrateSoloTasksToCloud() {
  const tasks = await SoloTasks.list();
  for (const t of tasks) {
    try {
      await apiFetch("/tasks/add", {
        method: "POST",
        body: JSON.stringify({
          shop_id: t.shop_id,
          product_id: t.product_id,
          target_price: t.target_price,
          monitor_type: t.monitor_type,
          source_url: t.source_url,
        }),
      });
    } catch {
      /* skip failed */
    }
  }
  await SoloTasks.saveAll([]);
}

async function loadReferralUI() {
  const sec = document.getElementById("referral-section");
  if (!sec) return;
  try {
    const res = await apiFetch("/user/referral");
    if (!res.ok) return;
    const data = await res.json();
    sec.classList.remove("hidden");
    document.getElementById("referral-link-line").textContent = data.link;
    document.getElementById("referral-stats").textContent =
      `Приглашено: ${data.invited_count} · бонус Premium: ${data.premium_days_earned} дн.`;
    document.getElementById("referral-copy-btn").onclick = async () => {
      await navigator.clipboard.writeText(data.link);
    };
  } catch {
    sec.classList.add("hidden");
  }
}

function renderModeUI(status) {
  const modeSec = document.getElementById("mode-section");
  const soloBanner = document.getElementById("solo-pressure");
  const mode = status?.tracker_mode || "worker";
  const labels = { solo: "Соло (локально)", worker: "Воркер", premium: "Premium" };
  if (modeSec) {
    modeSec.classList.remove("hidden");
    document.getElementById("tracker-mode-label").textContent = labels[mode] || mode;
  }
  soloBanner?.classList.toggle("hidden", mode !== "solo");
}

function showOnboardingStep(n) {
  const overlay = document.getElementById("onboarding-overlay");
  if (!overlay) return;
  overlay.classList.remove("hidden");
  [1, 2, 3].forEach((i) => {
    document.getElementById(`onb-step-${i}`)?.classList.toggle("active", i === n);
  });
}

async function finishOnboarding({ localSolo = false } = {}) {
  const { session_token } = await chrome.storage.local.get(["session_token"]);
  if (localSolo || !session_token) {
    await chrome.storage.local.set({
      onboarding_complete: true,
      tracker_mode: "solo",
      is_solo: true,
      popup_notifications_enabled: true,
    });
  } else {
    // Не фиксируем worker/premium при старте — серверный триал и выбор режима позже.
    await chrome.storage.local.set({ onboarding_complete: true });
  }
  document.getElementById("onboarding-overlay")?.classList.add("hidden");
}

async function setWorkerMode(enabled) {
  const res = await apiFetch("/user/worker_mode", {
    method: "POST",
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Ошибка ${res.status}`);
  }
  return res.json();
}

async function startPremiumCheckout({ autorenew = false } = {}) {
  const res = await apiFetch("/user/premium/checkout", {
    method: "POST",
    body: JSON.stringify({
      autorenew,
      return_url: "https://halyavka.online/extension/",
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.detail;
    const msg =
      typeof detail === "string"
        ? detail
        : detail?.message || data.message || `Ошибка ${res.status}`;
    throw new Error(msg);
  }
  if (data.confirmation_url) {
    chrome.tabs.create({ url: data.confirmation_url });
    return data;
  }
  throw new Error(
    data.message ||
      "Покупка Premium закрыта. Включите Воркер бесплатно — Premium за достижения.",
  );
}


function formatPrice(n) {
  if (n == null || n <= 0) return "—";
  return `${Math.round(n).toLocaleString("ru-RU")} ₽`;
}

function formatTelegramId(tgId) {
  if (!tgId) return "—";
  const s = String(tgId);
  return `Telegram ID: ${s}`;
}

function renderTierPanels(status) {
  const exchangeOn = Boolean(status?.exchange_public_enabled);
  const isAdventurer = exchangeOn && Boolean(status?.can_earn);
  const connected = Boolean(status?.tg_id);

  document.getElementById("earn-section")?.classList.toggle("hidden", !isAdventurer);
  document.getElementById("adventurer-teaser")?.classList.toggle(
    "hidden",
    isAdventurer || !connected || !exchangeOn,
  );
  document.getElementById("transparency-earn-li")?.classList.toggle("hidden", !isAdventurer);
  document.getElementById("earn-page-link")?.classList.toggle("hidden", !isAdventurer);
}

function renderTasksLimit(status, taskCount) {
  const el = document.getElementById("tasks-limit-line");
  if (!el || !status?.can_add_tasks) {
    if (el) el.textContent = "";
    return;
  }
  const max = status.max_tasks_per_user || 100;
  const n = taskCount ?? status.monitored_tasks_count ?? 0;
  el.textContent = `Отслеживается: ${n} из ${max}`;
}

function formatMonitorLimitError(detail) {
  if (typeof detail !== "string") return `Ошибка: ${detail}`;
  if (/лимит/i.test(detail) && !/бирж/i.test(detail)) {
    return `${detail}\n\nДля сотен товаров — заказ на бирже: halyavka.online/cabinet/`;
  }
  return detail;
}

function renderAccountUI(status, elements) {
  const {
    accountSection, accountStatus, paywallSection, workerSection,
    monitorSection, tasksSection, workerToggle, workerToggleActive,
  } = elements;

  accountSection.classList.remove("hidden");
  paywallSection.classList.add("hidden");
  workerSection.classList.add("hidden");
  monitorSection.classList.add("hidden");
  tasksSection.classList.add("hidden");

  const tgLine = formatTelegramId(status.tg_id);
  const isSolo = status.is_solo || status.tracker_mode === "solo";
  const frozen = Boolean(status.tasks_frozen || status.in_grace);

  const paywallTitle = document.getElementById("paywall-title");
  const paywallDesc = document.getElementById("paywall-desc");
  const autorenewEl = document.getElementById("premium-autorenew");
  if (autorenewEl) autorenewEl.checked = Boolean(status.premium_autorenew);

  if (isSolo && !status.tg_id) {
    showStatus(accountStatus, "Соло (без Telegram) — данные только на этом ПК", "warn");
    monitorSection.classList.remove("hidden");
    tasksSection.classList.remove("hidden");
    renderModeUI({ tracker_mode: "solo", is_solo: true });
    renderTierPanels(status);
    return;
  }

  if (isSolo) {
    showStatus(accountStatus, `${tgLine}\nСоло-режим — данные только на этом ПК`, "warn");
    monitorSection.classList.remove("hidden");
    tasksSection.classList.remove("hidden");
    renderModeUI(status);
    renderTierPanels(status);
    return;
  }

  if (frozen) {
    const left = status.grace_days_left != null ? status.grace_days_left : "?";
    showStatus(
      accountStatus,
      `${tgLine}\nОблако на паузе · задачи сохранены ещё ~${left} дн.`,
      "warn",
    );
    if (paywallTitle) paywallTitle.textContent = "Включите Воркер — задачи ждут";
    if (paywallDesc) {
      paywallDesc.textContent =
        "Мониторинг и сравнение цен выключены. Список задач виден. " +
        "Воркер бесплатно — и работа продолжится без перенастройки. " +
        "Premium не продаётся; выдаётся за достижения. " +
        `До удаления с сервера: ~${left} дн.`;
    }
    paywallSection.classList.remove("hidden");
    monitorSection.classList.add("hidden");
    tasksSection.classList.remove("hidden");
    workerToggle.checked = false;
  } else if (status.is_premium || status.tracker_mode === "premium") {
    showStatus(
      accountStatus,
      `${tgLine}\nПремиум до ${status.premium_until?.slice(0, 10) || "—"}`,
      "ok",
    );
  } else if (status.trial_active) {
    showStatus(
      accountStatus,
      `${tgLine}\nТриал: осталось ${status.trial_days_left ?? "?"} дн.`,
      "info",
    );
  } else if (status.is_worker_mode) {
    if (status.worker_suspended) {
      showStatus(
        accountStatus,
        `${tgLine}\nВоркер приостановлен — включите режим Воркер снова`,
        "warn",
      );
      paywallSection.classList.remove("hidden");
    } else {
      showStatus(accountStatus, `${tgLine}\nРежим воркера — мониторинг бесплатно`, "ok");
    }
    workerSection.classList.remove("hidden");
    workerToggleActive.checked = true;
  } else {
    showStatus(accountStatus, `${tgLine}\nВключите Воркер для облака`, "warn");
    paywallSection.classList.remove("hidden");
    workerToggle.checked = false;
  }

  if (status.can_add_tasks) {
    monitorSection.classList.remove("hidden");
    tasksSection.classList.remove("hidden");
  }

  if (status.is_worker_mode && !status.is_premium && !frozen) {
    workerSection.classList.remove("hidden");
    workerToggleActive.checked = Boolean(status.is_worker_mode);
    const idle = status.worker_idle_minutes ?? 5;
    document.querySelectorAll('input[name="worker-idle"]').forEach((el) => {
      el.checked = String(el.value) === String(idle);
    });
  }

  renderReputationUI(status, elements);
  renderActivityStatus(status);
  renderTierPanels(status);
  renderModeUI(status);
  renderTasksLimit(status);
  loadReferralUI();
}

function renderReputationUI(status, elements) {
  const box = document.getElementById("reputation-box");
  const ptsEl = document.getElementById("reputation-points");
  const rankEl = document.getElementById("reputation-rank");
  if (!box || !ptsEl) return;

  const pts = Number(status.reputation_points || 0);
  const rank = Number(status.reputation_rank || 0);
  const show = (status.is_worker_mode || status.can_earn) && (pts > 0 || rank > 0);
  box.classList.toggle("hidden", !show);
  ptsEl.textContent = String(pts);
  rankEl.textContent = rank > 0 ? ` · место #${rank}` : "";
}

async function renderActivityStatus(status) {
  const sec = document.getElementById("activity-section");
  const st = document.getElementById("activity-status");
  const limitsEl = document.getElementById("earn-limits-line");
  const throttleEl = document.getElementById("earn-throttle-line");
  if (!sec || !st) return;

  const stored = await chrome.storage.local.get([
    "current_earn_job",
    "earn_stealth_limits",
    "earn_throttle",
    "earn_balance_cents",
    "earn_run_mode",
  ]);

  if (stored.current_earn_job?.category) {
    st.textContent = `▶ Задача биржи (${stored.current_earn_job.category}) — вкладка с полосой «Халявка»`;
    sec.classList.remove("hidden");
  } else if (status?.can_earn) {
    const bal = ((stored.earn_balance_cents ?? status?.earn_balance_cents ?? 0) / 100).toFixed(2);
    const mode = stored.earn_run_mode || status?.earn_run_mode || "idle";
    const modeTxt = mode === "always" ? "режим: сразу" : "режим: в простое";
    st.textContent = `⏸ Ожидание · баланс ${bal} ₽ · ${modeTxt}`;
    sec.classList.remove("hidden");
  } else {
    sec.classList.add("hidden");
    return;
  }

  const lim = stored.earn_stealth_limits || status?.stealth_limits;
  if (limitsEl && lim) {
    const eff = lim.effective_max_jobs_per_hour
      ? ` (эфф. ${lim.effective_max_jobs_per_hour}/ч)`
      : "";
    limitsEl.textContent =
      `Лимиты: сегодня ${lim.jobs_today ?? 0}/${lim.max_jobs_per_day} · ` +
      `час ${lim.jobs_last_hour ?? 0}/${lim.max_jobs_per_hour}${eff}` +
      (lim.preset ? ` · ${lim.preset}` : "");
    limitsEl.classList.remove("hidden");
  } else if (limitsEl) {
    limitsEl.classList.add("hidden");
  }

  const thr = stored.earn_throttle;
  if (throttleEl && thr?.reason) {
    throttleEl.textContent = `Пауза: ${thr.reason}`;
    throttleEl.classList.remove("hidden");
  } else if (throttleEl) {
    throttleEl.classList.add("hidden");
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  await pmRestoreSession();
  const connectCodeInput = document.getElementById("connect-code");
  const connectBtn = document.getElementById("connect-btn");
  const authStatus = document.getElementById("auth-status");
  const authSection = document.getElementById("auth-section");
  const accountSection = document.getElementById("account-section");
  const accountStatus = document.getElementById("account-status");
  const paywallSection = document.getElementById("paywall-section");
  const paywallStatus = document.getElementById("paywall-status");
  const premiumBtn = document.getElementById("premium-btn");
  const workerToggle = document.getElementById("worker-toggle");
  const workerSection = document.getElementById("worker-section");
  const workerToggleActive = document.getElementById("worker-toggle-active");
  const monitorSection = document.getElementById("monitor-section");
  const productUrlInput = document.getElementById("product-url");
  const productInfo = document.getElementById("product-info");
  const targetPriceInput = document.getElementById("target-price");
  const monitorBtn = document.getElementById("monitor-btn");
  const monitorStatus = document.getElementById("monitor-status");
  const monitorTypePrice = document.getElementById("monitor-type-price");
  const monitorTypeStock = document.getElementById("monitor-type-stock");
  const targetPriceBlock = document.getElementById("target-price-block");
  const pickElementBtn = document.getElementById("pick-element-btn");
  const pickedXpathInfo = document.getElementById("picked-xpath-info");
  const tasksSection = document.getElementById("tasks-section");
  const tasksList = document.getElementById("tasks-list");
  const refreshTasksBtn = document.getElementById("refresh-tasks-btn");
  const tasksStatus = document.getElementById("tasks-status");
  const extVersion = document.getElementById("ext-version");
  const updateBanner = document.getElementById("update-banner");
  const shopChips = document.getElementById("shop-chips");
  const transparencyBtn = document.getElementById("transparency-btn");
  const workerQueueBtn = document.getElementById("worker-queue-btn");
  const repoLink = document.getElementById("repo-link");
  const changelogLink = document.getElementById("changelog-link");

  extVersion.textContent = `v${PM_EXTENSION.version}`;
  repoLink.href = PM_EXTENSION.repoUrl;
  changelogLink.href = `${PM_EXTENSION.repoUrl}/blob/main/CHANGELOG.md`;
  const whitelistLink = document.getElementById("whitelist-link-popup");
  if (whitelistLink) whitelistLink.href = `${PM_EXTENSION.repoUrl}/blob/main/WHITELIST.md`;

  transparencyBtn.addEventListener("click", () => pmOpenTransparencyPage());
  workerQueueBtn?.addEventListener("click", () => pmOpenWorkerInfoPage());

  async function renderUpdateBanner(stored, metaLatest) {
    const latest =
      stored.update_version ||
      (metaLatest && pmUpdateAvailable(PM_EXTENSION.version, metaLatest) ? metaLatest : null);
    if (!latest || !pmUpdateAvailable(PM_EXTENSION.version, latest)) {
      updateBanner.classList.add("hidden");
      return;
    }

    const extra = await chrome.storage.local.get([
      "native_update_available",
      "update_detected_at",
    ]);
    updateBanner.classList.remove("hidden");

    if (extra.native_update_available === false) {
      updateBanner.innerHTML =
        `Доступна версия <strong>${latest}</strong>. Автообновление сломано — ` +
        `<button type="button" id="enable-auto-update-btn" class="btn-link">починить (один раз)</button>.`;
      document.getElementById("enable-auto-update-btn")?.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "OPEN_AUTO_UPDATE_SETUP" });
      });
      return;
    }

    updateBanner.innerHTML =
      `Доступна версия <strong>${latest}</strong> — обновляем автоматически… ` +
      `<button type="button" id="apply-update-btn" class="btn-link">Обновить сейчас</button>`;
    document.getElementById("apply-update-btn")?.addEventListener("click", async () => {
      const btn = document.getElementById("apply-update-btn");
      if (btn) btn.textContent = "Обновляем…";
      chrome.runtime.sendMessage({ type: "APPLY_EXTENSION_UPDATE" }, () => {
        if (btn) btn.textContent = "Обновить сейчас";
      });
    });
    // Подтолкнуть SW, если popup открыли раньше, чем доехал poll.
    chrome.runtime.sendMessage({ type: "APPLY_EXTENSION_UPDATE" });
  }

  async function loadPublicMeta() {
    const stored = await chrome.storage.local.get([
      "update_available",
      "update_version",
      "update_download_url",
      "native_update_available",
    ]);
    let metaLatest = null;
    try {
      const res = await fetch(await pmApiUrl("/meta/public"));
      if (res.ok) {
        const meta = await res.json();
        metaLatest = meta.extension_latest_version;
        if (meta.repo_url) {
          repoLink.href = meta.repo_url;
          changelogLink.href = meta.changelog_url || `${meta.repo_url}/blob/main/CHANGELOG.md`;
        }
        if (meta.supported_shops?.length) {
          shopChips.innerHTML = meta.supported_shops
            .map((s) => `<span class="shop-chip">${s.label}</span>`)
            .join("");
        }
      }
    } catch (_) {
      shopChips.innerHTML = PM_EXTENSION.supportedShops
        .map((s) => `<span class="shop-chip">${s.label}</span>`)
        .join("");
    }

    if (stored.update_available && stored.update_version) {
      await renderUpdateBanner(stored, metaLatest);
    } else if (metaLatest && pmUpdateAvailable(PM_EXTENSION.version, metaLatest)) {
      await renderUpdateBanner({ update_version: metaLatest }, metaLatest);
    } else {
      updateBanner.classList.add("hidden");
    }
  }

  loadPublicMeta();
  chrome.runtime.sendMessage({ type: "CHECK_EXTENSION_UPDATE", force: true });

  let pickedXpath = null;

  const elements = {
    accountSection, accountStatus, paywallSection, workerSection,
    monitorSection, tasksSection, workerToggle, workerToggleActive,
  };

  let currentProduct = null;

  async function loadPickedXpath() {
    const stored = await chrome.storage.local.get([
      "picked_xpath",
      "picked_preview",
      "picked_price",
    ]);
    pickedXpath = stored.picked_xpath || null;
    if (pickedXpath) {
      pickedXpathInfo.classList.remove("hidden");
      const priceHint = stored.picked_price ? ` · ${stored.picked_price} ₽` : "";
      pickedXpathInfo.textContent =
        `XPath: ${pickedXpath.slice(0, 60)}${pickedXpath.length > 60 ? "…" : ""}${priceHint}`;
    } else {
      pickedXpathInfo.classList.add("hidden");
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.picked_xpath) {
      loadPickedXpath();
    }
  });

  async function refreshProductUI() {
    const pasted = productUrlInput?.value?.trim() || "";
    let url = pasted;
    if (!url) {
      url = (await getActiveTabUrl()) || "";
      if (url) productUrlInput.value = url;
    }
    currentProduct = url ? parseProductFromUrl(url) : null;
    if (currentProduct) {
      productInfo.textContent =
        `${shopLabel(currentProduct.shop_id)} · ${formatTutuProductLabel(currentProduct)}`;
      productInfo.classList.remove("hidden");
    } else if (pasted || url) {
      productInfo.textContent =
        "Ссылка не распознана — проверьте, что магазин в белом списке выше.";
      productInfo.classList.remove("hidden");
    } else {
      productInfo.classList.add("hidden");
    }
  }

  productUrlInput?.addEventListener("input", () => refreshProductUI());
  productUrlInput?.addEventListener("paste", () => {
    setTimeout(() => refreshProductUI(), 0);
  });

  function selectedMonitorType() {
    return monitorTypeStock.checked ? "in_stock" : "price_drop";
  }

  function syncMonitorTypeUI() {
    const inStock = selectedMonitorType() === "in_stock";
    targetPriceBlock.classList.toggle("hidden", inStock);
    if (inStock) targetPriceInput.value = "0";
  }

  monitorTypePrice.addEventListener("change", syncMonitorTypeUI);
  monitorTypeStock.addEventListener("change", syncMonitorTypeUI);
  syncMonitorTypeUI();

  async function loadTasks() {
    try {
      const st = (await chrome.storage.local.get(["user_status"])).user_status;
      if (st?.is_solo || st?.tracker_mode === "solo") {
        const solo = await SoloTasks.list();
        renderTasksLimit(st, solo.length);
        if (!solo.length) {
          tasksList.textContent = "Пока нет локальных отслеживаний (Соло).";
          return;
        }
        tasksList.innerHTML = "";
        for (const task of solo) {
          const item = document.createElement("div");
          item.className = "task-item";
          item.innerHTML = `
            <strong>${shopLabel(task.shop_id)}</strong> (локально)<br>
            ${task.title || task.product_id}<br>
            Цель: ${formatPrice(task.target_price)} · Сейчас: ${formatPrice(task.last_price)}
            <button type="button" data-solo-id="${task.id}">Удалить</button>
          `;
          item.querySelector("button").addEventListener("click", async () => {
            await SoloTasks.remove(task.id);
            await loadTasks();
          });
          tasksList.appendChild(item);
        }
        return;
      }
      const res = await apiFetch("/tasks/list");
      if (!res.ok) throw new Error(`Список: ошибка ${res.status}`);
      const data = await res.json();
      const status = (await chrome.storage.local.get(["user_status"])).user_status;
      if (!data.tasks?.length) {
        tasksList.textContent = "Пока нет отслеживаемых товаров.";
        renderTasksLimit(status, 0);
        return;
      }
      renderTasksLimit(status, data.tasks.length);
      tasksList.innerHTML = "";
      for (const task of data.tasks) {
        const item = document.createElement("div");
        item.className = "task-item";
        const title = task.title || task.product_id;
        const history = task.price_history?.[0];
        const historyHint = history
          ? ` · было ${formatPrice(history.price)}`
          : "";
        const monitorLabel =
          task.monitor_type === "in_stock" ? "В наличии" : "Скидка";
        const priceLine =
          task.monitor_type === "in_stock"
            ? `Сейчас: ${formatPrice(task.last_price)}`
            : `Цель: ${formatPrice(task.target_price)} · Сейчас: ${formatPrice(task.last_price)}`;
        item.innerHTML = `
          <strong>#${task.id} ${task.shop_label}</strong> · ${monitorLabel}<br>
          ${title}<br>
          ${priceLine}${historyHint}
          <div class="task-meta">${task.last_check ? `Проверка: ${task.last_check.slice(0, 16).replace("T", " ")}` : "Ещё не проверялось"}${task.parse_fail_count ? ` · ошибок: ${task.parse_fail_count}` : ""}</div>
          <button type="button" class="btn-check-now" data-task-id="${task.id}">Проверить</button>
          <button type="button" data-task-id="${task.id}">Удалить</button>
        `;
        item.querySelector(".btn-check-now").addEventListener("click", async (ev) => {
          const btn = ev.currentTarget;
          btn.disabled = true;
          try {
            const qRes = await apiFetch(`/tasks/${task.id}/check_now`, { method: "POST" });
            if (!qRes.ok) {
              const err = await qRes.json().catch(() => ({}));
              throw new Error(err.detail || `Ошибка ${qRes.status}`);
            }
            showStatus(tasksStatus, "Проверяю…", "ok");
            const hb = await triggerWorkerHeartbeat(task.id);
            const msg = formatHeartbeatResult(hb, task.id) || "Отчёт отправлен";
            showStatus(tasksStatus, msg, hb?.ok ? "ok" : "warn");
            await loadTasks();
          } catch (e) {
            showStatus(tasksStatus, e.message, "err");
          } finally {
            btn.disabled = false;
          }
        });
        item.querySelector("button:not(.btn-check-now)").addEventListener("click", async () => {
          const delRes = await apiFetch(`/tasks/${task.id}`, { method: "DELETE" });
          if (!delRes.ok) {
            showStatus(tasksStatus, "Не удалось удалить", "err");
            return;
          }
          await loadTasks();
          showStatus(tasksStatus, "Удалено", "ok");
        });
        tasksList.appendChild(item);
      }
    } catch (e) {
      showStatus(tasksStatus, e.message, "err");
    }
  }

  async function loadEarnCategoriesUI(status) {
  const sec = document.getElementById("earn-section");
  const box = document.getElementById("earn-categories");
  const hint = document.getElementById("earn-consent-hint");
  const saveBtn = document.getElementById("earn-save-btn");
  if (!sec || !box) return;

  if (!status?.can_earn) {
    sec?.classList.add("hidden");
    return;
  }
  sec?.classList.remove("hidden");

  try {
    const metaRes = await publicFetch("/exchange/meta/public");
    const meta = metaRes.ok ? await metaRes.json() : { categories: [] };
    let selected = [];
    let userStealth = earnDefaultStealth();
    let adminOverride = false;
    let earnRunMode = "idle";
    const local = await chrome.storage.local.get([
      "earn_allowed_categories",
      "earn_user_stealth",
      "earn_run_mode",
    ]);
    if (Array.isArray(local.earn_allowed_categories)) {
      selected = local.earn_allowed_categories;
    }
    if (local.earn_user_stealth) {
      userStealth = local.earn_user_stealth;
    }
    if (local.earn_run_mode === "always" || local.earn_run_mode === "idle") {
      earnRunMode = local.earn_run_mode;
    }
    try {
      const stRes = await apiFetch("/exchange/commander/status");
      if (stRes.ok) {
        const st = await stRes.json();
        if (Array.isArray(st.preferences?.categories)) {
          selected = st.preferences.categories;
        }
        userStealth = st.preferences?.stealth || userStealth;
        earnRunMode = st.preferences?.earn_run_mode === "always" ? "always" : earnRunMode;
        adminOverride = Boolean(st.admin_override);
        if (st.stealth_limits) {
          await chrome.storage.local.set({ earn_stealth_limits: st.stealth_limits });
        }
        const dnEl = document.getElementById("earn-display-name");
        if (dnEl && st.display_name) dnEl.value = st.display_name;
        await chrome.storage.local.set({
          earn_allowed_categories: selected,
          earn_user_stealth: userStealth,
          earn_run_mode: earnRunMode,
        });
      }
    } catch (_) {
      /* consent not yet */
    }
    if (selected.length || userStealth) {
      await chrome.storage.local.set({
        earn_allowed_categories: selected,
        earn_user_stealth: userStealth,
        earn_run_mode: earnRunMode,
      });
    }

    const modeEl = document.querySelector(`input[name="earn-run-mode"][value="${earnRunMode}"]`);
    if (modeEl) modeEl.checked = true;

    const adminHint = document.getElementById("earn-admin-hint");
    if (adminHint) {
      if (adminOverride) {
        adminHint.textContent =
          "⚙️ Оператор подкрутил лимиты для вашего аккаунта (тест/VIP). Ваши настройки ниже — эффективные лимиты могут отличаться.";
        adminHint.classList.remove("hidden");
      } else {
        adminHint.classList.add("hidden");
      }
    }

    earnFillStealthForm(userStealth);
    if (!document.getElementById("earn-stealth-preset")?.dataset.wired) {
      earnWireStealthSliders();
      document.getElementById("earn-stealth-preset").dataset.wired = "1";
    }

    const cats = (meta.categories || []).filter((c) => c.enabled !== false);
    if (!cats.length) {
      box.innerHTML = "<p class='paywall-desc'>Категории недоступны.</p>";
      return;
    }

    hint.classList.toggle("hidden", selected.length > 0 || status.can_earn);
    box.innerHTML = cats
      .map((c) => {
        const testBadge = c.group === "test" ? ' <span class="earn-cat-badge">тест</span>' : "";
        const checked = selected.includes(c.id) ? " checked" : "";
        return `<div class="earn-cat-item"><label><input type="checkbox" name="earn-cat" value="${c.id}"${checked}> <strong>${c.label || c.id}</strong>${testBadge}<br><span class="earn-cat-badge">${c.description || ""}</span></label></div>`;
      })
      .join("");

    if (saveBtn && !saveBtn.dataset.wired) {
      saveBtn.dataset.wired = "1";
      saveBtn.addEventListener("click", saveEarnCategories);
    }
  } catch (e) {
    box.innerHTML = `<p class="paywall-desc">${e.message}</p>`;
  }
}

async function saveEarnCategories() {
  const saveStatus = document.getElementById("earn-save-status");
  const saveBtn = document.getElementById("earn-save-btn");
  const picked = [...document.querySelectorAll('input[name="earn-cat"]:checked')].map((el) => el.value);
  if (!picked.length) {
    showStatus(saveStatus, "Выберите хотя бы одну категорию", "err");
    return;
  }
  const stealth = earnStealthFromForm();
  const max_daily = stealth.max_jobs_per_day || 30;
  const earn_run_mode =
    document.querySelector('input[name="earn-run-mode"]:checked')?.value === "always" ? "always" : "idle";
  saveBtn.disabled = true;
  try {
    const consentRes = await apiFetch("/exchange/commander/consent", {
      method: "POST",
      body: JSON.stringify({ accepted: true }),
    });
    if (!consentRes.ok && consentRes.status !== 400) {
      const err = await consentRes.json().catch(() => ({}));
      throw new Error(err.detail || `consent ${consentRes.status}`);
    }
    const res = await apiFetch("/exchange/commander/preferences", {
      method: "PUT",
      body: JSON.stringify({ categories: picked, max_daily, stealth, earn_run_mode }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `save ${res.status}`);
    }
    const body = await res.json();
    const displayName = document.getElementById("earn-display-name")?.value?.trim();
    if (displayName && displayName.length >= 2) {
      const dnRes = await apiFetch("/exchange/commander/display-name", {
        method: "PUT",
        body: JSON.stringify({ display_name: displayName }),
      });
      if (!dnRes.ok) {
        const err = await dnRes.json().catch(() => ({}));
        throw new Error(err.detail || `имя ${dnRes.status}`);
      }
    }
    await chrome.storage.local.set({
      earn_allowed_categories: picked,
      earn_user_stealth: stealth,
      earn_run_mode,
    });
    document.getElementById("earn-consent-hint")?.classList.remove("hidden");
    // Keep risk warning visible; soft note that consent was saved
    const modeLabel = earn_run_mode === "always" ? "сразу" : "в простое";
    showStatus(saveStatus, `Сохранено: ${picked.length} категорий · ${stealth.preset} · ${modeLabel}`, "ok");
    await syncUserStatusFromPopup();
  } catch (e) {
    showStatus(saveStatus, e.message, "err");
  } finally {
    saveBtn.disabled = false;
  }
}

  async function syncUserStatusFromPopup() {
    try {
      const res = await apiFetch("/user/status");
      if (!res.ok) return;
      const status = await res.json();
      renderAccountUI(status, elements);
      await loadEarnCategoriesUI(status);
      await renderActivityStatus(status);
    } catch (_) {
      /* ignore */
    }
  }

  async function onConnected() {
    authSection.classList.add("hidden");
    const status = await fetchUserStatus();
    renderAccountUI(status, elements);
    await loadEarnCategoriesUI(status);
    await refreshProductUI();
    await loadPickedXpath();
    await loadTasks();
    await loadReferralUI();
  }

  async function completeOnboardingAndEnter() {
    const { session_token } = await chrome.storage.local.get(["session_token"]);
    await finishOnboarding({ localSolo: !session_token });
    if (session_token) {
      await onConnected();
    } else {
      authSection.classList.add("hidden");
      renderAccountUI(
        { tracker_mode: "solo", is_solo: true, can_add_tasks: false },
        elements,
      );
      await loadTasks();
    }
  }

  document.getElementById("onb-done-btn")?.addEventListener("click", async () => {
    try {
      await completeOnboardingAndEnter();
    } catch (e) {
      showStatus(document.getElementById("onb-auth-status"), e.message, "err");
    }
  });

  document.getElementById("onb-solo-local-btn")?.addEventListener("click", async () => {
    try {
      // Локальный старт: сразу на экран «как устроено», без выбора роли.
      await chrome.storage.local.set({
        tracker_mode: "solo",
        is_solo: true,
        popup_notifications_enabled: true,
      });
      showOnboardingStep(3);
    } catch (e) {
      showStatus(document.getElementById("onb-auth-status"), e.message, "err");
    }
  });

  document.getElementById("onb-step2-skip")?.addEventListener("click", () => {
    showOnboardingStep(3);
  });

  document.getElementById("onb-connect-btn")?.addEventListener("click", async () => {
    const code = document.getElementById("onb-connect-code").value.replace(/\D/g, "").slice(0, 4);
    const statusEl = document.getElementById("onb-auth-status");
    if (!/^\d{4}$/.test(code)) {
      showStatus(statusEl, "Введите 4 цифры", "err");
      return;
    }
    try {
      const pending = await chrome.storage.local.get(["pending_referral_code"]);
      const res = await publicFetch("/auth/connect", {
        method: "POST",
        body: JSON.stringify({
          connect_code: code,
          referral_code: pending.pending_referral_code || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Ошибка ${res.status}`);
      }
      const data = await res.json();
      await chrome.storage.local.set({
        session_token: data.session_token,
        tg_id: data.tg_id,
        pending_referral_code: null,
      });
      await pmPersistSession();
      showOnboardingStep(2);
    } catch (e) {
      showStatus(statusEl, e.message, "err");
    }
  });

  document.getElementById("onb-step2-next")?.addEventListener("click", () => {
    showOnboardingStep(3);
  });

  chrome.storage.local.get(["popup_notifications_enabled"]).then((s) => {
    const t = document.getElementById("popup-notify-toggle");
    if (t) t.checked = s.popup_notifications_enabled !== false;
  });
  document.getElementById("popup-notify-toggle")?.addEventListener("change", async (ev) => {
    await chrome.storage.local.set({ popup_notifications_enabled: ev.target.checked });
  });

  document.querySelectorAll('input[name="worker-idle"]').forEach((el) => {
    el.addEventListener("change", async () => {
      if (!el.checked) return;
      const minutes = parseInt(el.value, 10);
      try {
        await apiFetch("/user/worker_idle", {
          method: "POST",
          body: JSON.stringify({ minutes }),
        });
        await chrome.storage.local.set({ worker_idle_minutes: minutes });
      } catch (e) {
        showStatus(accountStatus, e.message, "err");
      }
    });
  });

  ["mode-worker-btn"].forEach((id) => {
    document.getElementById(id)?.addEventListener("click", async () => {
      try {
        await setTrackerMode("worker");
        const status = await fetchUserStatus();
        renderAccountUI(status, elements);
        await loadTasks();
      } catch (e) {
        showStatus(accountStatus, e.message, "err");
      }
    });
  });
  // Premium buy UI hidden — grant via achievements / admin / referrals only.
  document.getElementById("mode-solo-btn")?.addEventListener("click", async () => {
    try {
      await setTrackerMode("solo");
      const status = await fetchUserStatus();
      renderAccountUI(status, elements);
      await loadTasks();
    } catch (e) {
      showStatus(accountStatus, e.message, "err");
    }
  });

  const stored = await chrome.storage.local.get(["session_token", "tg_id", "onboarding_complete"]);
  if (!stored.onboarding_complete) {
    showOnboardingStep(stored.session_token ? 2 : 1);
  } else if (stored.session_token && stored.tg_id) {
    try {
      await onConnected();
    } catch (e) {
      showStatus(authStatus, e.message, "err");
      authSection.classList.remove("hidden");
    }
  }

  connectBtn.addEventListener("click", async () => {
    const code = connectCodeInput.value.replace(/\D/g, "").slice(0, 4);
    connectCodeInput.value = code;
    if (!/^\d{4}$/.test(code)) {
      showStatus(authStatus, "Введите 4 цифры из Telegram (только цифры)", "err");
      return;
    }

    connectBtn.disabled = true;
    try {
      const res = await publicFetch("/auth/connect", {
        method: "POST",
        body: JSON.stringify({ connect_code: code }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Ошибка ${res.status}`);
      }
      const data = await res.json();
      await chrome.storage.local.set({
        session_token: data.session_token,
        tg_id: data.tg_id,
      });
      await pmPersistSession();
      showStatus(authStatus, `Успешно! ${formatTelegramId(data.tg_id)}`, "ok");
      await onConnected();
    } catch (e) {
      showStatus(authStatus, e.message, "err");
    } finally {
      connectBtn.disabled = false;
    }
  });

  document.getElementById("revoke-session-btn")?.addEventListener("click", async () => {
    const btn = document.getElementById("revoke-session-btn");
    if (!confirm("Отвязать этот ПК? Нужен будет новый код из бота.")) return;
    if (btn) btn.disabled = true;
    try {
      try {
        await apiFetch("/user/revoke-session", { method: "POST", body: "{}" });
      } catch (_) {
        /* still clear local even if offline */
      }
      await pmClearSessionLocal();
      accountSection.classList.add("hidden");
      authSection.classList.remove("hidden");
      showStatus(authStatus, "ПК отвязан. Введите новый код из бота.", "ok");
    } catch (e) {
      showStatus(accountStatus, e.message, "err");
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  if (premiumBtn) {
    premiumBtn.classList.add("hidden");
    premiumBtn.disabled = true;
  }
  document.getElementById("premium-autorenew")?.closest("label")?.classList.add("hidden");

  workerToggle.addEventListener("change", async () => {
    if (!workerToggle.checked) return;
    try {
      await setWorkerMode(true);
      const status = await fetchUserStatus();
      renderAccountUI(status, elements);
      showStatus(paywallStatus, "Режим воркера включён", "ok");
    } catch (e) {
      workerToggle.checked = false;
      showStatus(paywallStatus, e.message, "err");
    }
  });

  workerToggleActive.addEventListener("change", async () => {
    try {
      await setWorkerMode(workerToggleActive.checked);
      const status = await fetchUserStatus();
      renderAccountUI(status, elements);
    } catch (e) {
      workerToggleActive.checked = !workerToggleActive.checked;
      showStatus(accountStatus, e.message, "err");
    }
  });

  pickElementBtn.addEventListener("click", async () => {
    pickElementBtn.disabled = true;
    try {
      const res = await chrome.runtime.sendMessage({ type: "START_PICKER" });
      if (res?.error) throw new Error(res.error);
      showStatus(
        monitorStatus,
        "Кликните по цене на странице (Esc — отмена)",
        "info"
      );
      window.close();
    } catch (e) {
      showStatus(monitorStatus, e.message, "err");
    } finally {
      pickElementBtn.disabled = false;
    }
  });

  refreshTasksBtn.addEventListener("click", () => loadTasks());

  window.addEventListener("focus", () => {
    refreshProductUI();
    loadTasks();
  });

  monitorBtn.addEventListener("click", async () => {
    await refreshProductUI();
    if (!currentProduct) {
      showStatus(
        monitorStatus,
        "Вставьте ссылку на товар из поддерживаемого магазина",
        "err"
      );
      return;
    }
    const monitorType = selectedMonitorType();
    let targetPrice = 0;
    if (monitorType === "price_drop") {
      targetPrice = parseFloat(targetPriceInput.value);
      if (isNaN(targetPrice) || targetPrice <= 0) {
        showStatus(monitorStatus, "Укажите корректную цену", "err");
        return;
      }
    }

    monitorBtn.disabled = true;
    try {
      const st = (await chrome.storage.local.get(["user_status"])).user_status;
      if (st?.is_solo || st?.tracker_mode === "solo") {
        await SoloTasks.add({
          shop_id: currentProduct.shop_id,
          product_id: currentProduct.product_id,
          target_price: targetPrice,
          source_url: currentProduct.source_url,
          monitor_type: monitorType,
        });
        showStatus(monitorStatus, "Добавлено локально (Соло). Уведомление — только на этом ПК.", "ok");
        chrome.runtime.sendMessage({ type: "SOLO_SCHEDULE_CHECK" });
        await loadTasks();
        return;
      }

      const body = {
        shop_id: currentProduct.shop_id,
        product_id: currentProduct.product_id,
        target_price: targetPrice,
        monitor_type: monitorType,
        check_now: true,
      };
      if (currentProduct.source_url) body.source_url = currentProduct.source_url;
      if (pickedXpath) body.custom_xpath = pickedXpath;

      const res = await apiFetch("/tasks/add", {
        method: "POST",
        body: JSON.stringify(body),
      });

      if (res.status === 402) {
        const err = await res.json().catch(() => ({}));
        const detail = err.detail || {};
        const msg =
          typeof detail === "object" && detail.message
            ? detail.message
            : "Триал закончился. Включите Воркер бесплатно — Premium за достижения.";
        showStatus(monitorStatus, msg, "warn");
        const status = await fetchUserStatus();
        renderAccountUI(status, elements);
        return;
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const detail = err.detail;
        throw new Error(formatMonitorLimitError(detail) || `Ошибка ${res.status}`);
      }

      const data = await res.json();
      showStatus(monitorStatus, "Проверяю цену…", "ok");
      let hbMsg = data.message || `Мониторинг #${data.task_id} принят`;
      if (currentProduct.shop_id === "aviasales") {
        hbMsg +=
          "\nAviasales: трекается страница поиска маршрута (не бронь места). При пустой выдаче — «нет билетов».";
      }
      if (
        currentProduct.shop_id === "tutu" &&
        /\/(?:aviabilety|route|f)\//i.test(currentProduct.product_id || "")
      ) {
        hbMsg +=
          "\nTutu авиа: мониторинг страницы поиска с датой (URL вида avia.tutu.ru/f/…?route[0]=…).";
      }
      try {
        const hb = await triggerWorkerHeartbeat(data.task_id);
        const extra = formatHeartbeatResult(hb, data.task_id);
        if (extra) hbMsg = `${hbMsg}\n${extra}`;
      } catch (hbErr) {
        hbMsg = `${hbMsg}\nВоркер: ${hbErr.message}`;
      }
      showStatus(monitorStatus, hbMsg, "ok");
      await loadTasks();
    } catch (e) {
      showStatus(monitorStatus, e.message, "err");
    } finally {
      monitorBtn.disabled = false;
    }
  });
});
