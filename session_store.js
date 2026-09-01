/** Session stays in chrome.storage.local only (not sync — avoids token on other devices). */
async function pmPersistSession() {
  const { session_token, tg_id } = await chrome.storage.local.get([
    "session_token",
    "tg_id",
  ]);
  if (!session_token || !tg_id) return;
  // Wipe legacy sync copies if any (older builds mirrored the token).
  try {
    await chrome.storage.sync.remove(["session_token", "tg_id", "session_saved_at"]);
  } catch (_) {
    /* sync may be unavailable */
  }
}

async function pmRestoreSession() {
  const local = await chrome.storage.local.get(["session_token", "tg_id"]);
  if (local.session_token && local.tg_id) {
    try {
      await chrome.storage.sync.remove(["session_token", "tg_id", "session_saved_at"]);
    } catch (_) {
      /* ignore */
    }
    return local;
  }

  // One-time migrate from old sync storage, then clear sync.
  try {
    const sync = await chrome.storage.sync.get(["session_token", "tg_id"]);
    if (sync.session_token && sync.tg_id) {
      await chrome.storage.local.set({
        session_token: sync.session_token,
        tg_id: sync.tg_id,
      });
      await chrome.storage.sync.remove(["session_token", "tg_id", "session_saved_at"]);
      return { session_token: sync.session_token, tg_id: sync.tg_id };
    }
  } catch (_) {
    /* ignore */
  }
  return null;
}

async function pmClearSessionLocal() {
  await chrome.storage.local.remove([
    "session_token",
    "tg_id",
    "can_earn",
    "can_use_referrals",
    "earn_integrity_key",
    "tracker_mode",
  ]);
  try {
    await chrome.storage.sync.remove(["session_token", "tg_id", "session_saved_at"]);
  } catch (_) {
    /* ignore */
  }
}
