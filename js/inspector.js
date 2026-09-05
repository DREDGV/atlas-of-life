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
import { requestSyncNow } from "./sync/runtime.js";
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
  revertInboxRoute,
} from "./core/commands.js";
import { renderToday } from "./view_today.js";
import { getVisibleDomainIds } from "./ui/map-session.js";

function forInspector(obj, type) {
  return obj ? { ...obj, _type: type } : null;
}

function inspectorHeading(kind, title, path) {
  const crumbs = (path || []).filter(Boolean);
  return `
    <div class="inspector-heading">
      <div class="inspector-kind">${kind}:</div>
      <h2>${title}</h2>
      ${
        crumbs.length
          ? `<div class="inspector-path" aria-label="Положение в карте">${crumbs
              .map((crumb) => `<span>${crumb}</span>`)
              .join('<span class="inspector-path-separator" aria-hidden="true">›</span>')}</div>`
          : ""
      }
    </div>
  `;
}

const escapeKnowledge = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
const materialKind = item => item.kind === 'thought' ? 'Мысль' : 'Заметка';
function materialLocation(item){
  const project = state.projects.find(entry => entry.id === item.projectId);
  const domain = state.domains.find(entry => entry.id === (project?.domainId || item.domainId));
  return [domain?.title, project?.title].filter(Boolean).join(' / ') || 'Без контекста';
}
function appendMaterials(ins, context){
  const materials = state.knowledge.filter(item => {
    if (!context) return true;
    if (context._type === 'project') return item.projectId === context.id;
    if (context._type === 'domain') return item.domainId === context.id || state.projects.some(p => p.id === item.projectId && p.domainId === context.id);
    return false;
  });
  if (!materials.length) return;
  const section = document.createElement('section');
  section.className = 'inspector-materials';
  const heading = document.createElement('h3');
  heading.textContent = `Мысли и заметки · ${materials.length}`;
  section.append(heading);
  materials.forEach(item => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'card inspector-card-button';
    button.dataset.knowledgeId = item.id;
    button.innerHTML = `<div class="meta">${materialKind(item)} · ${escapeKnowledge(materialLocation(item))}</div><strong>${escapeKnowledge(item.title)}</strong>`;
    button.onclick = () => openInspectorFor({ ...item, _type: 'knowledge' });
    section.append(button);
  });
  ins.append(section);
}

