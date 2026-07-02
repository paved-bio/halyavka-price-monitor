/** JSON как Python json.dumps(..., sort_keys=True, ensure_ascii=False) — для подписи earn-отчётов. */
function pythonSortJson(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map((v) => pythonSortJson(v)).join(", ") + "]";
  }
  const keys = Object.keys(value).sort();
  return (
    "{" +
    keys.map((k) => JSON.stringify(k) + ": " + pythonSortJson(value[k])).join(", ") +
    "}"
  );
}

function proofFingerprintCanonical(proof, payload) {
  return pythonSortJson({ proof: proof || {}, payload: payload || {} });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { pythonSortJson, proofFingerprintCanonical };
}
if (typeof self !== "undefined") {
  self.pythonSortJson = pythonSortJson;
  self.proofFingerprintCanonical = proofFingerprintCanonical;
}
