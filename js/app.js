// js/app.js
import { state, $, $$, initDemoData } from "./state.js";
import { loadState, saveState, exportJson, importJsonV26 as importJson } from "./storage.js";
import {
  initMap,
  layoutMap,
  drawMap,
  centerView,
  fitActiveDomain,
  fitActiveProject,
  resetView,
  setShowFps,
  undoLastMove,
} from "./view_map.js";
import { renderToday } from "./view_today.js";
import { parseQuick } from "./parser.js";
import { logEvent } from "./utils/analytics.js";

// I18N
const I18N = {
  views: { map: "Карта", today: "Сегодня" },
  sidebar: { domains: "Домены", filters: "Фильтры" },
  hints: { quick: "Шорткаты: #тег @проект !сегодня 10:00 ~30м" },
  actions: { export: "Экспорт", import: "Импорт" },
  toggles: {
    links: "Связи",
    aging: "Давность",
    glow: "Свечение",
    edges: "Рёбра",
  },
  wip: (cur, lim) => `WIP: ${cur} / ${lim}`,
  errors: { import: "Не удалось импортировать JSON: " },
  defaults: { taskTitle: "Новая задача" },
};
window.I18N = I18N;

// Expose state globally for addons compatibility
try { window.state = state; } catch (_) {}

// App version (SemVer-like label used in UI)
let APP_VERSION = "Atlas_of_life_v0.2.7.8";

// ephemeral UI state
const ui = {
  newDomain: false,
  newDomColor: "#2dd4bf",
  newDomDraft: "",
  newDomError: "",
};
const palette = [
  "#2dd4bf",
  "#f59e0b",
  "#60a5fa",
  "#a78bfa",
  "#ef4444",
  "#10b981",
  "#f472b6",
  "#eab308",
];

// simple modal helpers
function openModal({
  title,
  bodyHTML,
  onConfirm,
  confirmText = "Ок",
  cancelText = "Отмена",
}) {
  const modal = document.getElementById("modal");
  document.getElementById("modalTitle").textContent = title || "Диалог";
  document.getElementById("modalBody").innerHTML = bodyHTML || "";
  const btnOk = document.getElementById("modalOk");
  const btnCancel = document.getElementById("modalCancel");
  btnOk.textContent = confirmText;
  document.getElementById("modalCancel").textContent = cancelText;
  function close() {
    modal.style.display = "none";
    btnOk.onclick = null;
    btnCancel.onclick = null;
  }
  btnCancel.onclick = () => close();
  btnOk.onclick = () => {
    try {
      onConfirm && onConfirm(document.getElementById("modalBody"));
    } finally {
      close();
    }
  };
  modal.style.display = "flex";
}

// toast helper
function showToast(text, cls = "ok", ms = 2500) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.className = "toast " + (cls || "");
  el.textContent = text;
  el.style.display = "block";
  el.style.opacity = "1";
  setTimeout(() => {
    el.style.transition = "opacity .3s linear";
    el.style.opacity = "0";
    setTimeout(() => {
      el.style.display = "none";
      el.style.transition = "";
    }, 320);
  }, ms);
}
// expose globally for addons/other modules
try { window.showToast = showToast; } catch (_) {}

// Calculate statistics for sidebar
function calculateStats() {
  const tasks = state.tasks || [];
  return {
    totalTasks: tasks.length,
    backlog: tasks.filter(t => t.status === 'backlog').length,
    today: tasks.filter(t => t.status === 'today').length,
    doing: tasks.filter(t => t.status === 'doing').length,
    done: tasks.filter(t => t.status === 'done').length
  };
}

// Highlight search results on the map
function highlightSearchResults(query, domains, projects, tasks) {
  // This will be used to highlight matching nodes on the map
  // For now, we'll store the search results in state for map rendering
  state.searchResults = {
    domains: domains.map(d => d.id),
    projects: projects.map(p => p.id),
    tasks: tasks.map(t => t.id)
  };
}

