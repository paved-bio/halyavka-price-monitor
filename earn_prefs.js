/** Настройки биржи: пресеты и синхронизация с сервером (UI в popup). */
const EARN_STEALTH_PRESETS = {
  paranoid: {
    preset: "paranoid",
    dwell_multiplier: 1.8,
    max_jobs_per_hour: 4,
    max_jobs_per_day: 15,
    cooldown_same_category_minutes: 45,
    humanize_clicks: true,
    humanize_typing: true,
    humanize_scroll: true,
    mouse_wiggle: true,
  },
  balanced: {
    preset: "balanced",
    dwell_multiplier: 1.0,
    max_jobs_per_hour: 8,
    max_jobs_per_day: 30,
    cooldown_same_category_minutes: 20,
    humanize_clicks: true,
    humanize_typing: true,
    humanize_scroll: true,
    mouse_wiggle: true,
  },
  fast: {
    preset: "fast",
    dwell_multiplier: 0.7,
    max_jobs_per_hour: 20,
    max_jobs_per_day: 80,
    cooldown_same_category_minutes: 5,
    humanize_clicks: false,
    humanize_typing: false,
    humanize_scroll: false,
    mouse_wiggle: false,
  },
};

function earnDefaultStealth() {
  return { ...EARN_STEALTH_PRESETS.balanced };
}

function earnStealthFromForm() {
  const preset = document.getElementById("earn-stealth-preset")?.value || "balanced";
  const base = EARN_STEALTH_PRESETS[preset] || EARN_STEALTH_PRESETS.balanced;
  return {
    preset,
    dwell_multiplier: parseFloat(document.getElementById("earn-stealth-dwell")?.value || String(base.dwell_multiplier)),
    max_jobs_per_day: parseInt(document.getElementById("earn-stealth-daily")?.value || String(base.max_jobs_per_day), 10),
    max_jobs_per_hour: parseInt(document.getElementById("earn-stealth-hourly")?.value || String(base.max_jobs_per_hour), 10),
    cooldown_same_category_minutes: parseInt(
      document.getElementById("earn-stealth-cat-cd")?.value || String(base.cooldown_same_category_minutes),
      10,
    ),
    humanize_clicks: document.getElementById("earn-stealth-humanize-clicks")?.checked !== false,
    humanize_typing: document.getElementById("earn-stealth-humanize-type")?.checked !== false,
    humanize_scroll: document.getElementById("earn-stealth-humanize-scroll")?.checked !== false,
    mouse_wiggle: document.getElementById("earn-stealth-mouse-wiggle")?.checked !== false,
    active_hours_only: document.getElementById("earn-stealth-active-hours")?.checked === true,
  };
}

function earnFillStealthForm(stealth) {
  const st = stealth || earnDefaultStealth();
  const preset = st.preset || "balanced";
  const sel = document.getElementById("earn-stealth-preset");
  if (sel) sel.value = preset in EARN_STEALTH_PRESETS ? preset : "balanced";

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el && val != null) el.value = String(val);
  };
  set("earn-stealth-dwell", st.dwell_multiplier ?? 1);
  set("earn-stealth-daily", st.max_jobs_per_day ?? 30);
  set("earn-stealth-hourly", st.max_jobs_per_hour ?? 8);
  set("earn-stealth-cat-cd", st.cooldown_same_category_minutes ?? 20);

  const cb = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.checked = Boolean(val);
  };
  cb("earn-stealth-humanize-clicks", st.humanize_clicks !== false);
  cb("earn-stealth-humanize-type", st.humanize_typing !== false);
  cb("earn-stealth-humanize-scroll", st.humanize_scroll !== false);
  cb("earn-stealth-mouse-wiggle", st.mouse_wiggle !== false);
  cb("earn-stealth-active-hours", st.active_hours_only === true);
  earnUpdateStealthLabels();
}

function earnUpdateStealthLabels() {
  const pairs = [
    ["earn-stealth-dwell", "earn-stealth-dwell-val", (v) => Number(v).toFixed(1)],
    ["earn-stealth-daily", "earn-stealth-daily-val", (v) => v],
    ["earn-stealth-hourly", "earn-stealth-hourly-val", (v) => v],
    ["earn-stealth-cat-cd", "earn-stealth-cat-cd-val", (v) => v],
  ];
  for (const [inputId, labelId, fmt] of pairs) {
    const input = document.getElementById(inputId);
    const label = document.getElementById(labelId);
    if (input && label) label.textContent = fmt(input.value);
  }
}

function earnApplyPresetToForm() {
  const preset = document.getElementById("earn-stealth-preset")?.value || "balanced";
  earnFillStealthForm(EARN_STEALTH_PRESETS[preset] || EARN_STEALTH_PRESETS.balanced);
}

function earnWireStealthSliders() {
  ["earn-stealth-dwell", "earn-stealth-daily", "earn-stealth-hourly", "earn-stealth-cat-cd"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", earnUpdateStealthLabels);
  });
  document.getElementById("earn-stealth-preset")?.addEventListener("change", earnApplyPresetToForm);
}