export function openInspectorFor(obj) {
  const ins = document.getElementById("inspector");
  // The map and the Inspector always share the same active object: highlight
  // the node (or clear the highlight) so the ring matches what is shown here.
  try {
    if (window.mapApi && window.mapApi.setSelectedNode) {
      const selected = obj?._type === 'knowledge'
        ? { id: obj.projectId || obj.domainId, _type: obj.projectId ? 'project' : 'domain' }
        : obj;
      window.mapApi.setSelectedNode(
        selected?.id || null,
        selected?._type || null,
        { focus: false }
      );
    }
  } catch (_) {}
  if (!obj) {
    const visibleIds = getVisibleDomainIds(state.domains);
    const visibleDomains = state.domains.filter(domain => visibleIds.has(domain.id));
    const projectIds = new Set(state.projects.filter(project => visibleIds.has(project.domainId)).map(project => project.id));
    const visibleTasks = state.tasks.filter(task => projectIds.has(task.projectId) || (!task.projectId && visibleIds.has(task.domainId)));
    const unassignedCount = visibleTasks.filter(task => !task.projectId).length;
    const context = state.domains.find(domain => domain.id === state.activeDomain);
    ins.innerHTML = `
      ${inspectorHeading("Обзор", "Видимая карта", [context ? `Контекст: ${context.title}` : "Контекст не выбран"])}
      <div class="inspector-overview-grid">
        <div class="inspector-stat"><strong>${visibleDomains.length}</strong><span>доменов</span></div>
        <div class="inspector-stat"><strong>${projectIds.size}</strong><span>проектов</span></div>
        <div class="inspector-stat"><strong>${visibleTasks.length}</strong><span>задач</span></div>
        <div class="inspector-stat"><strong>${unassignedCount}</strong><span>без проекта</span></div>
      </div>
      <div class="hint">Чекбоксы слева меняют состав карты. Название домена задаёт контекст для новых задач, а ⌖ только фокусирует камеру.</div>
    `;
    appendMaterials(ins, null);
    return;
  }
  const type = obj._type;
  if (type === 'knowledge-library') {
    ins.innerHTML = `${inspectorHeading('Материалы', 'Мысли и заметки', [])}<div class="hint">Мысли — идеи для развития. Заметки — сведения, к которым можно вернуться.</div>`;
    appendMaterials(ins, null);
    if (!state.knowledge.length) ins.insertAdjacentHTML('beforeend', '<p class="hint">Пока нет материалов. Сохраните мысль или заметку из Входящих, выбрав домен, проект или «Без контекста».</p>');
    return;
  }
  if (type === "knowledge") {
    const item = state.knowledge.find(entry => entry.id === obj.id);
    if (!item) return openInspectorFor(null);
    const source = state.inbox.find(entry => entry.id === item.sourceInboxId);
    ins.innerHTML = `${inspectorHeading(materialKind(item), escapeKnowledge(item.title), [escapeKnowledge(materialLocation(item))])}
      <div class="knowledge-text">${escapeKnowledge(item.text)}</div>
      <div class="hint">Сохранено в Atlas · ${new Date(item.createdAt).toLocaleDateString("ru-RU")}</div>
      ${source ? `<details class="knowledge-source"><summary>Исходник из Inbox</summary><div class="knowledge-text">${escapeKnowledge(source.rawText)}</div></details>` : ""}
      <div class="btns"><button class="btn" id="materialContext">Открыть контекст</button>${source ? `<button class="btn" id="materialRevert">Вернуть в разбор</button>` : ""}</div>`;
    ins.querySelector("#materialContext").onclick = () => {
      const project = state.projects.find(entry => entry.id === item.projectId);
      const domain = state.domains.find(entry => entry.id === item.domainId);
      openInspectorFor(project ? { ...project, _type: "project" } : domain ? { ...domain, _type: "domain" } : null);
    };
    ins.querySelector("#materialRevert")?.addEventListener("click", async () => {
      try {
        const result = revertInboxRoute(source.id);
        if (result?.refused) { window.showToast?.('Материал изменён — автоматический возврат небезопасен', 'warn'); return; }
        requestSyncNow();
        openInspectorFor(null);
        const { openProcessingItem } = await import("./features/inbox/view.js");
        openProcessingItem(source.id);
      } catch (error) { window.showToast?.(error.message, "warn"); }
    });
    return;
  }
  if (type === "domain") {
    const prjs = state.projects.filter((p) => p.domainId === obj.id);
    const projectTasks = prjs.reduce(
      (a, p) => a + tasksOfProject(p.id).length,
      0
    );
    const independent = state.tasks.filter(task => !task.projectId && task.domainId === obj.id);
    const totalTasks = projectTasks + independent.length;
    ins.innerHTML = `
      ${inspectorHeading("Домен", obj.title, [obj.title])}
      <div class="kv">Проектов: ${prjs.length} · Задач: ${totalTasks} · Без проекта: ${independent.length}</div>
      <div class="btns">
        <button class="btn primary" id="addProject">+ Проект</button>
      </div>
      <div class="list">${prjs
        .map(
          (p) => `
        <button type="button" class="card inspector-card-button" data-project-id="${p.id}">
          <div><strong>${p.title}</strong></div>
          <div class="meta">#${(p.tags || []).join(" #")}</div>
          <div class="meta">Задач: ${tasksOfProject(p.id).length}</div>
        </button>
      `
        )
        .join("")}</div>
      ${independent.length ? `<div class="inspector-section-label">Без проекта</div><div class="list">${independent.map(task => `
        <button type="button" class="card inspector-card-button" data-task-id="${task.id}">
          <div>${statusPill(task.status)} <strong>${task.title}</strong></div>
          <div class="meta">#${normalizeTags(task.tags).join(" #") || "—"}</div>
        </button>`).join("")}</div>` : ''}
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
    ins.querySelectorAll("[data-project-id]").forEach((card) => {
      card.onclick = () => {
        const projectItem = state.projects.find(
          (item) => item.id === card.dataset.projectId
        );
        if (projectItem) openInspectorFor(forInspector(projectItem, "project"));
      };
    });
    ins.querySelectorAll("[data-task-id]").forEach((card) => {
      card.onclick = () => {
        const task = state.tasks.find(item => item.id === card.dataset.taskId);
        if (!task) return;
        openInspectorFor(forInspector(task, "task"));
        window.mapApi?.fitTask?.(task.id);
      };
    });
  }
  if (type === "unassigned") {
    const domain = state.domains.find(item => item.id === obj.domainId);
    const tasks = state.tasks.filter(task => !task.projectId && task.domainId === obj.domainId);
    ins.innerHTML = `
      ${inspectorHeading("Группа", "Без проекта", [domain?.title, "Без проекта"])}
      <div class="kv">Задач: ${tasks.length}</div>
      <div class="hint">Эти задачи относятся к домену, но пока не входят ни в один проект.</div>
      <div class="btns"><button class="btn primary" id="unassignedAddProject">+ Проект в домене</button></div>
      <div class="list">${tasks.map(task => `
        <button type="button" class="card inspector-card-button" data-task-id="${task.id}">
          <div>${statusPill(task.status)} <strong>${task.title}</strong></div>
          <div class="meta">#${normalizeTags(task.tags).join(" #") || "—"}</div>
        </button>`).join("")}</div>
    `;
    document.getElementById("unassignedAddProject").onclick = () => {
      const title = prompt("Название проекта:", "Новый проект");
      if (!title) return;
      const project = createProject({ domainId: obj.domainId, title, tags: [] });
      refreshMap({ layout: true });
      openInspectorFor(forInspector(project, "project"));
    };
    ins.querySelectorAll("[data-task-id]").forEach(card => {
      card.onclick = () => {
        const task = state.tasks.find(item => item.id === card.dataset.taskId);
        if (!task) return;
        openInspectorFor(forInspector(task, "task"));
        window.mapApi?.fitTask?.(task.id);
      };
    });
  }
  if (type === "project") {
    const tks = tasksOfProject(obj.id);
    const projectDomain = domainOf(obj);
    ins.innerHTML = `
      ${inspectorHeading("Проект", obj.title, [projectDomain?.title, obj.title])}
      <div class="kv">Домен: ${projectDomain?.title || "Без домена"}</div>
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
        // move the map to that task too: the Inspector is the other half of
        // the map↔Inspector link, so a card click navigates the canvas
        try {
          if (window.mapApi && window.mapApi.fitTask) {
            window.mapApi.fitTask(task.id);
          }
        } catch (_) {}
      };
    });
  }
  if (type === "task") {
    const pending = getPendingAttach();
    const pendForThis = pending && pending.taskId === obj.id;
    const taskProject = project(obj.projectId);
    const taskDomainId = obj.domainId || taskProject?.domainId;
    const taskDomain = taskDomainId ? byId(state.domains, taskDomainId) : null;
    ins.innerHTML = `
      ${inspectorHeading("Задача", obj.title, [
        taskDomain?.title || "Без домена",
        taskProject?.title || "Без проекта",
        obj.title,
      ])}
      <div class="kv">Проект: ${taskProject?.title || 'Без проекта'}</div>
      <div class="kv">Домен: ${taskDomain?.title || (taskDomainId ? 'Неизвестный домен' : 'Без домена')}</div>
      ${obj.sourceInboxId ? `<div class="kv">Источник: Входящие</div>` : ''}
      <div class="kv">Теги: #${normalizeTags(obj.tags).join(" #") || "-"}</div>
      ${obj.due ? `<div class="kv">Срок: ${obj.due.date}${obj.due.time ? ` · ${obj.due.time}` : ""}</div>` : ""}
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
      <div class="inspector-section-label">Статус</div>
      <div class="btns">
        <button class="btn" data-st="backlog">Бэклог</button>
        <button class="btn" data-st="today">Сегодня</button>
        <button class="btn" data-st="doing">В работе</button>
        <button class="btn ok" data-st="done">Готово</button>
        <button class="btn inspector-destructive" id="delTask">Удалить</button>
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
        requestSyncNow(); // C2: routed Task result follows immediately
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
        requestSyncNow(); // C2: routed Task result follows immediately
        drawMap();
        renderToday();
        openInspectorFor(forInspector(result.task, "task"));
      };
    });
    document.getElementById("delTask").onclick = () => {
      if (confirm("Удалить задачу?")) {
        deleteTask(obj.id);
        requestSyncNow(); // C2: routed result removal follows immediately
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
  if (["domain", "project"].includes(type)) appendMaterials(ins, obj);
}
