/**
 * Визуальная метка вкладки во время задачи (воркер / авантюрист).
 * Пользователь видит, что расширение работает только сейчас и только здесь.
 */
(function () {
  const MODE = self.PM_JOB_OVERLAY_MODE || "task";
  const LABEL =
    MODE === "earn"
      ? "Халявка · задача биржи"
      : MODE === "monitor"
        ? "Халявка · проверка цены"
        : "Халявка · задача";

  if (document.getElementById("pm-job-overlay")) return;

  const bar = document.createElement("div");
  bar.id = "pm-job-overlay";
  bar.setAttribute("data-pm-job", "1");
  bar.style.cssText = [
    "position:fixed",
    "top:0",
    "left:0",
    "right:0",
    "z-index:2147483646",
    "background:linear-gradient(90deg,#1e4d6b,#3d8f82)",
    "color:#fff",
    "font:600 13px/1.3 system-ui,sans-serif",
    "padding:8px 12px",
    "box-shadow:0 2px 8px rgba(0,0,0,.25)",
    "pointer-events:none",
  ].join(";");
  bar.textContent =
    "⏳ " +
    LABEL +
    " — расширение активно только на этой вкладке. Пароли и файлы не читаются.";

  const prevTitle = document.title;
  document.title = "⏳ " + LABEL + " · " + prevTitle.replace(/^⏳\s*/, "");

  if (document.body) {
    document.body.prepend(bar);
  } else {
    document.addEventListener("DOMContentLoaded", () => document.body.prepend(bar));
  }

  self.PM_JOB_OVERLAY_CLEANUP = function () {
    bar.remove();
    document.title = prevTitle;
  };
})();
