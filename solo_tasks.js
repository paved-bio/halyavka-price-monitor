/**
 * Локальные задачи для Соло-режима (chrome.storage.local).
 */
const SoloTasks = {
  storageKey: "solo_tasks",

  async list() {
    const { solo_tasks } = await chrome.storage.local.get([this.storageKey]);
    return Array.isArray(solo_tasks) ? solo_tasks : [];
  },

  async saveAll(tasks) {
    await chrome.storage.local.set({ [this.storageKey]: tasks });
  },

  async add({ shop_id, product_id, target_price, title, source_url, monitor_type }) {
    const tasks = await this.list();
    const task = {
      id: `solo_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      shop_id,
      product_id,
      target_price: Number(target_price) || 0,
      title: title || "",
      source_url: source_url || "",
      monitor_type: monitor_type || "price_drop",
      last_price: null,
      added_at: new Date().toISOString(),
    };
    tasks.push(task);
    await this.saveAll(tasks);
    return task;
  },

  async remove(id) {
    const tasks = (await this.list()).filter((t) => t.id !== id);
    await this.saveAll(tasks);
  },

  async update(id, patch) {
    const tasks = await this.list();
    const idx = tasks.findIndex((t) => t.id === id);
    if (idx < 0) return null;
    tasks[idx] = { ...tasks[idx], ...patch };
    await this.saveAll(tasks);
    return tasks[idx];
  },
};

if (typeof module !== "undefined") module.exports = { SoloTasks };
