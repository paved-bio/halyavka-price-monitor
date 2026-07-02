/**
 * Имитация человеческого ввода: клики, скролл, набор текста.
 * Конфиг: self.PMStealthConfig с сервера (earn job / preferences).
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

  function cfg() {
    return self.PMStealthConfig || {};
  }

  function dispatchMouse(el, type, x, y) {
    el.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: x,
        clientY: y,
      }),
    );
  }

  async function wiggleMouse(el) {
    const c = cfg();
    if (!c.mouse_wiggle) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    for (let i = 0; i < randBetween(1, 3); i++) {
      dispatchMouse(el, "mousemove", cx + randBetween(-8, 8), cy + randBetween(-6, 6));
      await sleep(randBetween(40, 120));
    }
  }

  async function humanClick(el) {
    const c = cfg();
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width * (0.3 + Math.random() * 0.4);
    const y = rect.top + rect.height * (0.3 + Math.random() * 0.4);
    const hesitate = c.click_hesitation_ms || [200, 700];
    await wiggleMouse(el);
    await sleep(randBetween(hesitate[0], hesitate[1]));
    dispatchMouse(el, "mouseover", x, y);
    dispatchMouse(el, "mousemove", x, y);
    await sleep(randBetween(30, 90));
    dispatchMouse(el, "mousedown", x, y);
    await sleep(randBetween(40, 120));
    dispatchMouse(el, "mouseup", x, y);
    el.click();
    await sleep(randBetween(120, 350));
  }

  async function humanScroll(deltaY, stepOpts) {
    const c = cfg();
    const stepsMin = stepOpts?.scroll_steps_min ?? c.scroll_steps_min ?? 2;
    const stepsMax = stepOpts?.scroll_steps_max ?? c.scroll_steps_max ?? 5;
    const steps = randBetween(stepsMin, stepsMax);
    const total = deltaY || 300;
    const per = Math.round(total / steps);
    for (let i = 0; i < steps; i++) {
      const dy = per + randBetween(-20, 20);
      window.scrollBy({ top: dy, left: 0, behavior: "smooth" });
      await sleep(randBetween(180, 520));
    }
    await sleep(randBetween(200, 500));
  }

  function isEditable(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = (el.tagName || "").toLowerCase();
    return tag === "textarea" || (tag === "input" && /^(text|search|email|tel|url)?$/i.test(el.type || "text"));
  }

  async function humanType(el, text, step) {
    const c = cfg();
    const delays = c.typing_delay_ms || [60, 180];
    const clear = step?.clear !== false;
    el.focus();
    await sleep(randBetween(100, 300));

    if (el.isContentEditable) {
      if (clear) el.textContent = "";
      for (const ch of String(text)) {
        el.textContent += ch;
        el.dispatchEvent(new InputEvent("input", { bubbles: true, data: ch, inputType: "insertText" }));
        await sleep(randBetween(delays[0], delays[1]));
      }
    } else if (isEditable(el)) {
      if (clear) {
        el.value = "";
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
      for (const ch of String(text)) {
        el.value += ch;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        await sleep(randBetween(delays[0], delays[1]));
      }
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      el.textContent = text;
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
    await sleep(randBetween(150, 400));
  }

  self.PMHumanize = { humanClick, humanScroll, humanType, sleep, randBetween };
})();
