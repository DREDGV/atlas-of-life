// === Atlas v0.2.6 — Today Plus (overlay) ===
(function () {
  const LS_KEY = "atlas_ui_v026";
  const ui = (function () {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || "{}");
    } catch (e) {
      return {};
    }
  })();
  ui.todayOrder = ui.todayOrder || {};

  function saveUI() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(ui));
    } catch (e) {}
  }

  function ensureButton() {
    const bar = document.querySelector("header,.topbar,.toolbar");
    const btn = document.createElement("button");
    btn.textContent = "Сегодня+";
    btn.className = "btn-ics";
    btn.style.marginLeft = "8px";
    btn.addEventListener("click", togglePanel);
    if (bar) bar.appendChild(btn);
    else document.body.appendChild(btn);
  }

  let host = null,
    listEl = null,
    open = false;

  function togglePanel() {
    if (!open) openPanel();
    else closePanel();
  }
  function openPanel() {
    if (!host) {
      host = document.createElement("div");
      host.style.position = "fixed";
      host.style.right = "16px";
      host.style.bottom = "16px";
      host.style.width = "min(680px, 45vw)";
      host.style.maxHeight = "70vh";
      host.style.background = "#0f1320";
      host.style.color = "#e5e7eb";
      host.style.border = "1px solid rgba(255,255,255,0.08)";
      host.style.boxShadow = "0 16px 40px rgba(0,0,0,0.5)";
      host.style.borderRadius = "16px";
      host.style.display = "flex";
      host.style.flexDirection = "column";
      host.style.overflow = "hidden";
      host.style.zIndex = "99999";

      const head = document.createElement("div");
      head.style.display = "flex";
      head.style.alignItems = "center";
      head.style.gap = "8px";
      head.style.padding = "10px 12px";
      head.style.background = "#0b0e17";
      head.innerHTML =
        '<b style="font-size:14px">Сегодня+</b><span style="opacity:.7;font-size:12px">— сортировка по времени/приоритету, перетаскивание</span>';
      const x = document.createElement("button");
      x.textContent = "×";
      x.style.marginLeft = "auto";
      x.className = "btn-ics";
      x.addEventListener("click", closePanel);
      head.appendChild(x);

      listEl = document.createElement("div");
      listEl.style.padding = "8px 8px 12px 8px";
      listEl.style.overflow = "auto";
      listEl.style.flex = "1";

      host.appendChild(head);
      host.appendChild(listEl);
      document.body.appendChild(host);
    }
    open = true;
    host.style.display = "flex";
    render();
  }
  function closePanel() {
    open = false;
    if (host) host.style.display = "none";
  }

  function isSameDay(a, b) {
    const da = new Date(a),
      db = new Date(b);
    return (
      da.getFullYear() === db.getFullYear() &&
      da.getMonth() === db.getMonth() &&
      da.getDate() === db.getDate()
    );
  }
  function getDue(t) {
    if (t.due) return t.due;
    if (t.when && typeof t.when === "object" && t.when.date) return t.when.date;
    return null;
  }

  function pickToday() {
    const now = Date.now();
    const arr = (state.tasks || [])
      .filter((t) => {
        if (!t || t.status === "done") return false;
        if (t.status === "today") return true;
        const due = getDue(t);
        return due && isSameDay(due, now);
      })
      .map((t) => ({ ...t }));
    arr.forEach((t) => {
      t._due = getDue(t);
      t._prio = t.priority ?? 2;
      t._upd = t.updatedAt || 0;
      t._ord = ui.todayOrder[t.id] ?? 0;
    });
    arr.sort((a, b) => {
      const ap = a._ord !== 0,
        bp = b._ord !== 0;
      if (ap !== bp) return ap ? -1 : 1;
      if (ap && bp && a._ord !== b._ord) return a._ord - b._ord;

      const ad = a._due ? 1 : 0,
        bd = b._due ? 1 : 0;
      if (ad !== bd) return bd - ad; // due сначала
      if (a._due && b._due && a._due !== b._due) return a._due - b._due; // ближайшее время
      if (a._prio !== b._prio) return a._prio - b._prio; // p1 выше p2...
      return b._upd - a._upd; // свежее выше
    });
    return arr;
  }

  function render() {
    if (!listEl) return;
    const tasks = pickToday();
    listEl.innerHTML = "";
    if (tasks.length === 0) {
      const empty = document.createElement("div");
      empty.style.opacity = ".75";
      empty.style.padding = "12px";
      empty.textContent =
        "Сегодня пусто. Добавь задачу внизу окна или перенеси из бэклога.";
      listEl.appendChild(empty);
      return;
    }
    tasks.forEach((t) => {
      const row = document.createElement("div");
      row.className = "todayplus-row";
      row.draggable = true;
      row.dataset.id = t.id;
      row.style.display = "flex";
      row.style.alignItems = "center";
      row.style.gap = "10px";
      row.style.padding = "8px 10px";
      row.style.borderRadius = "10px";
      row.style.border = "1px solid rgba(255,255,255,0.06)";
      row.style.margin = "6px 8px";
      row.style.background = "rgba(255,255,255,0.02)";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = t.status === "done";
      cb.addEventListener("change", () => {
        const real = (state.tasks || []).find((x) => x.id === t.id);
        if (real) {
          real.status = cb.checked ? "done" : "today";
          real.updatedAt = Date.now();
        }
        render();
      });
      row.appendChild(cb);

      const title = document.createElement("div");
      title.style.flex = "1";
      const tags = (t.tags || []).map((x) => `#${x}`).join(" ");
      const dueTxt = t._due
        ? new Date(t._due).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "";
      const overdue = t._due && Date.now() - t._due > 60 * 1000;
      title.innerHTML =
        `<div style="font-size:14px">${escapeHtml(t.title || "Без названия")} ${
          tags
            ? `<span class="hint" style="opacity:.7">${escapeHtml(tags)}</span>`
            : ""
        } ${
          dueTxt
            ? `<span class="kbd${
                overdue ? " badge overdue" : ""
              }">${dueTxt}</span>`
            : ""
        }</div>` +
        `<div class="hint" style="opacity:.7">${
          t.estimateMin ? "~" + t.estimateMin + "м" : " "
        }</div>`;
      row.appendChild(title);

      const edit = document.createElement("button");
      edit.textContent = "✎";
      edit.title = "Переименовать";
      edit.className = "btn-ics";
      edit.addEventListener("click", () => {
        const real = (state.tasks || []).find((x) => x.id === t.id);
        const v = prompt(
          "Новое название задачи:",
          real?.title || t.title || ""
        );
        if (v != null && real) {
          real.title = String(v).trim();
          real.updatedAt = Date.now();
          render();
        }
      });
      row.appendChild(edit);

      const handle = document.createElement("span");
      handle.textContent = "⋮⋮";
      handle.style.cursor = "grab";
      handle.style.opacity = ".7";
      row.appendChild(handle);

      row.addEventListener("dragstart", (ev) => {
        ev.dataTransfer.setData("text/plain", t.id);
        row.style.opacity = ".5";
      });
      row.addEventListener("dragend", () => (row.style.opacity = "1"));
      row.addEventListener("dragover", (ev) => ev.preventDefault());
      row.addEventListener("drop", (ev) => {
        ev.preventDefault();
        const dragId = ev.dataTransfer.getData("text/plain");
        if (!dragId || dragId === t.id) return;
        const order = tasks.map((x) => x.id);
        const from = order.indexOf(dragId),
          to = order.indexOf(t.id);
        if (from < 0 || to < 0) return;
        const base = 10;
        const newOrder = {};
        order.splice(to, 0, order.splice(from, 1)[0]);
        order.forEach((id, i) => (newOrder[id] = (i + 1) * base));
        ui.todayOrder = newOrder;
        saveUI();
        render();
      });

      listEl.appendChild(row);
    });
  }

  function escapeHtml(s) {
    return String(s || "").replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
    );
  }

  document.addEventListener("DOMContentLoaded", () => {
    ensureButton();
    setInterval(() => {
      if (open) render();
    }, 15000);
  });
})();
