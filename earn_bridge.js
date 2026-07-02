/** Мост session_token → /earn/ на том же домене. */
chrome.storage.local.get(["session_token"], ({ session_token }) => {
  if (!session_token) return;
  window.postMessage(
    { type: "PM_SESSION_TOKEN", session_token },
    window.location.origin
  );
});
