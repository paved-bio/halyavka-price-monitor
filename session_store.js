/** Сохранение привязки Telegram при обновлении расширения. */
async function pmPersistSession() {
  const { session_token, tg_id } = await chrome.storage.local.get([
    "session_token",
    "tg_id",
  ]);
  if (!session_token || !tg_id) return;
  await chrome.storage.sync.set({
    session_token,
    tg_id,
    session_saved_at: Date.now(),
  });
}

async function pmRestoreSession() {
  const local = await chrome.storage.local.get(["session_token", "tg_id"]);
  if (local.session_token && local.tg_id) return local;

  const sync = await chrome.storage.sync.get(["session_token", "tg_id"]);
  if (sync.session_token && sync.tg_id) {
    await chrome.storage.local.set({
      session_token: sync.session_token,
      tg_id: sync.tg_id,
    });
    return sync;
  }
  return null;
}
