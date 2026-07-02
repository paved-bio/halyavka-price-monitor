/**
 * Challenge-response для earn integrity ping (отдельный от scenario_runner).
 */
(function () {
  const BUILD = "20250627a";

  function solveOps(ops) {
    return (ops || []).map((op) => {
      const a = Number(op.a) || 0;
      const b = Number(op.b) || 0;
      if (op.op === "add") return a + b;
      if (op.op === "mul") return a * b;
      if (op.op === "sub") return a - b;
      return 0;
    });
  }

  function sortKeysDeep(value) {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(sortKeysDeep);
    return Object.keys(value)
      .sort()
      .reduce((acc, k) => {
        acc[k] = sortKeysDeep(value[k]);
        return acc;
      }, {});
  }

  async function sha256Hex(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function hmacHex(key, message) {
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(key),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
    return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function pongMessage(body) {
    const payload = {
      answers: body.answers || [],
      build: body.build,
      canary: body.canary,
      challenge_id: body.challenge_id,
      manifest_version: body.manifest_version,
    };
    if (typeof pythonSortJson === "function") {
      return pythonSortJson(payload);
    }
    return JSON.stringify(sortKeysDeep(payload));
  }

  async function buildPong(challenge, integrityKey) {
    const answers = solveOps(challenge.ops);
    const manifestVersion =
      typeof chrome !== "undefined" && chrome.runtime?.getManifest
        ? chrome.runtime.getManifest().version
        : "0";
    const body = {
      challenge_id: challenge.challenge_id,
      canary: challenge.canary,
      answers,
      build: BUILD,
      manifest_version: manifestVersion,
    };
    const sig = await hmacHex(integrityKey, pongMessage(body));
    return { ...body, sig };
  }

  const api = { buildPong, solveOps, BUILD, pongMessage };
  if (typeof self !== "undefined") self.PMIntegrity = api;
  if (typeof globalThis !== "undefined") globalThis.PMIntegrity = api;
})();