function renderSidebar() {
  const dWrap = document.getElementById("domainsList");
  let html = "";
  
  // Search bar
  html += `<div class="search-section" style="padding:8px 12px;border-bottom:1px solid var(--panel-2)">
    <input id="sidebarSearch" placeholder="🔍 Поиск доменов, проектов, задач..." 
           style="width:100%;padding:6px 8px;background:var(--panel-2);border:1px solid var(--panel-2);border-radius:6px;color:var(--text);font-size:12px;outline:none"/>
  </div>`;
  
  // Statistics section
  const sidebarStats = calculateStats();
  html += `<div class="stats-section" style="padding:8px 12px;border-bottom:1px solid var(--panel-2)">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
      <span style="font-size:11px;color:var(--muted);font-weight:600">СТАТИСТИКА</span>
      <span style="font-size:10px;color:var(--muted)">${sidebarStats.totalTasks} задач</span>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <div class="stat-pill" style="background:rgba(157,177,201,0.1);color:var(--muted);padding:2px 6px;border-radius:4px;font-size:10px">план: ${sidebarStats.backlog}</div>
      <div class="stat-pill" style="background:rgba(242,201,76,0.15);color:var(--warn);padding:2px 6px;border-radius:4px;font-size:10px">сегодня: ${sidebarStats.today}</div>
      <div class="stat-pill" style="background:rgba(86,204,242,0.15);color:var(--accent);padding:2px 6px;border-radius:4px;font-size:10px">в работе: ${sidebarStats.doing}</div>
      <div class="stat-pill" style="background:rgba(25,195,125,0.15);color:var(--ok);padding:2px 6px;border-radius:4px;font-size:10px">готово: ${sidebarStats.done}</div>
    </div>
  </div>`;
  
  if (ui.newDomain) {
    html += `<div class="row" id="newDomRow" style="gap:6px;flex-wrap:wrap">
      <input id="newDomName" placeholder="Название домена" style="flex:1;min-width:140px;background:#0e172a;border:1px solid #1a2947;border-radius:8px;color:#e8f0fb;padding:6px 8px"/>
      <div id="newDomColors" style="display:flex;gap:6px;align-items:center">${palette
        .map(
          (c) =>
            `<div class="dot" data-col="${c}" style="width:14px;height:14px;border:1px solid #1e2a44;background:${c};border-radius:999px;cursor:pointer${
              c === ui.newDomColor ? ";outline:2px solid #fff5" : ""
            }"></div>`
        )
        .join("")}</div>
      <button class="btn" id="newDomSave">Создать</button>
      <button class="btn" id="newDomCancel">Отмена</button>
    </div>`;
  } else {
    html += `<div class="row"><button class="btn" id="btnAddDomain">+ Домен</button></div>`;
  }
  html += state.domains
    .map((d) => {
      const projects = state.projects.filter((p) => p.domainId === d.id);
      const projectCount = projects.length;
      const taskCount = state.tasks.filter(t => {
        if (t.projectId) {
          return projects.some(p => p.id === t.projectId);
        }
        return t.domainId === d.id;
      }).length;
      
      let __active = false;
      try {
        const ds = state.activeDomains;
        if (ds && (Array.isArray(ds) ? ds.length : ds.size)) {
          const ids = new Set(Array.isArray(ds) ? ds : Array.from(ds));
          __active = ids.has(d.id);
        } else {
          __active = state.activeDomain === d.id;
        }
      } catch (_) {}
      const act = __active
        ? 'style="background:#111a23;border:1px solid #1e2a44"'
        : "";
      const color = d.color || "#2dd4bf";
      return `<div class="row" data-domain="${d.id}" ${act}>
      <div class="dot" style="background:${color}"></div>
      <div style="flex:1;min-width:0">
        <div class="title" style="font-weight:500;margin-bottom:2px">${d.title}</div>
        <div style="display:flex;gap:8px;font-size:10px;color:var(--muted)">
          <span>${projectCount} проектов</span>
          <span>${taskCount} задач</span>
        </div>
      </div>
      <div class="hint actions" data-dom="${d.id}" style="cursor:pointer;padding:4px">⋯</div>
    </div>`;
    })
    .join("");
  dWrap.innerHTML = html;

  // handlers
  const addBtn = document.getElementById("btnAddDomain");
  if (addBtn) {
    addBtn.onclick = () => {
      ui.newDomain = true;
      renderSidebar();
      const inp = $("#newDomName");
      inp && inp.focus();
    };
  }
  const row = document.getElementById("newDomRow");
  if (row) {
    const nameInput = $("#newDomName");
    if (nameInput) {
      nameInput.value = ui.newDomDraft || "";
      nameInput.placeholder = "Введите название домена";
      nameInput.focus();
    }
    // localize and add hint
    const btnSave = document.getElementById("newDomSave");
    if (btnSave) btnSave.textContent = "Сохранить";
    const btnCancel = document.getElementById("newDomCancel");
    if (btnCancel) btnCancel.textContent = "Отмена";
    let hint = document.getElementById("newDomHint");
    if (!hint) {
      hint = document.createElement("div");
      hint.id = "newDomHint";
      hint.className = "hint";
      hint.style.width = "100%";
      row.appendChild(hint);
    }
    hint.textContent = ui.newDomError || "";
    $("#newDomColors")
      .querySelectorAll(".dot")
      .forEach((el) => {
        el.onclick = () => {
          ui.newDomColor = el.dataset.col;
          renderSidebar();
        };
      });
    function createDomain() {
      const name = (nameInput.value || "").trim();
      if (!name) {
        alert("Введите название домена");
        return;
      }
      if (
        state.domains.some((d) => d.title.toLowerCase() === name.toLowerCase())
      ) {
        alert("Такой домен уже есть");
        return;
      }
      const id = "d" + Math.random().toString(36).slice(2, 8);
      state.domains.push({
        id,
        title: name,
        color: ui.newDomColor,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      state.activeDomain = id;
      ui.newDomain = false;
      ui.newDomDraft = "";
      saveState();
      renderSidebar();
      if (window.layoutMap) window.layoutMap();
      if (window.drawMap) window.drawMap();
      fitActiveDomain();
    }
    $("#newDomSave").onclick = () => createDomain();
    $("#newDomCancel").onclick = () => {
      ui.newDomain = false;
      ui.newDomDraft = "";
      renderSidebar();
    };
    nameInput.addEventListener("input", () => {
      ui.newDomDraft = nameInput.value;
      let err = "";
      const n = (nameInput.value || "").trim();
      if (!n) err = "Введите название домена";
      else if (
        state.domains.some((d) => d.title.toLowerCase() === n.toLowerCase())
      )
        err = "Такой домен уже существует";
      ui.newDomError = err;
      if (hint) hint.textContent = err;
    });
    // override save with soft validation + toast
    if (btnSave) {
      btnSave.onclick = () => {
        const n = (nameInput.value || "").trim();
        let err = "";
        if (!n) err = "Введите название домена";
        else if (
          state.domains.some((d) => d.title.toLowerCase() === n.toLowerCase())
        )
          err = "Такой домен уже существует";
        ui.newDomError = err;
        if (hint) hint.textContent = err;
        if (err) return;
        const id = "d" + Math.random().toString(36).slice(2, 8);
        state.domains.push({
          id,
          title: n,
          color: ui.newDomColor,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        state.activeDomain = id;
        ui.newDomain = false;
        ui.newDomDraft = "";
        saveState();
        renderSidebar();
        layoutMap();
        drawMap();
        fitActiveDomain();
        showToast(`Создан домен: ${n}`, "ok");
      };
    }
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        createDomain();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        ui.newDomain = false;
        ui.newDomDraft = "";
        renderSidebar();
      }
    });
  }
  dWrap.querySelectorAll(".row[data-domain]").forEach((el) => {
    const id = el.dataset.domain;
    el.onclick = (ev) => {
      if (ev && (ev.ctrlKey || ev.metaKey || ev.shiftKey)) {
        // toggle multiselect list
        let ds = state.activeDomains;
        if (!ds) ds = state.activeDomains = [];
        const arr = Array.isArray(ds) ? ds : Array.from(ds);
        const set = new Set(arr);
        if (set.has(id)) set.delete(id);
        else set.add(id);
        state.activeDomains = Array.from(set);
        state.activeDomain = null;
        renderSidebar();
        layoutMap();
        drawMap();
        try { window.mapApi && window.mapApi.fitAll && window.mapApi.fitAll(); } catch(_){}
        return;
      }
      state.activeDomain = id;
      try { state.activeDomains = []; } catch(_){}
      renderSidebar();
      if (window.layoutMap) window.layoutMap();
      if (window.drawMap) window.drawMap();
      fitActiveDomain();
    };
    el.ondblclick = () => {
      state.activeDomain = id;
      layoutMap();
      drawMap();
      fitActiveDomain();
    };
    const actions = el.querySelector(".actions");
    actions.onclick = (e) => {
      e.stopPropagation();
      openDomainMenuX(id, el);
    };
    el.oncontextmenu = (e) => {
      e.preventDefault();
      openDomainMenuX(id, el);
    };
  });

  // Status filters
  const filterStats = calculateStats();
  const statusFilters = [
    { key: 'all', label: 'Все', count: filterStats.totalTasks, color: 'var(--muted)' },
    { key: 'backlog', label: 'План', count: filterStats.backlog, color: 'var(--muted)' },
    { key: 'today', label: 'Сегодня', count: filterStats.today, color: 'var(--warn)' },
    { key: 'doing', label: 'В работе', count: filterStats.doing, color: 'var(--accent)' },
    { key: 'done', label: 'Готово', count: filterStats.done, color: 'var(--ok)' }
  ];
  
  const statusWrap = document.getElementById("tagsList");
  statusWrap.innerHTML = statusFilters.map(status => 
    `<div class="tag ${state.filterStatus === status.key ? "active" : ""}" 
          data-status="${status.key}" 
          style="border-color:${status.color};color:${status.color}">
      ${status.label} (${status.count})
    </div>`
  ).join("");
  
  // Status filter handlers
  statusWrap.querySelectorAll(".tag[data-status]").forEach((el) => {
    el.onclick = () => {
      const val = el.dataset.status === 'all' ? null : el.dataset.status;
      state.filterStatus = val;
      renderSidebar();
      if (window.layoutMap) window.layoutMap();
      if (window.drawMap) window.drawMap();
    };
  });
  
  // Tags section
  const allTags = [
    ...new Set(
      state.tasks
        .flatMap((t) => t.tags)
        .concat(state.projects.flatMap((p) => p.tags))
    ),
  ].sort();
  
  if (allTags.length > 0) {
    statusWrap.innerHTML += `<div style="margin-top:8px;font-size:11px;color:var(--muted);font-weight:600">ТЕГИ</div>`;
    statusWrap.innerHTML += allTags
      .map(
        (t) =>
          `<div class="tag ${
            state.filterTag === t ? "active" : ""
          }" data-tag="${t}">#${t}</div>`
      )
      .join("");
  }
  
  // Tag handlers
  if (allTags.length > 0) {
    statusWrap.querySelectorAll(".tag[data-tag]").forEach((el) => {
      el.onclick = () => {
        const val = el.dataset.tag || null;
        state.filterTag = val;
        renderSidebar();
        layoutMap();
        drawMap();
      };
    });
  }
  
  // Search functionality
  const searchInput = document.getElementById("sidebarSearch");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      const query = e.target.value.toLowerCase().trim();
      if (query.length === 0) {
        // Clear search - show all
        state.searchQuery = null;
        renderSidebar();
        layoutMap();
        drawMap();
        return;
      }
      
      // Filter domains, projects, and tasks
      const filteredDomains = state.domains.filter(d => 
        d.title.toLowerCase().includes(query)
      );
      const filteredProjects = state.projects.filter(p => 
        p.title.toLowerCase().includes(query)
      );
      const filteredTasks = state.tasks.filter(t => 
        t.title.toLowerCase().includes(query) ||
        (t.tags || []).some(tag => tag.toLowerCase().includes(query))
      );
      
      // Highlight search results
      highlightSearchResults(query, filteredDomains, filteredProjects, filteredTasks);
      
      // Update filter to show only matching items
      state.searchQuery = query;
      renderSidebar();
      if (window.layoutMap) window.layoutMap();
      if (window.drawMap) window.drawMap();
    });
    
    // Clear search on Escape
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.target.value = "";
        state.searchQuery = null;
        renderSidebar();
        layoutMap();
        drawMap();
      }
    });
  }
}

