// js/inspector.js
import {
  state,
  byId,
  project,
  domainOf,
  tasksOfProject,
  daysSince,
  statusPill,
} from "./state.js";
// view_map helpers are accessed via window.mapApi to avoid circular import issues
function drawMap() {
  return window.mapApi && window.mapApi.drawMap && window.mapApi.drawMap();
}
function refreshMap(opts){
  return window.mapApi && window.mapApi.refresh && window.mapApi.refresh(opts||{});
}
function getPendingAttach() {
  return (
    window.mapApi &&
    window.mapApi.getPendingAttach &&
    window.mapApi.getPendingAttach()
  );
}
function confirmAttach() {
  return (
    window.mapApi &&
    window.mapApi.confirmAttach &&
    window.mapApi.confirmAttach()
  );
}
function cancelAttach() {
  return (
    window.mapApi && window.mapApi.cancelAttach && window.mapApi.cancelAttach()
  );
}
import { saveState } from "./storage.js";
import { renderToday } from "./view_today.js";

export function openInspectorFor(obj) {
  const ins = document.getElementById("inspector");
  if (!obj) {
    ins.innerHTML = `<div class="hint">Выберите объект на карте, чтобы увидеть детали.</div>`;
    return;
  }
  const type = obj._type;
  if (type === "domain") {
    const prjs = state.projects.filter((p) => p.domainId === obj.id);
    const totalTasks = prjs.reduce(
      (a, p) => a + tasksOfProject(p.id).length,
      0
    );
    ins.innerHTML = `
      <h2>Домен: ${obj.title}</h2>
      <div class="kv">Проектов: ${prjs.length} · Задач: ${totalTasks}</div>
      <div class="btns">
        <button class="btn primary" id="addProject">+ Проект</button>
      </div>
      <div class="list">${prjs
        .map(
          (p) => `
        <div class="card">
          <div><strong>${p.title}</strong></div>
          <div class="meta">#${(p.tags || []).join(" #")}</div>
          <div class="meta">Задач: ${tasksOfProject(p.id).length}</div>
        </div>
      `
        )
        .join("")}</div>
    `;
    document.getElementById("addProject").onclick = () => {
      const title = prompt("Название проекта:", "Новый проект");
      if (!title) return;
      const id = "p" + Math.random().toString(36).slice(2, 8);
      state.projects.push({
        id,
        domainId: obj.id,
        title,
        tags: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      saveState();
      refreshMap({ layout: true });
      openInspectorFor(obj);
    };
  }
  if (type === "project") {
    const tks = tasksOfProject(obj.id);
    ins.innerHTML = `
      <h2>Проект: ${obj.title}</h2>
      <div class="kv">Домен: ${domainOf(obj).title}</div>
      <div class="kv">Теги: #${(obj.tags || []).join(" #")}</div>
      <div class="btns">
        <button class="btn primary" id="addTask">+ Задача</button>
        <button class="btn" id="toToday">Взять 3 задачи в Сегодня</button>
      </div>
      <div class="list">${tks
        .map(
          (t) => `
        <div class="card">
          <div>${statusPill(t.status)} <strong>${t.title}</strong></div>
          <div class="meta">#${t.tags.join(" #")} · обновл. ${daysSince(
            t.updatedAt
          )} дн.</div>
        </div>
      `
        )
        .join("")}</div>
    `;
    document.getElementById("addTask").onclick = () => {
      const title = prompt("Название задачи:", "Новая задача");
      if (!title) return;
      const id = "t" + Math.random().toString(36).slice(2, 8);
      state.tasks.push({
        id,
        projectId: obj.id,
        title,
        tags: [],
        status: "backlog",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      saveState();
      refreshMap({ layout: true });
      openInspectorFor(obj);
    };
    // add button to create independent task in this project's domain
    try{
      const btns = document.querySelector('#inspector .btns');
      if(btns){
        const b = document.createElement('button');
        b.className = 'btn';
        b.id = 'addIndep';
        b.textContent = '+ Независимая задача (в домене)';
        btns.appendChild(b);
        b.onclick = () => {
          const title = prompt('Название независимой задачи:', 'Новая задача');
          if(!title) return;
          const id = 't'+Math.random().toString(36).slice(2,8);
          state.tasks.push({ id, projectId:null, domainId: obj.domainId, title, tags:[], status:'backlog', createdAt:Date.now(), updatedAt:Date.now() });
          saveState();
          refreshMap({ layout: true });
          openInspectorFor(obj);
        };
      }
    }catch(_){ }
    document.getElementById("toToday").onclick = () => {
      const candidates = tks.filter((t) => t.status !== "done").slice(0, 3);
      candidates.forEach((t) => {
        t.status = "today";
        t.updatedAt = Date.now();
      });
      try {
        saveState();
      } catch (_) {}
      drawMap();
      renderToday();
    };
  }
  if (type === "task") {
    const pending = getPendingAttach();
    const pendForThis = pending && pending.taskId === obj.id;
    ins.innerHTML = `
      <h2>Задача</h2>
      <div class="kv"><strong>${obj.title}</strong></div>
      <div class="kv">Проект: ${project(obj.projectId)?.title || 'Без проекта'}</div>
      <div class="kv">Домен: ${obj.domainId ? byId(state.domains, obj.domainId)?.title || 'Неизвестный домен' : 'Без домена'}</div>
      <div class="kv">Теги: #${obj.tags.join(" #") || "-"}</div>
      <div class="kv">Статус: ${statusPill(obj.status)} · обновл.: ${daysSince(
      obj.updatedAt
    )} дн.</div>
      ${
        pendForThis
          ? `<div class="kv hint">Ожидает привязки к проекту: ${
              project(pending.toProjectId).title
            }</div>`
          : ""
      }
      <div class="btns">
        <button class="btn" data-st="today">Сегодня</button>
        <button class="btn" data-st="doing">В работе</button>
        <button class="btn ok" data-st="done">Готово</button>
        <button class="btn warn" id="delTask">Удалить</button>
        ${
          pendForThis
            ? `<button class="btn" id="confirmAttach">Привязать</button><button class="btn" id="cancelAttach">Отменить привязку</button>`
            : ""
        }
      </div>
    `;
    if (pendForThis) {
      document.getElementById("confirmAttach").onclick = () => {
        confirmAttach();
        openInspectorFor(obj);
      };
      document.getElementById("cancelAttach").onclick = () => {
        cancelAttach();
        openInspectorFor(obj);
      };
    }
    ins.querySelectorAll(".btn[data-st]").forEach((b) => {
      b.onclick = () => {
        obj.status = b.dataset.st;
        obj.updatedAt = Date.now();
        saveState();
        drawMap();
        renderToday();
        openInspectorFor(obj);
      };
    });
    document.getElementById("delTask").onclick = () => {
      if (confirm("Удалить задачу без возможности восстановления?")) {
        state.tasks = state.tasks.filter((t) => t.id !== obj.id);
        saveState();
        drawMap();
        renderToday();
        openInspectorFor(null);
      }
    };
    // Add "Make project" button
    try{
      const btns = document.querySelector('#inspector .btns');
      if(btns){
        const b = document.createElement('button');
        b.className = 'btn';
        b.id = 'mkProject';
        b.textContent = 'Сделать проектом';
        btns.appendChild(b);
        b.onclick = ()=>{
          const domId = obj.projectId ? (state.projects.find(p=>p.id===obj.projectId)?.domainId) : (obj.domainId||state.activeDomain||state.domains[0]?.id);
          if(!domId) return;
          const pid = 'p'+Math.random().toString(36).slice(2,8);
          state.projects.push({ id:pid, domainId:domId, title: obj.title, tags:[...(obj.tags||[])], priority: obj.priority||2, createdAt:Date.now(), updatedAt:Date.now() });
          obj.projectId = pid;
          try{ if(state.settings && state.settings.layoutMode==='auto'){ delete obj.pos; } }catch(_){}
          obj.updatedAt = Date.now();
          saveState();
          refreshMap({ layout: true });
          openInspectorFor(state.projects.find(p=>p.id===pid));
        };
      }
    }catch(_){ }
  }
}
