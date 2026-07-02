const parsePrice = PMUtils.parsePrice;

function scanJsonForEAN(obj, depth) {
  if (depth > 6 || obj == null) return null;
  if (typeof obj === "string") {
    const m = obj.match(/^\d{8,14}$/);
    return m ? m[0] : null;
  }
  if (typeof obj !== "object") return null;
  for (const k of ["barcode", "ean", "gtin", "gtin13"]) {
    if (obj[k] != null) {
      const v = String(obj[k]).replace(/\D/g, "");
      if (v.length >= 8 && v.length <= 14) return v;
    }
  }
  for (const v of Object.values(obj)) {
    const found = scanJsonForEAN(v, depth + 1);
    if (found) return found;
  }
  return null;
}

function extractEAN() {
  if (window.__NUXT__?.data) {
    const ean = scanJsonForEAN(window.__NUXT__.data, 0);
    if (ean) return ean;
  }
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(script.textContent);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const gtin = item.gtin13 || item.gtin12 || item.gtin;
        if (gtin) return String(gtin).replace(/\D/g, "");
      }
    } catch (_) {
      /* ignore */
    }
  }
  return null;
}

function extractTitle() {
  return document.querySelector("h1")?.textContent?.trim().slice(0, 200) || null;
}

function extractPriceByXPath(xpath) {
  const node = document.evaluate(
    xpath,
    document,
    null,
    XPathResult.FIRST_ORDERED_NODE_TYPE,
    null
  ).singleNodeValue;

  if (!node) return { raw: "", price: null };

  const raw = (node.textContent || node.nodeValue || "").trim();
  return { raw, price: parsePrice(raw) };
}

chrome.storage.session.get(["parse_xpath"], (data) => {
  const xpath = data.parse_xpath;
  if (!xpath) {
    chrome.runtime.sendMessage({ error: "XPath не задан" });
    return;
  }

  try {
    const { raw, price } = extractPriceByXPath(xpath);
    chrome.runtime.sendMessage({
      raw,
      price,
      ean: extractEAN(),
      title: extractTitle(),
    });
  } catch (err) {
    chrome.runtime.sendMessage({ error: err.message });
  }
});
