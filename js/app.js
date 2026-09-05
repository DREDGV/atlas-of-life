// js/app.js
import { state, $, $$, initDemoData, normalizeTags } from "./state.js";
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
import { parseQuick, resolveQuickDraft } from "./parser.js";
import { logEvent } from "./utils/analytics.js";
import { initInbox } from "./features/inbox/index.js";
import { refreshInboxAfterRemoteApply } from "./features/inbox/view.js";
import { openInspectorFor } from "./inspector.js";
import {
  captureInbox,
  createDomain as createDomainCommand,
  createTask,
  deleteDomain,
  deleteInbox,
  deleteTask,
  mergeDomain,
  updateDomain,
} from "./core/commands.js";
import {
  getVisibleDomainIds,
  isDomainVisible,
  setDomainVisible,
  showAllDomains,
  syncVisibleDomains,
} from "./ui/map-session.js";
import { APP_VERSION, APP_LABEL } from "./version.js";
import { createSyncRuntime, requestSyncNow } from "./sync/runtime.js";
import { createSyncBadge, openSyncModal } from "./sync/ui.js";

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

// ephemeral UI state
const ui = {
  newDomain: false,
  newDomColor: "#2dd4bf",
  newDomDraft: "",
  newDomError: "",
  quickMode: "inbox",
  quickSelectedProjectId: null,
  quickSuggestionIndex: -1,
  quickSuggestions: [],
  quickLastResult: null,
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
    const shouldClose = onConfirm
      ? onConfirm(document.getElementById("modalBody")) !== false
      : true;
    if (shouldClose) close();
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
// expose globally for addons/other modules
try { window.showToast = showToast; } catch (_) {}

function renderSidebar() {
  const dWrap = document.getElementById("domainsList");
  const visibleIds = getVisibleDomainIds(state.domains);
  let html = "";
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
    html += `<div class="domain-toolbar">
      <button class="btn" id="btnAddDomain">+ Домен</button>
      <button class="domain-show-all" id="showAllDomains" type="button">Показать все</button>
      <span class="domain-visible-count">Показано ${visibleIds.size} из ${state.domains.length}</span>
    </div>`;
  }
  html += state.domains
    .map((d) => {
      const projectIds = new Set(state.projects.filter((p) => p.domainId === d.id).map(project => project.id));
      const taskCount = state.tasks.filter(task => task.domainId === d.id || projectIds.has(task.projectId)).length;
      const projectCount = projectIds.size;
      const visible = visibleIds.has(d.id);
      const context = state.activeDomain === d.id;
      const color = d.color || "#2dd4bf";
      return `<div class="domain-row${context ? ' is-context' : ''}${visible ? '' : ' is-hidden'}" data-domain="${escapeHtml(d.id)}">
      <input class="domain-visibility" type="checkbox" ${visible ? 'checked' : ''} aria-label="Показывать домен ${escapeHtml(d.title)}">
      <span class="dot" style="background:${escapeHtml(color)}" aria-hidden="true"></span>
      <button class="domain-name" type="button"><span>${escapeHtml(d.title)}</span>${context ? '<span class="domain-context-badge">Контекст</span>' : ''}</button>
      <span class="domain-counts">${projectCount} пр · ${taskCount} зад</span>
      <button class="domain-focus" type="button" title="Показать домен на карте" aria-label="Показать домен ${escapeHtml(d.title)} на карте">⌖</button>
      <button class="domain-actions actions" type="button" data-dom="${escapeHtml(d.id)}" aria-label="Действия домена ${escapeHtml(d.title)}">⋯</button>
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
  const showAllButton = document.getElementById("showAllDomains");
  if (showAllButton) {
    showAllButton.disabled = visibleIds.size === state.domains.length;
    showAllButton.onclick = () => {
      showAllDomains(state.domains);
      renderSidebar();
      layoutMap();
      drawMap();
      window.mapApi?.fitAll?.();
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
    function validateDomainName(value) {
      const name = String(value || "").trim();
      if (!name) return "Введите название домена";
      if (state.domains.some((d) => d.title.toLocaleLowerCase("ru-RU") === name.toLocaleLowerCase("ru-RU"))) {
        return "Такой домен уже существует";
      }
      return "";
    }
    function commitDomain() {
      const name = String(nameInput.value || "").trim();
      const error = validateDomainName(name);
      ui.newDomError = error;
      hint.textContent = error;
      if (error) return false;
      try {
        const domain = createDomainCommand({ title: name, color: ui.newDomColor });
        state.activeDomain = domain.id;
        syncVisibleDomains(state.domains);
        setDomainVisible(domain.id, true, state.domains);
        ui.newDomain = false;
        ui.newDomDraft = "";
        ui.newDomError = "";
        renderSidebar();
        layoutMap();
        drawMap();
        fitActiveDomain();
        openInspectorFor({ ...domain, _type: "domain" });
        showToast(`Создан домен: ${name}`, "ok");
        return true;
      } catch (error) {
        ui.newDomError = error?.message || "Не удалось создать домен";
        hint.textContent = ui.newDomError;
        return false;
      }
    }
    $("#newDomCancel").onclick = () => {
      ui.newDomain = false;
      ui.newDomDraft = "";
      renderSidebar();
    };
    nameInput.addEventListener("input", () => {
      ui.newDomDraft = nameInput.value;
      const err = validateDomainName(nameInput.value);
      ui.newDomError = err;
      if (hint) hint.textContent = err;
    });
    if (btnSave) btnSave.onclick = commitDomain;
    nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitDomain();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        ui.newDomain = false;
        ui.newDomDraft = "";
        renderSidebar();
      }
    });
  }
  dWrap.querySelectorAll(".domain-row[data-domain]").forEach((el) => {
    const id = el.dataset.domain;
    const checkbox = el.querySelector(".domain-visibility");
    checkbox.onchange = () => {
      const accepted = setDomainVisible(id, checkbox.checked, state.domains);
      if (!accepted) {
        checkbox.checked = true;
        showToast("На карте должен остаться хотя бы один домен", "warn");
        return;
      }
      renderSidebar();
      layoutMap();
      drawMap();
      window.mapApi?.fitAll?.();
      openInspectorFor(null);
    };
    el.querySelector(".domain-name").onclick = () => {
      setDomainVisible(id, true, state.domains);
      state.activeDomain = id;
      window.refreshQuickDock?.();
      const domain = state.domains.find(item => item.id === id);
      renderSidebar();
      layoutMap();
      drawMap();
      if (domain) openInspectorFor({ ...domain, _type: "domain" });
    };
    el.querySelector(".domain-focus").onclick = () => {
      setDomainVisible(id, true, state.domains);
      renderSidebar();
      layoutMap();
      drawMap();
      window.mapApi?.fitDomain?.(id);
    };
    el.ondblclick = (event) => {
      if (event.target.closest("button,input")) return;
      setDomainVisible(id, true, state.domains);
      state.activeDomain = id;
      window.refreshQuickDock?.();
      renderSidebar();
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

  // tags
  const allTags = [
    ...new Set(
      state.tasks
        .flatMap((t) => normalizeTags(t.tags))
        .concat(state.projects.flatMap((p) => normalizeTags(p.tags)))
    ),
  ].sort();
  const tWrap = document.getElementById("tagsList");
  tWrap.innerHTML =
    `<div class="tag ${
      state.filterTag === null ? "active" : ""
    }" data-tag="">Все</div>` +
    allTags
      .map(
        (t) =>
          `<div class="tag ${
            state.filterTag === t ? "active" : ""
          }" data-tag="${escapeHtml(t)}">#${escapeHtml(t)}</div>`
      )
      .join("");
  tWrap.querySelectorAll(".tag").forEach((el) => {
    el.onclick = () => {
      const val = el.dataset.tag || null;
      state.filterTag = val;
      renderSidebar();
      layoutMap();
      drawMap();
    };
  });
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
        updateDomain(id, { title: trimmed }); // C3/W3: Core command + projection re-emit
        requestSyncNow(); // C3: refreshed projections reach the phone immediately
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
    setDomainVisible(id, true, state.domains);
    renderSidebar();
    layoutMap();
    drawMap();
    window.mapApi?.fitDomain?.(id);
    closeDomainMenu();
  };

  menu.querySelector('[data-act="rename"]').onclick = () => {
    const body = `<div style="display:flex;flex-direction:column;gap:8px">
      <input id=\"domName\" value=\"${escapeHtml(d.title)}\" placeholder=\"Введите название домена\"/>
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
          return false;
        }
        if (
          state.domains.some(
            (x) => x.id !== id && x.title.toLowerCase() === name.toLowerCase()
          )
        ) {
          bodyEl.querySelector("#domHint").textContent =
            "Такой домен уже существует";
          return false;
        }
        const updated = updateDomain(id, { title: name });
        requestSyncNow(); // C3: refreshed projections reach the phone immediately
        renderSidebar();
        layoutMap();
        drawMap();
        if (updated?.domain) openInspectorFor({ ...updated.domain, _type: "domain" });
        closeDomainMenu();
      },
    });
  };

  menu.querySelector('[data-act="color"]').onclick = () => {
    const pal = menu.querySelector(".palette");
    pal.style.display = pal.style.display === "none" ? "flex" : "none";
    pal.querySelectorAll(".dot").forEach((dot) => {
      dot.onclick = () => {
        updateDomain(id, { color: dot.dataset.col });
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
      .map((o) => `<option value=\"${escapeHtml(o.id)}\">${escapeHtml(o.title)}</option>`)
      .join("")}</select>`;
    openModal({
      title: `Слить домен "${d.title}"`,
      bodyHTML: body,
      confirmText: "Слить",
      onConfirm: (bodyEl) => {
        const targetId = bodyEl.querySelector("#selDom").value;
        const target = state.domains.find((x) => x.id === targetId);
        if (!target || target.id === id) return;
        const merged = mergeDomain(id, target.id);
        const prCount = merged.movedProjectCount;
        const taskCount = merged.movedTaskCount;
        state.activeDomain = target.id;
        setDomainVisible(target.id, true, state.domains);
        window.refreshQuickDock?.();
        renderSidebar();
        layoutMap();
        drawMap();
        window.mapApi?.fitDomain?.(target.id);
        openInspectorFor({ ...target, _type: "domain" });
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
          .map((o) => `<option value=\"${escapeHtml(o.id)}\">${escapeHtml(o.title)}</option>`)
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
          const removed = deleteDomain(id, { mode: "move", targetDomainId: targetId });
          setDomainVisible(targetId, true, state.domains);
          showToast(`Перенесено: ${removed.projectCount} проектов, ${removed.taskCount} задач`, "ok");
        } else {
          const removed = deleteDomain(id, { mode: "cascade" });
          showToast(`Удалено: ${removed.projectCount} проектов, ${removed.taskCount} задач`, "warn");
        }
        syncVisibleDomains(state.domains);
        window.refreshQuickDock?.();
        renderSidebar();
        layoutMap();
        drawMap();
        openInspectorFor(null);
        closeDomainMenu();
      },
    });
  };
}