let currentMenu = null;
function closeDomainMenu() {
  if (currentMenu && currentMenu.remove) {
    currentMenu.remove();
    currentMenu = null;
    document.removeEventListener("click", onDocClick, true);
  }
}
function onDocClick(e) {
  if (currentMenu && !currentMenu.contains(e.target)) closeDomainMenu();
}
/* legacy, unused */ function openDomainMenu_old(id, rowEl) {
  closeDomainMenu();
  const d = state.domains.find((x) => x.id === id);
  const menu = document.createElement("div");
  menu.className = "domenu";
  menu.innerHTML = `
    <div class="item" data-act="focus">Фокус</div>
    <div class="item" data-act="rename">Переименовать</div>
    <div class="item" data-act="color">Цвет</div>
    <div class="palette" style="display:none">${palette
      .map(
        (c) => `<div class="dot" data-col="${c}" style="background:${c}"></div>`
      )
      .join("")}</div>
    <div class="item" data-act="merge">Слить с…</div>
    <div class="sep"></div>
    <div class="item" data-act="delete" style="color:#ffd1d1">Удалить</div>
  `;
  rowEl.insertAdjacentElement("afterend", menu);
  currentMenu = menu;
  document.addEventListener("click", onDocClick, true);
  menu.querySelectorAll(".item").forEach((it) => {
    it.onclick = (e) => {
      const act = it.dataset.act;
      if (act === "focus") {
        state.activeDomain = id;
        layoutMap();
        drawMap();
        fitActiveDomain();
        closeDomainMenu();
        return;
      }
      if (act === "rename") {
        const name = prompt("Новое имя домена:", d.title) || "";
        const trimmed = name.trim();
        if (!trimmed) return;
        if (
          state.domains.some(
            (x) =>
              x.id !== id && x.title.toLowerCase() === trimmed.toLowerCase()
          )
        ) {
          alert("Такой домен уже есть");
          return;
        }
        d.title = trimmed;
        d.updatedAt = Date.now();
        saveState();
        renderSidebar();
        layoutMap();
        drawMap();
        closeDomainMenu();
        return;
      }
      if (act === "color") {
        const pal = menu.querySelector(".palette");
        pal.style.display = pal.style.display === "none" ? "flex" : "none";
        pal.querySelectorAll(".dot").forEach((dot) => {
          dot.onclick = () => {
            d.color = dot.dataset.col;
            d.updatedAt = Date.now();
            saveState();
            renderSidebar();
            layoutMap();
            drawMap();
            closeDomainMenu();
          };
        });
        return;
      }
      if (act === "merge") {
        const others = state.domains.filter((x) => x.id !== id);
        if (others.length === 0) {
          alert("Нет других доменов для слияния");
          return;
        }
        const body = `<label>Перенести проекты в:</label> <select id="selDom">${others
          .map((o) => `<option value="${o.id}">${o.title}</option>`)
          .join("")}</select>`;
        openModal({
          title: `Слить домен "${d.title}"`,
          bodyHTML: body,
          confirmText: "Слить",
          onConfirm: (bodyEl) => {
            const targetId = bodyEl.querySelector("#selDom").value;
            const target = state.domains.find((x) => x.id === targetId);
            if (!target || target.id === id) return;
            state.projects.forEach((p) => {
              if (p.domainId === id) p.domainId = target.id;
            });
            state.domains = state.domains.filter((x) => x.id !== id);
            state.activeDomain = target.id;
            saveState();
            renderSidebar();
            layoutMap();
            drawMap();
            fitActiveDomain();
            closeDomainMenu();
          },
        });
        return;
      }
      if (act === "delete") {
        if (state.domains.length <= 1) {
          alert("Нельзя удалить последний домен");
          return;
        }
        const others = state.domains.filter((x) => x.id !== id);
        const body = `
          <div style="display:flex;flex-direction:column;gap:8px">
            <label><input type="radio" name="mode" value="move" checked/> Перенести проекты в:</label>
            <select id="selDom">${others
              .map((o) => `<option value="${o.id}">${o.title}</option>`)
              .join("")}</select>
            <label><input type="radio" name="mode" value="delete"/> Удалить вместе с проектами и задачами</label>
          </div>`;
        openModal({
          title: `Удалить домен "${d.title}"?`,
          bodyHTML: body,
          confirmText: "Удалить",
          onConfirm: (bodyEl) => {
            const mode = bodyEl.querySelector(
              'input[name="mode"]:checked'
            ).value;
            if (mode === "move") {
              const targetId = bodyEl.querySelector("#selDom").value;
              state.projects.forEach((p) => {
                if (p.domainId === id) p.domainId = targetId;
              });
            } else {
              const projIds = state.projects
                .filter((p) => p.domainId === id)
                .map((p) => p.id);
              state.tasks = state.tasks.filter(
                (t) => !projIds.includes(t.projectId)
              );
              state.projects = state.projects.filter((p) => p.domainId !== id);
            }
            state.domains = state.domains.filter((x) => x.id !== id);
            state.activeDomain = state.domains[0]?.id || null;
            saveState();
            renderSidebar();
            layoutMap();
            drawMap();
            closeDomainMenu();
          },
        });
      }
    };
  });
}

