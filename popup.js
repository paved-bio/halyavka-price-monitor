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
    regex: /(?:https?:\/\/)?(?:www\.)?ozon\.ru(\/product\/[^/?#]+)/i,
    product_id: (match) => match[1],
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
    regex: /(?:https?:\/\/)?(?:www\.)?tutu\.ru(\/poezda\/[^?#]+)/i,
    product_id: (match) => match[1],
  },
];

function parseProductFromUrl(url) {
  for (const shop of SHOP_PATTERNS) {
    const match = url.match(shop.regex);
    if (match) {
      return { shop_id: shop.shop_id, product_id: shop.product_id(match) };
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

async function fetchUserStatus() {
  const res = await apiFetch("/user/status");
  if (!res.ok) throw new Error(`Статус: ошибка ${res.status}`);
  const status = await res.json();
  await chrome.storage.local.set({
    is_worker_mode: status.is_worker_mode,
    can_add_tasks: status.can_add_tasks,
    user_status: status,
  });
  return status;
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

async function activatePremium() {
  const res = await apiFetch("/user/premium/activate", { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Ошибка ${res.status}`);
  }
  return res.json();
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

  if (status.is_premium) {
    showStatus(
      accountStatus,
      `${tgLine}\nПремиум до ${status.premium_until?.slice(0, 10) || "—"}`,
      "ok"
    );
  } else if (status.trial_active) {
    showStatus(
      accountStatus,
      `${tgLine}\nТриал: осталось ${status.trial_days_left ?? "?"} дн.`,
      "info"
    );
  } else if (status.is_worker_mode) {
    if (status.worker_suspended) {
      showStatus(
        accountStatus,
        `${tgLine}\nВоркер приостановлен — включите браузер или оформи подписку`,
        "warn"
      );
      paywallSection.classList.remove("hidden");
    } else {
      showStatus(accountStatus, `${tgLine}\nРежим воркера — мониторинг бесплатно`, "ok");
    }
    workerSection.classList.remove("hidden");
    workerToggleActive.checked = true;
  } else {
    showStatus(accountStatus, `${tgLine}\nТриал закончился`, "warn");
    paywallSection.classList.remove("hidden");
    workerToggle.checked = false;
  }

  if (status.can_add_tasks) {
    monitorSection.classList.remove("hidden");
    tasksSection.classList.remove("hidden");
  }

  if (status.is_worker_mode && status.can_add_tasks && !status.is_premium) {
    workerSection.classList.remove("hidden");
    workerToggleActive.checked = true;
  }

  renderReputationUI(status, elements);
  renderActivityStatus(status);
}

function renderReputationUI(status, elements) {
  const box = document.getElementById("reputation-box");
  const ptsEl = document.getElementById("reputation-points");
  const rankEl = document.getElementById("reputation-rank");
  if (!box || !ptsEl) return;

  const pts = Number(status.reputation_points || 0);
  const rank = Number(status.reputation_rank || 0);
  const show = status.is_worker_mode || status.can_earn || pts > 0;
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
  } else if (status?.can_earn || status?.is_worker_mode) {
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

  transparencyBtn.addEventListener("click", () => pmOpenTransparencyPage());
  workerQueueBtn?.addEventListener("click", () => pmOpenWorkerInfoPage());

  async function renderUpdateBanner(stored, metaLatest) {
    const latest =
      stored.update_version ||
      (metaLatest && pmUpdateAvailable(PM_EXTENSION.version, metaLatest) ? metaLatest : null);
    if (!latest) {
      updateBanner.classList.add("hidden");
      return;
    }

    const extra = await chrome.storage.local.get(["native_update_available"]);
    if (extra.native_update_available === false) {
      updateBanner.classList.add("hidden");
      return;
    }

    updateBanner.classList.add("hidden");
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
    const url = await getActiveTabUrl();
    currentProduct = url ? parseProductFromUrl(url) : null;
    if (currentProduct) {
      productInfo.textContent =
        `Магазин: ${currentProduct.shop_id}\nID: ${currentProduct.product_id}`;
      productInfo.classList.remove("hidden");
    } else {
      productInfo.classList.add("hidden");
    }
  }

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
      const res = await apiFetch("/tasks/list");
      if (!res.ok) throw new Error(`Список: ошибка ${res.status}`);
      const data = await res.json();
      if (!data.tasks?.length) {
        tasksList.textContent = "Пока нет отслеживаемых товаров.";
        return;
      }
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
          <button type="button" data-task-id="${task.id}">Удалить</button>
        `;
        item.querySelector("button").addEventListener("click", async () => {
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
    sec.classList.add("hidden");
    return;
  }
  sec.classList.remove("hidden");

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
    if (!selected.length && status.earn_categories?.length) {
      selected = status.earn_categories.map((c) => c.id);
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
    document.getElementById("earn-consent-hint")?.classList.add("hidden");
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
  }

  const stored = await chrome.storage.local.get(["session_token", "tg_id"]);
  if (stored.session_token && stored.tg_id) {
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

  premiumBtn.addEventListener("click", async () => {
    premiumBtn.disabled = true;
    try {
      await activatePremium();
      const status = await fetchUserStatus();
      renderAccountUI(status, elements);
      showStatus(paywallStatus, "Премиум активирован (stub)", "ok");
    } catch (e) {
      showStatus(paywallStatus, e.message, "err");
    } finally {
      premiumBtn.disabled = false;
    }
  });

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
      showStatus(monitorStatus, "Откройте страницу товара из белого списка", "err");
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
      const body = {
        shop_id: currentProduct.shop_id,
        product_id: currentProduct.product_id,
        target_price: targetPrice,
        monitor_type: monitorType,
      };
      if (pickedXpath) body.custom_xpath = pickedXpath;

      const res = await apiFetch("/tasks/add", {
        method: "POST",
        body: JSON.stringify(body),
      });

      if (res.status === 402) {
        const err = await res.json().catch(() => ({}));
        const detail = err.detail || {};
        showStatus(
          monitorStatus,
          `Триал закончился. Подписка: ${detail.subscription_price || 100} ₽`,
          "warn"
        );
        const status = await fetchUserStatus();
        renderAccountUI(status, elements);
        return;
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const detail = err.detail;
        throw new Error(
          typeof detail === "string" ? detail : `Ошибка ${res.status}`
        );
      }

      const data = await res.json();
      showStatus(
        monitorStatus,
        data.message || `Мониторинг #${data.task_id} принят`,
        "ok"
      );
      await loadTasks();
    } catch (e) {
      showStatus(monitorStatus, e.message, "err");
    } finally {
      monitorBtn.disabled = false;
    }
  });
});
