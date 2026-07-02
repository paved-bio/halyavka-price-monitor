/** API base URL — переопределяется через chrome.storage.local.api_base */
const PM_API_DEFAULT = "https://halyavka.online/api/v1";

async function pmGetApiBase() {
  try {
    const data = await chrome.storage.local.get(["api_base"]);
    return data.api_base || PM_API_DEFAULT;
  } catch (_) {
    return PM_API_DEFAULT;
  }
}

async function pmApiUrl(path) {
  const base = await pmGetApiBase();
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}