function updateWip() {
  const wip = state.tasks.filter((t) => t.status === "doing").length;
  const el = document.getElementById("wipInfo");
  el.textContent = I18N.wip(wip, state.wipLimit);
  el.className = "wip" + (wip > state.wipLimit ? " over" : "");
}

function setupHeader() {
  const viewChips = $$(".chip[data-view]");
  viewChips.forEach((ch) => {
    ch.onclick = () => {
      viewChips.forEach((c) => {
        c.classList.remove("active");
        c.setAttribute("aria-pressed", "false");
      });
      ch.classList.add("active");
      ch.setAttribute("aria-pressed", "true");
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
      layoutMap();
      drawMap();
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
  const preview = $("#qaPreview");
  const result = $("#qaResult");
  const suggestions = $("#qaSuggestions");
  const submit = $("#quickSubmit");

  function closeSuggestions() {
    ui.quickSuggestions = [];
    ui.quickSuggestionIndex = -1;
    suggestions.hidden = true;
    suggestions.innerHTML = "";
    qa.setAttribute("aria-expanded", "false");
    qa.removeAttribute("aria-activedescendant");
  }

  function chooseSuggestion(item) {
    if (!item) return;
    if (item.type === "project") {
      const start = qa.value.lastIndexOf("@");
      qa.value = `${qa.value.slice(0, start)}@\"${item.title}\"`;
      ui.quickSelectedProjectId = item.id;
    } else {
      const start = qa.value.lastIndexOf("#");
      qa.value = `${qa.value.slice(0, start)}#${item.title} `;
    }
    closeSuggestions();
    updateQuickPreview();
    qa.focus();
  }

  function renderSuggestions() {
    if (ui.quickMode !== "task") return closeSuggestions();
    const projectMatch = qa.value.match(/@(?:"([^"]*)|([^#@!~]*))$/u);
    const tagMatch = qa.value.match(/(?:^|\s)#([^\s#@!~]*)$/u);
    let items = [];
    if (projectMatch) {
      const query = String(projectMatch[1] ?? projectMatch[2] ?? "").trim().toLocaleLowerCase("ru-RU");
      items = state.projects
        .filter(project => !query || project.title.toLocaleLowerCase("ru-RU").includes(query))
        .slice(0, 8)
        .map(project => ({
          type: "project",
          id: project.id,
          title: project.title,
          context: state.domains.find(domain => domain.id === project.domainId)?.title || "Без домена",
        }));
    } else if (tagMatch) {
      const query = tagMatch[1].toLocaleLowerCase("ru-RU");
      const tags = [...new Set(state.tasks.flatMap(task => normalizeTags(task.tags)).concat(state.projects.flatMap(project => normalizeTags(project.tags))))];
      items = tags.filter(tag => !query || tag.toLocaleLowerCase("ru-RU").includes(query)).slice(0, 8)
        .map(tag => ({ type: "tag", id: `tag:${tag}`, title: tag, context: "Тег" }));
    }
    ui.quickSuggestions = items;
    ui.quickSuggestionIndex = items.length
      ? Math.max(0, Math.min(ui.quickSuggestionIndex, items.length - 1))
      : -1;
    if (!items.length) return closeSuggestions();
    suggestions.innerHTML = items.map((item, index) => `
      <button type="button" class="quick-suggestion${index === ui.quickSuggestionIndex ? " active" : ""}" role="option" id="qa-option-${index}" aria-selected="${index === ui.quickSuggestionIndex}" data-suggestion-index="${index}">
        <span>${item.type === "project" ? "@" : "#"}${escapeHtml(item.title)}</span><small>${escapeHtml(item.context)}</small>
      </button>`).join("");
    suggestions.hidden = false;
    qa.setAttribute("aria-expanded", "true");
    qa.setAttribute("aria-activedescendant", `qa-option-${ui.quickSuggestionIndex}`);
    suggestions.querySelectorAll("[data-suggestion-index]").forEach(button => {
      button.onmousedown = event => event.preventDefault();
      button.onclick = () => chooseSuggestion(items[Number(button.dataset.suggestionIndex)]);
    });
  }

  function updateQuickPreview({ keepResult = false } = {}) {
    if (!keepResult) result.innerHTML = "";
    if (ui.quickMode === "inbox") {
      chips.innerHTML = "";
      preview.className = "quick-preview";
      preview.textContent = "Во Входящие · без разбора";
      renderSuggestions();
      return;
    }
    const parsed = parseQuick(qa.value);
    const resolved = resolveQuickDraft(parsed, {
      projects: state.projects,
      domains: state.domains,
      activeDomainId: state.activeDomain,
      selectedProjectId: ui.quickSelectedProjectId,
    });
    const destination = resolved.projectId
      ? state.projects.find(project => project.id === resolved.projectId)?.title
      : state.domains.find(domain => domain.id === resolved.domainId)?.title;
    chips.innerHTML = [
      ...parsed.tags.map(tag => `#${tag}`),
      parsed.projectQuery ? `@${parsed.projectQuery}` : null,
      parsed.whenLabel ? `!${parsed.whenLabel}` : null,
      parsed.estimateMin ? `~${parsed.estimateMin}м` : null,
      `p${parsed.priority}`,
    ].filter(Boolean).map(label => `<span class="chip-mini">${escapeHtml(label)}</span>`).join("");
    preview.className = `quick-preview${resolved.errors.length ? " error" : ""}`;
    preview.textContent = resolved.errors.length
      ? resolved.errors[0]
      : `${resolved.status === "today" ? "Сегодня" : "Бэклог"} · ${destination || "место не выбрано"}${resolved.due ? ` · ${resolved.due.date}${resolved.due.time ? ` ${resolved.due.time}` : ""}` : ""}`;
    renderSuggestions();
  }

  function showQuickResult(message, type, id) {
    ui.quickLastResult = { type, id };
    result.innerHTML = `<span>${escapeHtml(message)}</span>
      ${type === "inbox" ? '<button type="button" data-quick-action="open">Открыть Входящие</button>' : '<button type="button" data-quick-action="open">Показать</button>'}
      <button type="button" data-quick-action="undo">Отменить</button>`;
    result.querySelector('[data-quick-action="open"]').onclick = () => {
      if (type === "inbox") document.getElementById("btnInbox")?.click();
      else window.mapApi?.fitTask?.(id);
    };
    result.querySelector('[data-quick-action="undo"]').onclick = () => {
      try {
        if (type === "inbox") deleteInbox(id);
        else deleteTask(id);
        ui.quickLastResult = null;
        result.innerHTML = '<span>Добавление отменено</span>';
        renderSidebar();
        renderToday();
        layoutMap();
        drawMap();
        if (type === "task") openInspectorFor(null);
      } catch (error) {
        result.innerHTML = `<span class="quick-error">${escapeHtml(error?.message || "Не удалось отменить")}</span>`;
      }
    };
  }

  function submitQuick() {
    const rawText = qa.value;
    if (!rawText.trim()) {
      result.innerHTML = "";
      preview.className = "quick-preview error";
      preview.textContent = "Введите текст";
      qa.focus();
      return false;
    }
    try {
      if (ui.quickMode === "inbox") {
        const created = captureInbox(rawText, {
          splitLines: false,
          source: "desktop-capture",
          inputType: "text",
          entryPoint: "app",
        });
        if (!created.length) throw new Error("Не удалось сохранить запись");
        qa.value = "";
        showQuickResult("Добавлено во Входящие", "inbox", created[0].id);
      } else {
        const parsed = parseQuick(rawText);
        const resolved = resolveQuickDraft(parsed, {
          projects: state.projects,
          domains: state.domains,
          activeDomainId: state.activeDomain,
          selectedProjectId: ui.quickSelectedProjectId,
        });
        if (resolved.errors.length) throw new Error(resolved.errors[0]);
        const task = createTask({
          projectId: resolved.projectId,
          domainId: resolved.projectId ? undefined : resolved.domainId,
          title: resolved.title,
          tags: resolved.tags,
          status: resolved.status,
          due: resolved.due,
          estimateMin: resolved.estimateMin,
          priority: resolved.priority,
        });
        if (resolved.domainId) {
          setDomainVisible(resolved.domainId, true, state.domains);
        }
        qa.value = "";
        ui.quickSelectedProjectId = null;
        renderSidebar();
        renderToday();
        layoutMap();
        drawMap();
        openInspectorFor({ ...task, _type: "task" });
        window.mapApi?.fitTask?.(task.id);
        showQuickResult("Задача создана", "task", task.id);
      }
      requestSyncNow();
      chips.innerHTML = "";
      closeSuggestions();
      updateQuickPreview({ keepResult: true });
      updateWip();
      if (window.bus) window.bus.emit('state:changed', { reason: 'quick-add' });
      return true;
    } catch (error) {
      result.innerHTML = "";
      preview.className = "quick-preview error";
      preview.textContent = error?.message || "Не удалось добавить";
      qa.focus();
      return false;
    }
  }

  document.querySelectorAll("[data-quick-mode]").forEach(button => {
    button.onclick = () => {
      ui.quickMode = button.dataset.quickMode;
      ui.quickSelectedProjectId = null;
      document.querySelectorAll("[data-quick-mode]").forEach(item => {
        const active = item.dataset.quickMode === ui.quickMode;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      qa.placeholder = ui.quickMode === "inbox"
        ? "Записать мысль во Входящие…"
        : "Задача #тег @проект !сегодня 10:00 ~30м p2";
      updateQuickPreview();
      qa.focus();
    };
  });
  qa.addEventListener("input", () => {
    ui.quickSelectedProjectId = null;
    updateQuickPreview();
  });
  qa.addEventListener("keydown", (e) => {
    if (!suggestions.hidden && ["ArrowDown", "ArrowUp"].includes(e.key)) {
      e.preventDefault();
      const direction = e.key === "ArrowDown" ? 1 : -1;
      ui.quickSuggestionIndex = (ui.quickSuggestionIndex + direction + ui.quickSuggestions.length) % ui.quickSuggestions.length;
      renderSuggestions();
      return;
    }
    if (e.key === "Escape" && !suggestions.hidden) {
      e.preventDefault();
      closeSuggestions();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (!suggestions.hidden && ui.quickSuggestionIndex >= 0) {
        chooseSuggestion(ui.quickSuggestions[ui.quickSuggestionIndex]);
        return;
      }
      submitQuick();
    }
  });
  submit.onclick = submitQuick;
  window.refreshQuickDock = updateQuickPreview;
  updateQuickPreview();
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
  createTask({
    projectId: pid,
    domainId: pid ? undefined : domainId,
    title,
    tags,
    status: "today",
    estimateMin: parsed.estimate || null,
    priority: parsed.priority || 2,
  });
  layoutMap();
  drawMap();
  renderToday();
  updateWip();
  requestSyncNow();
  
  //_emit state change event
  if (window.bus) window.bus.emit('state:changed', { reason: 'quick-add' });
}

async function init() {
  document.getElementById('btnKnowledge').onclick = () => {
    document.querySelector('.chip[data-view="map"]')?.click();
    openInspectorFor({ _type: 'knowledge-library' });
  };
  const ok = loadState();
  if (!ok) initDemoData();
  // set version in brand + document title
  const brandEl = document.querySelector("header .brand");
  if (brandEl) brandEl.textContent = APP_LABEL;
  document.title = APP_LABEL;
  // Sync v1 (C1): remote transport runtime + status badge in the header.
  // Fire-and-forget by design: a sync failure never blocks local work.
  let syncRuntime = null;
  try {
    syncRuntime = createSyncRuntime({
      onStatus: (status) => {
        // Remote changes arrived: refresh the visible Inbox UI (never a card
        // the user is actively processing — see refreshInboxAfterRemoteApply).
        if (status.pulled > 0) refreshInboxAfterRemoteApply();
      },
    });
    syncRuntime.start();
    window.atlasSync = syncRuntime;
    const syncChip = document.getElementById("btnSync");
    if (syncChip) {
      const badge = createSyncBadge({
        runtime: syncRuntime,
        onClick: () => openSyncModal({ runtime: syncRuntime }),
      });
      badge.el.classList.add("chip");
      syncChip.replaceWith(badge.el);
    }
  } catch (error) {
    console.warn("sync runtime failed to start", error?.message || error);
  }
  renderSidebar();
  setupHeader();
  setupQuickAdd();
  initInbox({
    onStateChange: () => {
      renderSidebar();
      renderToday();
      layoutMap();
      drawMap();
      updateWip();
      requestSyncNow();
    },
  });
  // ensure header chips reflect persisted view
  try {
    $$(".chip").forEach((c) => {
      c.classList.toggle("active", c.dataset.view === state.view);
    });
    $("#canvas").style.display = state.view === "map" ? "block" : "none";
    $("#viewToday").style.display = state.view === "today" ? "block" : "none";
  } catch (_) {}
  // hotkeys: C/F/P/R, FPS toggle. N is owned by Inbox.
  window.addEventListener("keydown", (e) => {
    if (e.defaultPrevented) return;
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