// Enhanced menu with friendly flows + toasts
function openDomainMenuX(id, rowEl) {
  closeDomainMenu();
  const d = state.domains.find((x) => x.id === id);
  const menu = document.createElement("div");
  menu.className = "domenu";
  menu.innerHTML = `
    <div class="item" data-act="focus">Фокус</div>
    <div class="item" data-act="rename">Переименовать</div>
    <div class="item" data-act="color">Цвет</div>
    <div class="palette" style="display:none">${palette
      .map(
        (c) => `<div class="dot" data-col="${c}" style="background:${c}"></div>`
      )
      .join("")}</div>
    <div class="item" data-act="merge">Слить с…</div>
    <div class="sep"></div>
    <div class="item" data-act="delete" style="color:#ffd1d1">Удалить</div>
  `;
  rowEl.insertAdjacentElement("afterend", menu);
  currentMenu = menu;
  document.addEventListener("click", onDocClick, true);

  menu.querySelector('[data-act="focus"]').onclick = () => {
    state.activeDomain = id;
    layoutMap();
    drawMap();
    fitActiveDomain();
    closeDomainMenu();
  };

  menu.querySelector('[data-act="rename"]').onclick = () => {
    const body = `<div style="display:flex;flex-direction:column;gap:8px">
      <input id=\"domName\" value=\"${d.title}\" placeholder=\"Введите название домена\"/>
      <div id=\"domHint\" class=\"hint\"></div>
    </div>`;
    openModal({
      title: "Переименование домена",
      bodyHTML: body,
      confirmText: "Сохранить",
      onConfirm: (bodyEl) => {
        const inp = bodyEl.querySelector("#domName");
        const name = (inp.value || "").trim();
        if (!name) {
          bodyEl.querySelector("#domHint").textContent =
            "Введите название домена";
          return;
        }
        if (
          state.domains.some(
            (x) => x.id !== id && x.title.toLowerCase() === name.toLowerCase()
          )
        ) {
          bodyEl.querySelector("#domHint").textContent =
            "Такой домен уже существует";
          return;
        }
        d.title = name;
        d.updatedAt = Date.now();
        saveState();
        renderSidebar();
        layoutMap();
        drawMap();
        closeDomainMenu();
      },
    });
  };

  menu.querySelector('[data-act="color"]').onclick = () => {
    const pal = menu.querySelector(".palette");
    pal.style.display = pal.style.display === "none" ? "flex" : "none";
    pal.querySelectorAll(".dot").forEach((dot) => {
      dot.onclick = () => {
        d.color = dot.dataset.col;
        d.updatedAt = Date.now();
        saveState();
        renderSidebar();
        layoutMap();
        drawMap();
        closeDomainMenu();
      };
    });
  };

  menu.querySelector('[data-act="merge"]').onclick = () => {
    const others = state.domains.filter((x) => x.id !== id);
    if (others.length === 0) {
      alert("Некуда сливать: доступен только один домен");
      return;
    }
    const body = `<label>Слить в:</label> <select id=\"selDom\">${others
      .map((o) => `<option value=\"${o.id}\">${o.title}</option>`)
      .join("")}</select>`;
    openModal({
      title: `Слить домен "${d.title}"`,
      bodyHTML: body,
      confirmText: "Слить",
      onConfirm: (bodyEl) => {
        const targetId = bodyEl.querySelector("#selDom").value;
        const target = state.domains.find((x) => x.id === targetId);
        if (!target || target.id === id) return;
        const movedPrjIds = state.projects
          .filter((p) => p.domainId === id)
          .map((p) => p.id);
        const prCount = movedPrjIds.length;
        const taskCount = state.tasks.filter((t) =>
          movedPrjIds.includes(t.projectId)
        ).length;
        state.projects.forEach((p) => {
          if (p.domainId === id) p.domainId = target.id;
        });
        state.domains = state.domains.filter((x) => x.id !== id);
        state.activeDomain = target.id;
        saveState();
        renderSidebar();
        layoutMap();
        drawMap();
        fitActiveDomain();
        closeDomainMenu();
        showToast(`Перенесено: ${prCount} проектов, ${taskCount} задач`, "ok");
      },
    });
  };

  menu.querySelector('[data-act="delete"]').onclick = () => {
    if (state.domains.length <= 1) {
      alert("Нельзя удалять последний домен");
      return;
    }
    const others = state.domains.filter((x) => x.id !== id);
    const body = `
      <div style=\"display:flex;flex-direction:column;gap:8px\">
        <label><input type=\"radio\" name=\"mode\" value=\"move\" checked/> Перенести проекты в:</label>
        <select id=\"selDom\">${others
          .map((o) => `<option value=\"${o.id}\">${o.title}</option>`)
          .join("")}</select>
        <label><input type=\"radio\" name=\"mode\" value=\"delete\"/> Удалить вместе с проектами и задачами</label>
      </div>`;
    openModal({
      title: `Удалить домен "${d.title}"?`,
      bodyHTML: body,
      confirmText: "Удалить",
      onConfirm: (bodyEl) => {
        const mode = bodyEl.querySelector('input[name="mode"]:checked').value;
        if (mode === "move") {
          const targetId = bodyEl.querySelector("#selDom").value;
          const projIds = state.projects
            .filter((p) => p.domainId === id)
            .map((p) => p.id);
          const taskCount = state.tasks.filter((t) =>
            projIds.includes(t.projectId)
          ).length;
          state.projects.forEach((p) => {
            if (p.domainId === id) p.domainId = targetId;
          });
          showToast(
            `Перенесено: ${projIds.length} проектов, ${taskCount} задач`,
            "ok"
          );
        } else {
          const projIds = state.projects
            .filter((p) => p.domainId === id)
            .map((p) => p.id);
          const removedTasks = state.tasks.filter((t) =>
            projIds.includes(t.projectId)
          ).length;
          state.tasks = state.tasks.filter(
            (t) => !projIds.includes(t.projectId)
          );
          state.projects = state.projects.filter((p) => p.domainId !== id);
          showToast(
            `Удалено: ${projIds.length} проектов, ${removedTasks} задач`,
            "warn"
          );
        }
        state.domains = state.domains.filter((x) => x.id !== id);
        state.activeDomain = state.domains[0]?.id || null;
        saveState();
        renderSidebar();
        layoutMap();
        drawMap();
        closeDomainMenu();
      },
    });
  };
}

/* legacy, unused */ function domainActions_old(id) {
  const d = state.domains.find((x) => x.id === id);
  const choice = prompt(
    `Домен "${d.title}": введите действие\nrename / color / merge / delete / focus`,
    "focus"
  );
  if (!choice) return;
  if (choice === "focus") {
    state.activeDomain = id;
    layoutMap();
    drawMap();
    fitActiveDomain();
    return;
  }
  if (choice === "rename") {
    const name = prompt("Новое имя домена:", d.title) || "";
    const trimmed = name.trim();
    if (!trimmed) return;
    if (
      state.domains.some(
        (x) => x.id !== id && x.title.toLowerCase() === trimmed.toLowerCase()
      )
    ) {
      alert("Такой домен уже есть");
      return;
    }
    d.title = trimmed;
    d.updatedAt = Date.now();
    saveState();
    renderSidebar();
    layoutMap();
    drawMap();
    return;
  }
  if (choice === "color") {
    const col = prompt("Цвет (hex, например #60a5fa):", d.color || "#2dd4bf");
    if (!col) return;
    d.color = col;
    d.updatedAt = Date.now();
    saveState();
    renderSidebar();
    layoutMap();
    drawMap();
    return;
  }
  if (choice === "merge") {
    const names = state.domains
      .filter((x) => x.id !== id)
      .map((x) => x.title)
      .join(", ");
    const into = prompt(`Слить домен "${d.title}" в: (${names})`, "");
    if (!into) return;
    const target = state.domains.find(
      (x) => x.title.toLowerCase() === into.toLowerCase()
    );
    if (!target) {
      alert("Целевой домен не найден");
      return;
    }
    if (target.id === id) {
      alert("Нельзя сливать в самого себя");
      return;
    }
    state.projects.forEach((p) => {
      if (p.domainId === id) p.domainId = target.id;
    });
    state.domains = state.domains.filter((x) => x.id !== id);
    state.activeDomain = target.id;
    saveState();
    renderSidebar();
    layoutMap();
    drawMap();
    fitActiveDomain();
    return;
  }
  if (choice === "delete") {
    if (state.domains.length <= 1) {
      alert("Нельзя удалить последний домен");
      return;
    }
    if (!confirm(`Удалить домен "${d.title}"?`)) return;
    const mode = prompt(
      "Перенести проекты в (название домена) или оставить пустым, чтобы удалить вместе с проектами и задачами:",
      ""
    );
    if (mode) {
      const target = state.domains.find(
        (x) => x.title.toLowerCase() === mode.toLowerCase()
      );
      if (!target) {
        alert("Целевой домен не найден");
        return;
      }
      state.projects.forEach((p) => {
        if (p.domainId === id) p.domainId = target.id;
      });
    } else {
      const projIds = state.projects
        .filter((p) => p.domainId === id)
        .map((p) => p.id);
      state.tasks = state.tasks.filter((t) => !projIds.includes(t.projectId));
      state.projects = state.projects.filter((p) => p.domainId !== id);
    }
    state.domains = state.domains.filter((x) => x.id !== id);
    state.activeDomain = state.domains[0]?.id || null;
    saveState();
    renderSidebar();
    layoutMap();
    drawMap();
  }
}

function updateWip() {
  const wip = state.tasks.filter((t) => t.status === "doing").length;
  const el = document.getElementById("wipInfo");
  el.textContent = I18N.wip(wip, state.wipLimit);
  el.className = "wip" + (wip > state.wipLimit ? " over" : "");
}

function setupHeader() {
  $$(".chip").forEach((ch) => {
    ch.onclick = () => {
      $$(".chip").forEach((c) => c.classList.remove("active"));
      ch.classList.add("active");
      state.view = ch.dataset.view;
      $("#canvas").style.display = state.view === "map" ? "block" : "none";
      $("#viewToday").style.display = state.view === "today" ? "block" : "none";
      if (state.view === "map") {
        drawMap();
      } else {
        renderToday();
      }
    };
  });
  const tgLinks = $("#tgLinks");
  const tgAging = $("#tgAging");
  const tgGlow = $("#tgGlow");
  if (tgLinks) {
    tgLinks.checked = !!state.showLinks;
    tgLinks.onchange = (e) => {
      state.showLinks = e.target.checked;
      saveState();
      layoutMap();
      drawMap();
    };
  }
  if (tgAging) {
    tgAging.checked = !!state.showAging;
    tgAging.onchange = (e) => {
      state.showAging = e.target.checked;
      saveState();
      drawMap();
    };
  }
  if (tgGlow) {
    tgGlow.checked = !!state.showGlow;
    tgGlow.onchange = (e) => {
      state.showGlow = e.target.checked;
      saveState();
      drawMap();
    };
  }

  // fit/center buttons
  const btnCenter = $("#btnCenter");
  const btnFitDomain = $("#btnFitDomain");
  const btnFitProject = $("#btnFitProject");
  const btnReset = $("#btnReset");
  const btnFullscreen = $("#btnFullscreen");
  if (btnCenter) btnCenter.onclick = () => centerView();
  if (btnFitDomain) btnFitDomain.onclick = () => fitActiveDomain();
  if (btnFitProject) btnFitProject.onclick = () => fitActiveProject();
  if (btnReset) btnReset.onclick = () => resetView();
  if (btnFullscreen) btnFullscreen.onclick = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else if (document.exitFullscreen) {
        await document.exitFullscreen();
      }
    } catch (_) {}
  };

  // Handle fullscreen change events to fix display glitches
  document.addEventListener('fullscreenchange', () => {
    setTimeout(() => {
      try {
        if (typeof window.onResize === 'function') window.onResize();
        if (typeof layoutMap === 'function') layoutMap();
        if (typeof drawMap === 'function') drawMap();
      } catch (_) {}
    }, 100);
  });

  // export/import
  $("#btnExport").onclick = () => exportJson();
  const fileInput = $("#fileImport");
  fileInput.onchange = async (e) => {
    if (!e.target.files || !e.target.files[0]) return;
    try {
      await importJson(e.target.files[0]);
      renderSidebar();
      if (window.layoutMap) window.layoutMap();
      if (window.drawMap) window.drawMap();
      renderToday();
    } catch (err) {
      alert(I18N.errors.import + err.message);
    } finally {
      e.target.value = "";
    }
  };
  // edge cap slider
  // zoom slider (top control)
  const zoomSlider = $("#zoomSlider");
  if (zoomSlider) {
    // try to initialize from map if available
    try {
      const current =
        (window.mapApi && window.mapApi.getScale && window.mapApi.getScale()) ||
        100;
      zoomSlider.value = String(Math.round(current));
    } catch (_) {}
    zoomSlider.oninput = (e) => {
      const v = parseInt(e.target.value, 10) || 100;
      // mapApi expects percent-like value 100 -> scale 1
      if (window.mapApi && window.mapApi.setZoom) window.mapApi.setZoom(v);
    };
  }
  // about/version modal
  const btnAbout = document.getElementById("btnAbout");
  if (btnAbout) {
    btnAbout.onclick = () => {
      openModal({
        title: "О версии",
        bodyHTML:
          '<div style="display:flex;flex-direction:column;gap:8px">' +
          `<div><strong>Версия:</strong> ${APP_VERSION}</div>` +
          `<div><a href="CHANGELOG.md" target="_blank" rel="noopener">Открыть CHANGELOG</a></div>` +
          "</div>",
        confirmText: "Ок",
      });
    };
  }
  // theme toggle using data-theme attribute (persist in localStorage)
  try{
    const THEME_KEY = 'atlas_theme';
    const cur = localStorage.getItem(THEME_KEY) || 'dark';
    document.documentElement.setAttribute('data-theme', cur);
    const lab = document.createElement('label');
    lab.style.marginLeft = '8px';
    lab.innerHTML = `<input type="checkbox" id="tgTheme" ${cur==='light'?'checked':''}/> Тема`;
    document.querySelector('header .toggle')?.appendChild(lab);
    const tgl = document.getElementById('tgTheme');
    if(tgl){
      tgl.onchange = (e)=>{
        const next = e.target.checked ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem(THEME_KEY, next);
      };
    }
  }catch(_){}
}

function setupQuickAdd() {
  const qa = $("#quickAdd");
  const chips = $("#qaChips");
  qa.addEventListener("input", () => {
    const parsed = parseQuick(qa.value);
    chips.innerHTML = "";
    if (parsed.tag)
      chips.innerHTML += `<div class="chip-mini">#${parsed.tag}</div>`;
    if (parsed.project)
      chips.innerHTML += `<div class="chip-mini">@${parsed.project}</div>`;
    if (parsed.when)
      chips.innerHTML += `<div class="chip-mini">!${parsed.when.label}</div>`;
    if (parsed.estimate)
      chips.innerHTML += `<div class="chip-mini">~${parsed.estimate}м</div>`;
    if (parsed.priority)
      chips.innerHTML += `<div class="chip-mini">p${parsed.priority}</div>`;
  });
  qa.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitQuick(qa.value.trim());
      qa.value = "";
      chips.innerHTML = "";
    }
  });
  // zoom slider hookup (view_map exposes setZoom)
  const zs = $("#zoomSlider");
  try{
    if(zs){
      zs.addEventListener('input', ()=>{
        if(window.mapApi && typeof window.mapApi.setZoom==='function'){
          window.mapApi.setZoom(parseInt(zs.value,10));
        }
      });
    }
  }catch(_){}
}

