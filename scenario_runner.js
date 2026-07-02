/**
 * Универсальный исполнитель сценариев Exchange (steps JSON с сервера).
 * v2: runStep, extract_all, eval_json_script — см. docs/SCENARIO_ENGINE.md
 */
(function () {
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function randBetween(min, max) {
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    return lo + Math.floor(Math.random() * (hi - lo + 1));
  }

  function queryOne(selector, root) {
    if (!selector) return null;
    const scope = root || document;
    try {
      const direct = scope.querySelector(selector);
      if (direct) return direct;
    } catch (_) {
      return null;
    }
    if (root) return null;
    return queryDeep(selector);
  }

  function queryDeep(selector) {
    if (!selector) return null;
    const hosts = document.querySelectorAll("*");
    for (const host of hosts) {
      const root = host.shadowRoot;
      if (!root) continue;
      try {
        const found = root.querySelector(selector);
        if (found) return found;
      } catch (_) {
        /* ignore */
      }
    }
    return null;
  }

  function readField(spec, root) {
    if (spec.scope === "node" && root) {
      if (!spec.selector) {
        if (spec.attr) return root.getAttribute(spec.attr);
        if (spec.text) return (root.textContent || "").trim();
        return null;
      }
      const el = root.querySelector(spec.selector);
      if (!el) return null;
      if (spec.attr) return el.getAttribute(spec.attr);
      if (spec.text) return (el.textContent || "").trim();
      return (el.textContent || "").trim();
    }
    const el = queryOne(spec.selector, root);
    if (!el) return null;
    if (spec.attr) return el.getAttribute(spec.attr);
    if (spec.text) return (el.textContent || "").trim();
    return (el.textContent || "").trim();
  }

  function resolveHref(href, baseUrl) {
    if (!href) return null;
    if (href.startsWith("http")) return href;
    const base = baseUrl || location.origin;
    return base.replace(/\/$/, "") + (href.startsWith("/") ? href : "/" + href);
  }

  function getByPath(obj, path) {
    if (!path) return obj;
    let cur = obj;
    for (const part of String(path).split(".")) {
      if (cur == null) return null;
      cur = cur[part];
    }
    return cur;
  }

  async function waitForSelector(selector, timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 8000);
    const parts = String(selector || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    while (Date.now() < deadline) {
      for (const part of parts.length ? parts : [selector]) {
        if (queryOne(part)) return part;
      }
      await sleep(200);
    }
    throw new Error(`Timeout waiting for ${selector}`);
  }

  function clickOne(selectors) {
    const list = Array.isArray(selectors)
      ? selectors
      : String(selectors || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
    for (const sel of list) {
      const el = queryOne(sel);
      if (el) {
        el.click();
        return sel;
      }
    }
    throw new Error(`Click target not found: ${list.join(" | ")}`);
  }

  async function runStep(step, params) {
    const action = step.action;
    const out = {};

    if (action === "goto" || action === "navigate") {
      // Навигация выполняется в background.js (chrome.tabs.update)
      return out;
    }
    if (action === "wait") {
      await waitForSelector(step.selector, step.timeout_ms || 8000);
      return out;
    }
    if (action === "dwell") {
      const c = self.PMStealthConfig || {};
      const jobId = c.job_id || null;
      const heartbeats = [];

      const sendHeartbeat = (elapsed) => {
        heartbeats.push({ elapsed_ms: elapsed, url: location.href, ts: Date.now() });
        try {
          chrome.runtime?.sendMessage?.({
            type: "PM_WATCH_HEARTBEAT",
            job_id: jobId,
            elapsed_ms: elapsed,
            url: location.href,
          });
        } catch (_) {
          /* ignore */
        }
      };

      if (step.watch_min_ms || step.watch_max_ms) {
        const onMock = /halyavka\.online|127\.0\.0\.1|localhost/.test(location.hostname);
        let minMs = step.watch_min_ms || 120000;
        let maxMs = step.watch_max_ms || minMs;
        if (onMock && step.mock_watch_ms) {
          minMs = step.mock_watch_ms;
          maxMs = step.mock_watch_ms;
        }
        const totalMs = randBetween(minMs, maxMs);
        const interval =
          onMock && step.mock_heartbeat_interval_ms
            ? step.mock_heartbeat_interval_ms
            : step.heartbeat_interval_ms || 60000;
        const start = Date.now();
        sendHeartbeat(0);
        while (Date.now() - start < totalMs) {
          const waitMs = Math.min(interval, totalMs - (Date.now() - start));
          if (waitMs <= 0) break;
          await sleep(waitMs);
          sendHeartbeat(Date.now() - start);
        }
        out.watch_elapsed_ms = Date.now() - start;
        out.heartbeats = heartbeats;
        out.heartbeat_count = heartbeats.length;
        return out;
      }

      let minMs = step.min_ms || 500;
      let maxMs = step.max_ms || 1500;
      const mult = Number(c.dwell_multiplier) || 1;
      if (c.category_risk === "high" && c.risk_multiplier) {
        minMs = Math.round(minMs * mult * Number(c.risk_multiplier));
        maxMs = Math.round(maxMs * mult * Number(c.risk_multiplier));
      } else {
        minMs = Math.round(minMs * mult);
        maxMs = Math.round(maxMs * mult);
      }
      await sleep(randBetween(minMs, maxMs));
      return out;
    }
    if (action === "scroll") {
      const dy = step.delta_y || 300;
      if (step.humanize && self.PMHumanize) {
        await self.PMHumanize.humanScroll(dy, step);
      } else {
        window.scrollBy(0, dy);
        await sleep(randBetween(200, 600));
      }
      return out;
    }
    if (action === "click") {
      const list = Array.isArray(step.selectors || step.selector)
        ? step.selectors || step.selector
        : String(step.selectors || step.selector || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
      let el = null;
      let used = null;
      for (const sel of list) {
        el = queryOne(sel);
        if (el) {
          used = sel;
          break;
        }
      }
      if (!el) throw new Error(`Click target not found: ${list.join(" | ")}`);
      if (step.humanize && self.PMHumanize) {
        await self.PMHumanize.humanClick(el);
      } else {
        el.click();
        await sleep(randBetween(300, 900));
      }
      if (step.proof_attr) out[step.proof_attr] = used;
      return out;
    }
    if (action === "type") {
      const el = queryOne(step.selector);
      if (!el) throw new Error(`Type target not found: ${step.selector}`);
      const val = (step.value || "").replace(/\{\{(\w+)\}\}/g, (_, k) => (params || {})[k] || "");
      if (step.humanize && self.PMHumanize) {
        await self.PMHumanize.humanType(el, val, step);
      } else {
        if (step.clear) {
          if (el.isContentEditable) el.textContent = "";
          else el.value = "";
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
        el.focus();
        if (el.isContentEditable) {
          el.textContent = val;
          el.dispatchEvent(new InputEvent("input", { bubbles: true }));
        } else {
          el.value = val;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
        await sleep(randBetween(200, 500));
      }
      return out;
    }
    if (action === "extract") {
      for (const [key, spec] of Object.entries(step.fields || {})) {
        let v = readField(spec);
        if (spec.attr === "href" && step.resolve_base) {
          v = resolveHref(v, step.base_url || params.base_url);
        }
        out[key] = v;
      }
      return out;
    }
    if (action === "extract_all") {
      const nodes = document.querySelectorAll(step.selector || "");
      const items = [];
      const baseUrl = step.base_url || params.base_url || location.origin;
      nodes.forEach((node) => {
        const row = {};
        let skip = false;
        for (const [key, spec] of Object.entries(step.fields || {})) {
          let v = readField({ ...spec, scope: spec.scope || "node" }, node);
          if (spec.attr === "href" || key === "url") {
            v = resolveHref(v, baseUrl);
          }
          if (v && spec.filter_contains && !String(v).includes(spec.filter_contains)) {
            skip = true;
            break;
          }
          row[key] = v;
        }
        if (!skip && Object.values(row).some(Boolean)) items.push(row);
      });
      out[step.into || "items"] = items;
      return out;
    }
    if (action === "eval_json_script") {
      const el = queryOne(step.script_selector || "#vike_pageContext");
      if (!el) throw new Error(`Script node not found: ${step.script_selector}`);
      let data;
      try {
        data = JSON.parse(el.textContent || "");
      } catch (e) {
        throw new Error(`JSON parse failed: ${e.message}`);
      }
      const value = getByPath(data, step.json_path);
      out[step.into || "json"] = value;
      return out;
    }

    throw new Error(`Unknown action: ${action}`);
  }

  async function runSteps(steps, params) {
    const extract = {};
    for (const step of steps || []) {
      const part = await runStep(step, params || {});
      Object.assign(extract, part);
    }
    return extract;
  }

  self.PMScenarioRunner = { runStep, runSteps };
})();
