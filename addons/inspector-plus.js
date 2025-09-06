// === Atlas v0.2.6 — Inspector helpers (minimal) ===
(function () {
  if (!window.Atlas) window.Atlas = {};
  Atlas.renameTask = function (id) {
    if (!window.state || !Array.isArray(state.tasks)) return;
    const t = state.tasks.find((x) => x.id === id);
    if (!t) return;
    const v = prompt("Новое название задачи:", t.title || "");
    if (v != null) {
      t.title = String(v).trim();
      t.updatedAt = Date.now();
    }
  };
})();
