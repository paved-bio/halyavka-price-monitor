/**
 * Visual XPath picker — клик по элементу на странице.
 */
(function () {
  if (window.__pmPickerActive) {
    window.__pmPickerCleanup?.();
    return;
  }
  window.__pmPickerActive = true;

  const overlay = document.createElement("div");
  overlay.id = "pm-picker-overlay";
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:2147483646;cursor:crosshair;background:rgba(0,0,0,0.05);";

  const highlight = document.createElement("div");
  highlight.style.cssText =
    "position:fixed;border:2px solid #22c55e;background:rgba(34,197,94,0.12);" +
    "pointer-events:none;z-index:2147483647;border-radius:4px;display:none;transition:all 0.05s;";

  const hint = document.createElement("div");
  hint.style.cssText =
    "position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;" +
    "background:#1e40af;color:#fff;padding:10px 16px;border-radius:8px;font:14px system-ui;" +
    "box-shadow:0 4px 12px rgba(0,0,0,0.2);";
  hint.textContent = "Наведите на цену и кликните · Esc — отмена";

  function getXPath(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return "";
    if (el.id && !/\d/.test(el.id)) {
      return '//*[@id="' + el.id.replace(/"/g, '\\"') + '"]';
    }
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === Node.ELEMENT_NODE && cur !== document.body) {
      let idx = 1;
      let sib = cur.previousElementSibling;
      while (sib) {
        if (sib.tagName === cur.tagName) idx++;
        sib = sib.previousElementSibling;
      }
      const tag = cur.tagName.toLowerCase();
      parts.unshift(tag + "[" + idx + "]");
      cur = cur.parentElement;
    }
    return "/" + parts.join("/");
  }

  function cleanup() {
    overlay.remove();
    highlight.remove();
    hint.remove();
    document.removeEventListener("keydown", onKey, true);
    window.__pmPickerActive = false;
    window.__pmPickerCleanup = null;
  }
  window.__pmPickerCleanup = cleanup;

  function onKey(e) {
    if (e.key === "Escape") {
      chrome.runtime.sendMessage({ type: "PICKER_CANCELLED" });
      cleanup();
    }
  }

  overlay.addEventListener("mousemove", (e) => {
    const stack = document.elementsFromPoint(e.clientX, e.clientY);
    const el = stack.find(
      (node) =>
        node !== overlay &&
        node !== highlight &&
        node !== hint &&
        !overlay.contains(node) &&
        node.nodeType === Node.ELEMENT_NODE
    );
    if (!el) return;
    const r = el.getBoundingClientRect();
    highlight.style.display = "block";
    highlight.style.left = r.left + "px";
    highlight.style.top = r.top + "px";
    highlight.style.width = r.width + "px";
    highlight.style.height = r.height + "px";
  });

  overlay.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const stack = document.elementsFromPoint(e.clientX, e.clientY);
    const el = stack.find(
      (node) =>
        node !== overlay &&
        node !== highlight &&
        node !== hint &&
        !overlay.contains(node) &&
        node.nodeType === Node.ELEMENT_NODE
    );
    if (!el) return;
    const xpath = getXPath(el);
    const preview = (el.textContent || "").trim().slice(0, 80);
    const price = typeof PMUtils !== "undefined" ? PMUtils.parsePrice(preview) : null;
    chrome.runtime.sendMessage({
      type: "PICKER_RESULT",
      xpath,
      preview,
      parsed_price: price,
    });
    cleanup();
  });

  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(overlay);
  document.body.appendChild(highlight);
  document.body.appendChild(hint);
})();