function submitQuick(text) {
  if (!text) return;
  const parsed = parseQuick(text);
  const title = parsed.title || I18N.defaults.taskTitle;
  let pid = null;
  let domainId = null;
  if (parsed.project) {
    const found = state.projects.find((p) => p.title.toLowerCase() === parsed.project.toLowerCase());
    if (found) pid = found.id;
  }
  if (!pid) {
    domainId = state.activeDomain || state.domains[0]?.id || null;
  }
  const tags = [];
  if (parsed.tag) tags.push(parsed.tag);
  state.tasks.push({
    id: "t" + Math.random().toString(36).slice(2, 8),
    projectId: pid,
    domainId: pid ? undefined : domainId,
    title,
    tags,
    status: "today",
    estimateMin: parsed.estimate || null,
    priority: parsed.priority || 2,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  saveState();
  layoutMap();
  drawMap();
  renderToday();
  updateWip();
  
  //_emit state change event
  if (window.bus) window.bus.emit('state:changed', { reason: 'quick-add' });
}

async function init() {
  const ok = loadState();
  if (!ok) initDemoData();
  // set version in brand + document title
  const brandEl = document.querySelector("header .brand");
  // Don't override APP_VERSION from CHANGELOG - use the hardcoded version
  if (brandEl) brandEl.textContent = APP_VERSION;
  document.title = APP_VERSION + " (modular)";
  renderSidebar();
  setupHeader();
  setupQuickAdd();
  // ensure header chips reflect persisted view
  try {
    $$(".chip").forEach((c) => {
      c.classList.toggle("active", c.dataset.view === state.view);
    });
    $("#canvas").style.display = state.view === "map" ? "block" : "none";
    $("#viewToday").style.display = state.view === "today" ? "block" : "none";
  } catch (_) {}
  // hotkeys: C/F/P/R + N new domain, FPS toggle
  window.addEventListener("keydown", (e) => {
    // Ctrl+Z -> undo last move
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      const ok = undoLastMove && undoLastMove();
      if (ok) showToast("Отменено", "ok");
      return;
    }
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      setShowFps();
      return;
    }
    if (e.target && e.target.id === "quickAdd") return;
    const k = e.key.toLowerCase();
    if (k === "c") {
      e.preventDefault();
      centerView();
    }
    if (k === "f") {
      e.preventDefault();
      fitActiveDomain();
    }
    if (k === "p") {
      e.preventDefault();
      fitActiveProject();
    }
    if (k === "r") {
      e.preventDefault();
      resetView();
    }
    if (k === "n") {
      e.preventDefault();
      ui.newDomain = true;
      renderSidebar();
      $("#newDomName")?.focus();
    }
  });
  const canvas = document.getElementById("canvas");
  const tooltip = document.getElementById("tooltip");
  initMap(canvas, tooltip);
  updateWip();
}
init();

// expose renderers for external refresh (storage, addons)
try { window.renderSidebar = renderSidebar; } catch(_) {}
try { window.renderToday = renderToday; } catch(_) {}
