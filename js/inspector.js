// js/inspector.js
import {
  state,
  byId,
  project,
  domainOf,
  tasksOfProject,
  normalizeTags,
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
import {
  createProject,
  createTask,
  deleteTask,
  promoteTaskToProject,
  updateTask,
} from "./core/commands.js";
import { renderToday } from "./view_today.js";

function forInspector(obj, type) {
  return obj ? { ...obj, _type: type } : null;
}

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
      createProject({
        domainId: obj.id,
        title,
        tags: [],
      });
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
        <button type="button" class="card inspector-card-button" data-task-id="${t.id}">
          <div>${statusPill(t.status)} <strong>${t.title}</strong></div>
          <div class="meta">#${normalizeTags(t.tags).join(" #")} · обновл. ${daysSince(
            t.updatedAt
          )} дн.</div>
        </button>
      `
        )
        .join("")}</div>
    `;
    document.getElementById("addTask").onclick = () => {
      const title = prompt("Название задачи:", "Новая задача");
      if (!title) return;
      createTask({
        projectId: obj.id,
        title,
        tags: [],
        status: "backlog",
      });
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
          createTask({
            projectId: null,
            domainId: obj.domainId,
            title,
            tags: [],
            status: 'backlog',
          });
          refreshMap({ layout: true });
          openInspectorFor(obj);
        };
      }
    }catch(_){ }
    document.getElementById("toToday").onclick = () => {
      const candidates = tks.filter((t) => t.status !== "done").slice(0, 3);
      candidates.forEach((t) => updateTask(t.id, { status: "today" }));
      drawMap();
      renderToday();
      openInspectorFor(obj);
    };
    ins.querySelectorAll("[data-task-id]").forEach((card) => {
      card.onclick = () => {
        const task = state.tasks.find((item) => item.id === card.dataset.taskId);
        if (!task) return;
        openInspectorFor(forInspector(task, "task"));
      };
    });
  }
  if (type === "task") {
    const pending = getPendingAttach();
    const pendForThis = pending && pending.taskId === obj.id;
    const taskProject = project(obj.projectId);
    const taskDomainId = obj.domainId || taskProject?.domainId;
    ins.innerHTML = `
      <h2>Задача</h2>
      <div class="kv"><strong>${obj.title}</strong></div>
      <div class="kv">Проект: ${taskProject?.title || 'Без проекта'}</div>
      <div class="kv">Домен: ${taskDomainId ? byId(state.domains, taskDomainId)?.title || 'Неизвестный домен' : 'Без домена'}</div>
      ${obj.sourceInboxId ? `<div class="kv">Источник: Входящие</div>` : ''}
      <div class="kv">Теги: #${normalizeTags(obj.tags).join(" #") || "-"}</div>
      <div class="kv">Статус: ${statusPill(obj.status)} · обновл.: ${daysSince(
      obj.updatedAt
    )} дн.</div>
      <div class="inspector-form">
        <label for="taskEditTitle">Название</label>
        <input id="taskEditTitle" type="text" maxlength="240" />
        <label for="taskEditTags">Теги</label>
        <input id="taskEditTags" type="text" placeholder="дом, покупки" />
        <div class="hint" id="taskEditError" role="status"></div>
        <button class="btn primary" type="button" id="saveTask">Сохранить изменения</button>
      </div>
      ${
        pendForThis
          ? `<div class="kv hint">Ожидает привязки к проекту: ${
              project(pending.toProjectId).title
            }</div>`
          : ""
      }
      <div class="btns">
        <button class="btn" data-st="backlog">Бэклог</button>
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
    const titleInput = document.getElementById("taskEditTitle");
    const tagsInput = document.getElementById("taskEditTags");
    titleInput.value = obj.title || "";
    tagsInput.value = normalizeTags(obj.tags).join(", ");
    document.getElementById("saveTask").onclick = () => {
      const error = document.getElementById("taskEditError");
      try {
        const result = updateTask(obj.id, {
          title: titleInput.value,
          tags: tagsInput.value.split(/[\s,#]+/),
        });
        if (!result) return;
        drawMap();
        renderToday();
        openInspectorFor(forInspector(result.task, "task"));
      } catch (err) {
        error.textContent = err?.message || "Не удалось сохранить задачу";
      }
    };
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
      b.setAttribute("aria-pressed", String(obj.status === b.dataset.st));
      if (obj.status === b.dataset.st) b.classList.add("primary");
      b.onclick = () => {
        const result = updateTask(obj.id, { status: b.dataset.st });
        if (!result) return;
        drawMap();
        renderToday();
        openInspectorFor(forInspector(result.task, "task"));
      };
    });
    document.getElementById("delTask").onclick = () => {
      if (confirm("Удалить задачу?")) {
        deleteTask(obj.id);
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
          const result = promoteTaskToProject(obj.id);
          if(!result) return;
          refreshMap({ layout: true });
          openInspectorFor(forInspector(result.project, "project"));
        };
      }
    }catch(_){ }
  }
}
