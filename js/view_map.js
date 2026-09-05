// js/view_map.js
import {
  state,
  byId,
  project,
  tasksOfProject,
  clamp,
  colorByAging,
  sizeByImportance,
  daysSince,
} from "./state.js";
import { openInspectorFor } from "./inspector.js";
import { moveTask, undoTaskMove } from "./core/commands.js";
import { saveState } from "./storage.js";
import { requestSyncNow } from "./sync/runtime.js";
import { logEvent } from "./utils/analytics.js";
import { getVisibleDomainIds, setDomainVisible } from "./ui/map-session.js";

let canvas,
  tooltip,
  ctx,
  W = 0,
  H = 0,
  DPR = 1;
let nodes = [],
  edges = [];
let hoverNodeId = null;
// persistent selection: the node whose Inspector is open / that was navigated to
let selectedNodeId = null;
// transient "you are here" ring after camera navigation (e.g. Открыть задачу)
let landingPing = null; // { id, t0 }
let emptyStateEl = null; // cached #mapEmpty overlay
const viewState = {
  scale: 1,
  tx: 0,
  ty: 0,
  dragging: false,
  lastX: 0,
  lastY: 0,
};
// remember last mouse client position for mouseup fallback
let lastMouseClient = { clientX: 0, clientY: 0, offsetX: 0, offsetY: 0 };

// wheel/zoom handler
let pendingFrame = false;
function requestDraw() {
  if (pendingFrame) return;
  pendingFrame = true;
  requestAnimationFrame(() => {
    pendingFrame = false;
    drawMap();
  });
}

function onWheel(e) {
  // handle pinch/scroll zoom centered on cursor
  try {
    e.preventDefault();
  } catch (_) {}
  const d = e.deltaY || e.wheelDelta || 0;
  const zoomFactor = d > 0 ? 0.9 : 1.1;
  const old = viewState.scale;
  const next = clamp(old * zoomFactor, 0.5, 2.2);
  // keep world point under cursor stable
  const dpr = window.devicePixelRatio || 1;
  const cx = (e.offsetX || 0) * dpr;
  const cy = (e.offsetY || 0) * dpr;
  const invOld = 1 / old;
  const wx = (cx - viewState.tx) * invOld;
  const wy = (cy - viewState.ty) * invOld;
  viewState.scale = next;
  viewState.tx = cx - wx * next;
  viewState.ty = cy - wy * next;
  try {
    logEvent("map_zoom", { scale: Math.round(next * 100) / 100 });
  } catch (_) {}
  syncZoomSlider();
  requestDraw();
}
// DnD state
let draggedNode = null;
let dragOffset = { x: 0, y: 0 };
let dropTargetProjectId = null;
let dropTargetDomainId = null;
// drag threshold (px, screen space before scale/DPR)
let pendingDragNode = null;
let pendingDragStart = { x: 0, y: 0 };
// simple undo stack for moves: store { type: 'task'|'project', id, fromProjectId, toProjectId, fromPos, toPos }
let undoStack = [];
function rememberTaskMove(result) {
  if (!result?.operation) return false;
  undoStack.push({
    type: "task.move",
    moveResult: {
      before: result.before,
      operation: result.operation,
    },
  });
  if (undoStack.length > 50) undoStack.shift();
  return true;
}
// transient pending attach: { taskId, fromProjectId, toProjectId, pos }
let pendingAttach = null;
// transient pending detach: { taskId, fromProjectId, pos }
let pendingDetach = null;
// perf tuning
let dynamicEdgeCap = 300;
let allowGlow = true;
let emaDt = null; // ms
let lowFrames = 0,
  highFrames = 0;
let showFps = false;

export function initMap(canvasEl, tooltipEl) {
  canvas = canvasEl;
  tooltip = tooltipEl;
  emptyStateEl = document.getElementById("mapEmpty");
  const emptyAddButton = document.getElementById("mapEmptyAddDomain");
  if (emptyAddButton) {
    emptyAddButton.onclick = () => {
      const sidebarAddButton = document.getElementById("btnAddDomain");
      if (sidebarAddButton) sidebarAddButton.click();
    };
  }
  resize();
  window.addEventListener("resize", () => {
    resize();
    // Domain rows depend on the current canvas width. Rebuild their world
    // positions before fitting the camera, otherwise a narrow layout keeps
    // the stale desktop row geometry (and vice versa).
    layoutMap();
    try { fitAll(); } catch(_) {}
  });
  canvas.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mouseup", () => (viewState.dragging = false));
  canvas.addEventListener("mouseleave", onMouseLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("click", onClick);
  canvas.addEventListener("dblclick", onDblClick);
  layoutMap();
  drawMap();
  // Автоматически подгоняем вид под все объекты при инициализации
  setTimeout(() => {
    try { fitAll(); } catch(_) {}
  }, 100);
}

export function setShowFps() {
  showFps = !showFps;
  drawMap();
}

// Camera helpers and fit animations
export function centerView() {
  // Center all visible content on screen
  if (nodes && nodes.length > 0) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach((n) => {
      if (!n) return;
      const r = n.r || 0;
      minX = Math.min(minX, n.x - r);
      minY = Math.min(minY, n.y - r);
      maxX = Math.max(maxX, n.x + r);
      maxY = Math.max(maxY, n.y + r);
    });
    
    if (isFinite(minX)) {
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      viewState.tx = W * 0.5 - centerX;
      viewState.ty = H * 0.5 - centerY;
    }
  } else {
    viewState.tx = 0;
    viewState.ty = 0;
  }
  drawMap();
}
export function resetView() {
  viewState.scale = 1;
  viewState.tx = 0;
  viewState.ty = 0;
  syncZoomSlider();
  drawMap();
}

// keep the header zoom slider in sync with the actual camera scale
function syncZoomSlider() {
  const s = document.getElementById("zoomSlider");
  if (s) s.value = String(Math.round(viewState.scale * 100));
}

function animateTo(target, ms = 230) {
  const start = { sx: viewState.scale, tx: viewState.tx, ty: viewState.ty };
  const t0 = performance.now();
  function step() {
    const t = Math.min(1, (performance.now() - t0) / ms);
    const e = 1 - Math.pow(1 - t, 3);
    viewState.scale = start.sx + (target.sx - start.sx) * e;
    viewState.tx = start.tx + (target.tx - start.tx) * e;
    viewState.ty = start.ty + (target.ty - start.ty) * e;
    drawMap();
    syncZoomSlider();
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function fitToBBox(bx, { maxScale = 2.2 } = {}) {
  if (!bx) {
    drawMap();
    return;
  }
  const padK = 0.12; // ~12% outer padding
  const w = Math.max(1, bx.maxX - bx.minX);
  const h = Math.max(1, bx.maxY - bx.minY);
  const cx = (bx.minX + bx.maxX) / 2;
  const cy = (bx.minY + bx.maxY) / 2;
  const wPad = w * (1 + padK);
  const hPad = h * (1 + padK);
  const sx = Math.min(W / Math.max(1, wPad), H / Math.max(1, hPad));
  const scale = clamp(sx, 0.5, maxScale);
  const target = {
    sx: scale,
    tx: W * 0.5 - cx * scale,
    ty: H * 0.5 - cy * scale,
  };
  animateTo(target, 230);
}

export function fitAll() {
  if (!nodes || nodes.length === 0) {
    drawMap();
    return;
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  nodes.forEach((n) => {
    minX = Math.min(minX, n.x - n.r);
    minY = Math.min(minY, n.y - n.r);
    maxX = Math.max(maxX, n.x + n.r);
    maxY = Math.max(maxY, n.y + n.r);
  });
  // An overview should not magnify sparse data until two empty territories
  // fill the whole canvas. Deliberate object focus may still zoom to 220%.
  fitToBBox({ minX, minY, maxX, maxY }, { maxScale: 1.1 });
}

export function fitDomain(domId) {
  const dn = nodes.find(
    (n) => n._type === "domain" && n.id === domId
  );
  if (!dn) {
    drawMap();
    return;
  }
  const domainProjectIds = new Set(
    state.projects
      .filter((project) => project.domainId === dn.id)
      .map((project) => project.id)
  );
  // Include both domain-only tasks and tasks whose domain is derived from
  // their Project. Core intentionally removes domainId from project tasks.
  const members = [dn].concat(
    nodes.filter(
      (n) =>
        n._type === "project" &&
        state.projects.find((p) => p.id === n.id)?.domainId === dn.id
    )
  ).concat(
    nodes.filter(
      (n) =>
        n._type === "task" &&
        (() => {
          const task = state.tasks.find((t) => t.id === n.id);
          return task?.domainId === dn.id || domainProjectIds.has(task?.projectId);
        })()
    )
  );
  
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  members.forEach((n) => {
    minX = Math.min(minX, n.x - n.r);
    minY = Math.min(minY, n.y - n.r);
    maxX = Math.max(maxX, n.x + n.r);
    maxY = Math.max(maxY, n.y + n.r);
  });
  fitToBBox({ minX, minY, maxX, maxY });
}

export function fitActiveDomain() {
  const domId = state.activeDomain || nodes.find(node => node._type === "domain")?.id;
  if (!domId) return drawMap();
  if (!nodes.some((node) => node._type === "domain" && node.id === domId)) {
    setDomainVisible(domId, true, state.domains);
    try { window.renderSidebar?.(); } catch (_) {}
    layoutMap();
  }
  fitDomain(domId);
}

export function fitActiveProject() {
  // Находим активный проект (первый проект в активном домене или любой проект если домен не выбран)
  const pn = nodes.find(
    (n) =>
      n._type === "project" &&
      (!state.activeDomain ||
        state.projects.find((p) => p.id === n.id)?.domainId ===
          state.activeDomain)
  );
  if (!pn) {
    drawMap();
    return;
  }
  // Включаем проект и все его задачи
  const members = [pn].concat(
    nodes.filter(
      (x) =>
        x._type === "task" && 
        state.tasks.find((t) => t.id === x.id)?.projectId === pn.id
    )
  );
  
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  members.forEach((m) => {
    minX = Math.min(minX, m.x - m.r);
    minY = Math.min(minY, m.y - m.r);
    maxX = Math.max(maxX, m.x + m.r);
    maxY = Math.max(maxY, m.y + m.r);
  });
  fitToBBox({ minX, minY, maxX, maxY });
}

export function fitTask(taskId) {
  const task = state.tasks.find((t) => t.id === taskId);
  let node = nodes.find((n) => n._type === "task" && n.id === taskId);
  if (!node && task) {
    // The task lives in a domain that is not on the current map: switch to it
    // first so navigation lands on a map where the task actually exists.
    const domId =
      task.domainId ||
      (task.projectId
        ? state.projects.find((p) => p.id === task.projectId)?.domainId
        : null);
    if (domId) {
      setDomainVisible(domId, true, state.domains);
      try {
        if (window.renderSidebar) window.renderSidebar();
      } catch (_) {}
      layoutMap();
      node = nodes.find((n) => n._type === "task" && n.id === taskId);
    }
  }
  if (!node) {
    fitAll();
    return;
  }
  // mark the landed task as selected and show a short "you are here" ring
  setSelectedNode(taskId, "task", { ping: true });
  const r = node.r || 16;
  let minX = node.x - r,
    minY = node.y - r,
    maxX = node.x + r,
    maxY = node.y + r;
  if (task && task.projectId) {
    // include the whole project circle so the landing shows context,
    // not just a dot on an empty background
    const pNode = nodes.find(
      (n) => n._type === "project" && n.id === task.projectId
    );
    if (pNode) {
      minX = Math.min(minX, pNode.x - pNode.r);
      minY = Math.min(minY, pNode.y - pNode.r);
      maxX = Math.max(maxX, pNode.x + pNode.r);
      maxY = Math.max(maxY, pNode.y + pNode.r);
    }
  } else {
    // independent task: keep a comfortable margin around the dot
    const pad = 40 * DPR;
    minX = node.x - r - pad;
    minY = node.y - r - pad;
    maxX = node.x + r + pad;
    maxY = node.y + r + pad;
  }
  fitToBBox({ minX, minY, maxX, maxY });
}

export function resize() {
  const rect = document.getElementById("canvasWrap").getBoundingClientRect();
  DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  W = Math.floor(rect.width * DPR);
  H = Math.floor(rect.height * DPR);
  canvas.width = W;
  canvas.height = H;
  canvas.style.width = rect.width + "px";
  canvas.style.height = rect.height + "px";
  ctx = canvas.getContext("2d");
}

function calculateProjectRadius(tasks) {
  // Минимальный размер для пустых проектов (с учетом DPR)
  const baseRadius = 48 * DPR;

  if (tasks.length === 0) return baseRadius;

  // Вычисляем общую площадь всех задач с учетом DPR
  const totalTaskArea = tasks.reduce((sum, task) => {
    const taskSize = sizeByImportance(task) * DPR;
    return sum + Math.PI * taskSize * taskSize;
  }, 0);

  // Добавляем пространство для отступов между задачами (50%)
  const areaWithPadding = totalTaskArea * 1.5;

  // Вычисляем радиус круга, который может вместить эту площадь
  // и добавляем отступ от края
  const radiusFromArea = Math.sqrt(areaWithPadding / Math.PI) + 32 * DPR;

  // Возвращаем максимальное значение между базовым радиусом и вычисленным
  return Math.max(baseRadius, radiusFromArea);
}
export function layoutMap() {
  nodes = [];
  edges = [];
  const visibleDomainIds = getVisibleDomainIds(state.domains);
  const domains = state.domains.filter((domain) => visibleDomainIds.has(domain.id));
  const domainIds = new Set(domains.map((domain) => domain.id));
  const gap = 32 * DPR;
  const matchesFilter = (task) =>
    !state.filterTag || (task.tags || []).includes(state.filterTag);

  const visibleProjects = state.projects
    .filter((project) => domainIds.has(project.domainId))
    .filter((project) =>
      !state.filterTag || state.tasks.some(
        (task) => task.projectId === project.id && matchesFilter(task)
      )
    );
  const visibleProjectIds = new Set(visibleProjects.map((project) => project.id));
  const taskList = state.tasks.filter(
    (task) => visibleProjectIds.has(task.projectId) && matchesFilter(task)
  );

  // Build each Domain from the same child descriptors later used to place
  // Projects and the virtual "Без проекта" group. This keeps sizing and
  // placement coherent and prevents the virtual group from occupying a
  // Project's slot.
  const domainMeta = new Map();
  const domainLayout = domains.map(domain => {
    const projects = visibleProjects.filter(project => project.domainId === domain.id);
    const independentTasks = state.tasks
      .filter(task => !task.projectId && task.domainId === domain.id && matchesFilter(task))
      .sort((a, b) =>
        (a.createdAt || 0) - (b.createdAt || 0) ||
        String(a.id).localeCompare(String(b.id))
      );
    const children = projects.map(project => ({
      key: `project:${project.id}`,
      type: "project",
      id: project.id,
      r: clamp(
        calculateProjectRadius(taskList.filter(task => task.projectId === project.id)) / DPR,
        48,
        196
      ) * DPR,
    }));
    const groupRadius = independentTasks.length
      ? clamp(42 + Math.sqrt(independentTasks.length) * 10, 48, 82) * DPR
      : 0;
    if (groupRadius) {
      children.push({
        key: `unassigned:${domain.id}`,
        type: "unassigned",
        id: domain.id,
        r: groupRadius,
      });
    }
    const maxChildRadius = children.length
      ? Math.max(...children.map(child => child.r))
      : 0;
    const orbit = children.length > 1
      ? (maxChildRadius + 14 * DPR) / Math.max(0.35, Math.sin(Math.PI / children.length))
      : 0;
    const requiredRadius = children.length
      ? orbit + maxChildRadius + 30 * DPR
      : 112 * DPR;
    const meta = {
      domain,
      projects,
      independentTasks,
      children,
      groupRadius,
      r: clamp(requiredRadius / DPR, 112, 260) * DPR,
    };
    domainMeta.set(domain.id, meta);
    return meta;
  });

  // Greedy centered rows keep the overview useful on medium and narrow widths.
  const availableWidth = Math.max(320 * DPR, W - 56 * DPR);
  const rows = [];
  let row = [];
  let rowWidth = 0;
  domainLayout.forEach(item => {
    const width = item.r * 2;
    const nextWidth = row.length ? rowWidth + gap + width : width;
    if (row.length && nextWidth > availableWidth) {
      rows.push(row);
      row = [];
      rowWidth = 0;
    }
    row.push(item);
    rowWidth += (row.length > 1 ? gap : 0) + width;
  });
  if (row.length) rows.push(row);
  const rowHeights = rows.map(items => Math.max(...items.map(item => item.r * 2)));
  const contentHeight = rowHeights.reduce((sum, height) => sum + height, 0) + Math.max(0, rows.length - 1) * gap;
  let rowY = (H - contentHeight) / 2;
  const domainPositions = new Map();
  rows.forEach((items, rowIndex) => {
    const width = items.reduce((sum, item) => sum + item.r * 2, 0) + Math.max(0, items.length - 1) * gap;
    let x = (W - width) / 2;
    items.forEach(item => {
      domainPositions.set(item.domain.id, {
        x: x + item.r,
        y: rowY + rowHeights[rowIndex] / 2,
        r: item.r,
      });
      x += item.r * 2 + gap;
    });
    rowY += rowHeights[rowIndex] + gap;
  });

  domains.forEach((d) => {
    const position = domainPositions.get(d.id);
    const meta = domainMeta.get(d.id);
    const allProjects = state.projects.filter(project => project.domainId === d.id);
    const allProjectIds = new Set(allProjects.map(project => project.id));
    const allTasks = state.tasks.filter(task => task.domainId === d.id || allProjectIds.has(task.projectId));
    const x = position.x;
    const y = position.y;
    const color = (d.color || "").startsWith("var(")
      ? getComputedStyle(document.documentElement)
          .getPropertyValue(d.color.replace("var(", "").replace(")", "").trim())
          .trim()
      : d.color || "#2dd4bf";
    nodes.push({
      _type: "domain",
      id: d.id,
      title: d.title,
      x,
      y,
      r: position.r,
      color,
      projectCount: allProjects.length,
      taskCount: allTasks.length,
      visibleProjectCount: meta.projects.length,
      visibleTaskCount:
        taskList.filter(task => allProjectIds.has(task.projectId)).length +
        meta.independentTasks.length,
    });
  });

  const childSlots = new Map();
  domainLayout.forEach((meta) => {
    const dNode = nodes.find(node => node._type === "domain" && node.id === meta.domain.id);
    if (!dNode || !meta.children.length) return;
    const effectiveRadii = meta.children.map(child =>
      Math.min(child.r, Math.max(24 * DPR, dNode.r - 32 * DPR))
    );
    const maxChildRadius = Math.max(...effectiveRadii);
    const orbit = meta.children.length === 1
      ? 0
      : Math.max(0, dNode.r - maxChildRadius - 26 * DPR);
    meta.children.forEach((child, index) => {
      const angle = -Math.PI / 2 + (index / meta.children.length) * Math.PI * 2;
      childSlots.set(child.key, {
        x: dNode.x + Math.cos(angle) * orbit,
        y: dNode.y + Math.sin(angle) * orbit,
        r: effectiveRadii[index],
      });
    });
  });

  visibleProjects.forEach((p) => {
    const dNode = nodes.find(
      (n) => n._type === "domain" && n.id === p.domainId
    );
    const slot = childSlots.get(`project:${p.id}`);
    const saved = p.pos || p._pos;
    const useSaved =
      state.settings?.layoutMode === "manual" &&
      saved &&
      typeof saved.x === "number" &&
      typeof saved.y === "number";
    nodes.push({
      _type: "project",
      id: p.id,
      title: p.title,
      x: useSaved ? saved.x : slot.x,
      y: useSaved ? saved.y : slot.y,
      r: slot.r,
      parent: dNode.id,
    });
  });

  const golden = Math.PI * (3 - Math.sqrt(5));
  taskList.forEach((t) => {
    if (t.projectId) {
      const pNode = nodes.find(
        (n) => n._type === "project" && n.id === t.projectId
      );
      if (!pNode) return;
      const siblings = taskList.filter((x) => x.projectId === t.projectId);
      const idx = siblings.indexOf(t);
      // 1. Считаем максимальный радиус задачи
      const maxSize = Math.max(
        ...siblings.map((s) => sizeByImportance(s) * DPR)
      );
      // 2. Минимальное расстояние между центрами задач
      const minDist = maxSize * 2.2 + 10 * DPR;
      // 3. Максимальный радиус для размещения
      const maxR = pNode.r - maxSize - 8 * DPR;
      // 4. Группируем задачи по кольцам
      let rings = [];
      let placed = 0;
      let currentRadius = minDist;
      while (placed < siblings.length && currentRadius <= maxR) {
        const tasksInRing = Math.floor((2 * Math.PI * currentRadius) / minDist);
        const ringTasks = siblings.slice(placed, placed + tasksInRing);
        rings.push({ radius: currentRadius, tasks: ringTasks });
        placed += tasksInRing;
        currentRadius += minDist;
      }
      // Если задач больше, чем поместилось на кольцах, докладываем в «последнее кольцо»
      if (placed < siblings.length) {
        // ГАРД: могло не создаться ни одного кольца (узкий maxR и т.п.)
        if (rings.length === 0) {
          rings.push({ radius: currentRadius, tasks: [] });
        }
        const last = rings[rings.length - 1];
        last.tasks = (last.tasks || []).concat(siblings.slice(placed));
      }

      // 5. Для каждой задачи определяем её позицию
      let found = false;
      for (let r = 0; r < rings.length; r++) {
        const ring = rings[r] || { radius: minDist, tasks: [] };
        const tasks = (ring && ring.tasks) || [];
        const radius = ring.radius;
        for (let k = 0; k < tasks.length; k++) {
          if (tasks[k].id === t.id) {
            const angle = (k / tasks.length) * 2 * Math.PI;
            const x = pNode.x + Math.cos(angle) * radius;
            const y = pNode.y + Math.sin(angle) * radius;
            const savedTask = t.pos || t._pos;
            const useSaved = state.settings?.layoutMode === "manual" && savedTask && typeof savedTask.x === "number" && typeof savedTask.y === "number";
            nodes.push({
              _type: "task",
              id: t.id,
              title: t.title,
              x: useSaved ? savedTask.x : x,
              y: useSaved ? savedTask.y : y,
              r: sizeByImportance(t) * DPR,
              status: t.status,
              aging: t.updatedAt,
            });
            found = true;
            break;
          }
        }
        if (found) break;
      }
    }
  });

  // Independent tasks: render in the shared child slot reserved for the
  // virtual "Без проекта" group (auto), or at saved positions (manual).
  try {
    const indepAll = state.tasks
      .filter((t) => !t.projectId)
      .filter(
        (t) => !state.filterTag || (t.tags || []).includes(state.filterTag)
      );
    
    // Разделяем на задачи с доменом и полностью независимые
    const tasksWithDomain = indepAll.filter(t => t.domainId);
    const fullyIndependent = indepAll.filter(t => !t.domainId);
    
    // Задачи без проекта образуют компактную, неперсистентную группу внутри домена.
    domains.forEach((d) => {
      const dNode = nodes.find((n) => n._type === "domain" && n.id === d.id);
      if (!dNode) return;
      const list = tasksWithDomain
        .filter((t) => t.domainId === d.id)
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || String(a.id).localeCompare(String(b.id)));
      const total = list.length;
      if (!total) return;
      const slot = childSlots.get(`unassigned:${d.id}`);
      const groupRadius = slot?.r || clamp(42 + Math.sqrt(total) * 10, 48, 82) * DPR;
      const groupX = slot?.x ?? dNode.x;
      const groupY = slot?.y ?? dNode.y;
      nodes.push({
        _type: "unassigned",
        id: `unassigned:${d.id}`,
        domainId: d.id,
        title: "Без проекта",
        count: total,
        x: groupX,
        y: groupY,
        r: groupRadius,
      });
      list.forEach((t, idx) => {
        const savedT = t.pos || t._pos;
        const useSaved = state.settings?.layoutMode === "manual" && savedT && typeof savedT.x === "number" && typeof savedT.y === "number";
        if (useSaved) {
          // Используем сохраненную позицию (куда перетащил пользователь)
          nodes.push({
            _type: "task",
            id: t.id,
            title: t.title,
            x: savedT.x,
            y: savedT.y,
            r: sizeByImportance(t) * DPR,
            status: t.status,
            aging: t.updatedAt,
          });
        } else {
          const taskRadius = sizeByImportance(t) * DPR;
          const orbit = total === 1 ? 0 : Math.sqrt((idx + 0.55) / total) * Math.max(0, groupRadius - taskRadius - 12 * DPR);
          const angle = idx * golden - Math.PI / 2;
          const x = groupX + Math.cos(angle) * orbit;
          const y = groupY + Math.sin(angle) * orbit;
          nodes.push({
            _type: "task",
            id: t.id,
            title: t.title,
            x,
            y,
            r: sizeByImportance(t) * DPR,
            status: t.status,
            aging: t.updatedAt,
          });
        }
      });
    });
    
    // Полностью независимые задачи размещаем там, куда их перетащили
    fullyIndependent.forEach((t, idx) => {
      const savedT = t.pos || t._pos;
      if (savedT && typeof savedT.x === "number" && typeof savedT.y === "number") {
        // Используем сохраненную позицию (куда перетащил пользователь)
        nodes.push({
          _type: "task",
          id: t.id,
          title: t.title,
          x: savedT.x,
          y: savedT.y,
          r: sizeByImportance(t) * DPR,
          status: t.status,
          aging: t.updatedAt,
        });
      } else {
        // Только если нет сохраненной позиции - размещаем справа от всех доменов
        const maxDomainX = domains.length
          ? Math.max(...domains.map(d => {
              const dNode = nodes.find(n => n._type === 'domain' && n.id === d.id);
              return dNode ? dNode.x + dNode.r : 0;
            }))
          : W * 0.5;
        const startX = maxDomainX + 100 * DPR;
        const spacing = 80 * DPR;
        const x = startX + (idx % 3) * spacing;
        const y = H * 0.3 + Math.floor(idx / 3) * spacing;
        nodes.push({
          _type: "task",
          id: t.id,
          title: t.title,
          x,
          y,
          r: sizeByImportance(t) * DPR,
          status: t.status,
          aging: t.updatedAt,
        });
      }
    });
  } catch (_) {
    /* ignore */
  }

  if (state.showLinks) {
    const tasks = nodes.filter((n) => n._type === "task");
    const visibleProjectIds = new Set(visibleProjects.map(project => project.id));
    const dataTasks = state.tasks.filter(task =>
      visibleProjectIds.has(task.projectId) ||
      (!task.projectId && domains.some(domain => domain.id === task.domainId))
    );
    const keyById = Object.fromEntries(tasks.map((n) => [n.id, n]));
    const tagMap = {};
    dataTasks.forEach((t) => {
      (t.tags || []).forEach((tag) => {
        if (!tagMap[tag]) tagMap[tag] = [];
        tagMap[tag].push(t.id);
      });
    });
    Object.entries(tagMap).forEach(([tag, ids]) => {
      const limited = ids.slice(0, 8);
      for (let i = 0; i < limited.length; i++) {
        for (let j = i + 1; j < limited.length; j++) {
          const a = keyById[limited[i]],
            b = keyById[limited[j]];
          if (!a || !b) continue;
          edges.push({ a, b, tag, color: "#1e2f53", w: 0.7 * DPR });
        }
      }
    });
    const cap = Math.min(state.maxEdges || 300, dynamicEdgeCap || 300);
    edges = edges.slice(0, cap);
  }
}

export function drawMap() {
  if (!ctx) return;
  // if nodes not prepared (empty), try to rebuild layout once — helps recover after edits
  if (!nodes || nodes.length === 0) {
    try {
      layoutMap();
    } catch (_) {}
  }
  const t0 = performance.now();
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  // single transform matrix: scale + translate
  ctx.setTransform(
    viewState.scale,
    0,
    0,
    viewState.scale,
    viewState.tx,
    viewState.ty
  );

  // CSS-pixel-constant screen size under any zoom: pass a CSS px value, get
  // the world-unit equivalent (labels, rings, dashes stay readable at 50%..220%)
  const css = (v) => (v * DPR) / viewState.scale;
  const fitLabel = (value, maxWidth) => {
    const original = String(value || "");
    if (ctx.measureText(original).width <= maxWidth) return original;
    let text = original;
    while (text.length > 1 && ctx.measureText(`${text}…`).width > maxWidth) {
      text = text.slice(0, -1);
    }
    return `${text}…`;
  };
  // empty-state overlay: nothing to show on the map yet
  if (emptyStateEl) emptyStateEl.hidden = nodes.length > 0;

  // subtle stars
  ctx.globalAlpha = 0.3;
  for (let i = 0; i < 40; i++) {
    const x = (i * 97) % W,
      y = (i * 57) % H,
      r = (i % 3) + 0.6;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = "#0f1627";
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // compute viewport in world coords for culling
  const inv = 1 / Math.max(0.0001, viewState.scale);
  const pad = 120 * inv;
  const vx0 = -viewState.tx * inv - pad;
  const vy0 = -viewState.ty * inv - pad;
  const vx1 = (W - viewState.tx) * inv + pad;
  const vy1 = (H - viewState.ty) * inv + pad;
  const inView = (x, y, r = 0) =>
    x + r > vx0 && x - r < vx1 && y + r > vy0 && y - r < vy1;

  // edges
  if (state.showLinks) {
    ctx.lineCap = "round";
    edges.forEach((e) => {
      if (!inView(e.a.x, e.a.y, e.a.r) && !inView(e.b.x, e.b.y, e.b.r)) return;
      ctx.beginPath();
      const a = e.a,
        b = e.b;
      const mx = (a.x + b.x) / 2,
        my = (a.y + b.y) / 2;
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const k = 0.12 * (1 / (1 + dist / (300 * DPR)));
      const dx = (b.y - a.y) * k,
        dy = (a.x - b.x) * k;
      ctx.moveTo(a.x, a.y);
      ctx.bezierCurveTo(mx + dx, my + dy, mx - dx, my - dy, b.x, b.y);
      ctx.strokeStyle = e.color;
      ctx.lineWidth = e.w;
      ctx.stroke();
    });
  }

  // Hover highlights only the hovered object and its actual links. Neighbor
  // rings made hover compete with persistent selection and obscured hierarchy.
  if (hoverNodeId) {
    edges.forEach((e) => {
      if (e.a.id === hoverNodeId || e.b.id === hoverNodeId) {
        ctx.beginPath();
        const a = e.a,
          b = e.b;
        const mx = (a.x + b.x) / 2,
          my = (a.y + b.y) / 2;
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        const k = 0.12 * (1 / (1 + dist / (300 * DPR)));
        const dx = (b.y - a.y) * k,
          dy = (a.x - b.x) * k;
        ctx.moveTo(a.x, a.y);
        ctx.bezierCurveTo(mx + dx, my + dy, mx - dx, my - dy, b.x, b.y);
        ctx.strokeStyle = "#7fb3ff";
        ctx.lineWidth = 2 * DPR;
        ctx.stroke();
      }
    });
  }

  // domains
  nodes
    .filter((n) => n._type === "domain")
    .forEach((n) => {
      if (!inView(n.x, n.y, n.r + 30 * DPR)) return;
      const grad = ctx.createRadialGradient(n.x, n.y, n.r * 0.3, n.x, n.y, n.r);
      grad.addColorStop(0, n.color + "33");
      grad.addColorStop(1, "#0000");
      ctx.beginPath();
      ctx.fillStyle = grad;
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fill();
      // Domain is a quiet territory, not another status ring.
      if (dropTargetDomainId === n.id || hoverNodeId === n.id) {
        ctx.beginPath();
        ctx.strokeStyle = dropTargetDomainId === n.id ? "#7fffd4" : "rgba(207,232,255,.8)";
        ctx.lineWidth = dropTargetDomainId === n.id ? css(3) : css(1.5);
        ctx.arc(n.x, n.y, n.r + css(5), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.strokeStyle = `${n.color}88`;
      ctx.lineWidth = css(1.1);
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.stroke();
      // north tick: a small cartographic cue that distinguishes a domain
      ctx.beginPath();
      ctx.strokeStyle = n.color;
      ctx.lineWidth = css(2);
      ctx.moveTo(n.x, n.y - n.r - css(3));
      ctx.lineTo(n.x, n.y - n.r + css(7));
      ctx.stroke();
      ctx.fillStyle = "#cfe8ff";
      ctx.font = `600 ${css(12)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textAlign = "center";
      ctx.fillText(
        fitLabel(`ДОМЕН · ${n.title}`, css(210)),
        n.x,
        n.y - n.r - css(13)
      );
      if (state.activeDomain === n.id) {
        const label = "КОНТЕКСТ ВВОДА";
        ctx.font = `700 ${css(9)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        const width = ctx.measureText(label).width + css(14);
        const y = n.y - n.r + css(18);
        ctx.fillStyle = "rgba(86,204,242,.16)";
        ctx.strokeStyle = "rgba(86,204,242,.55)";
        ctx.lineWidth = css(1);
        ctx.beginPath();
        ctx.roundRect(n.x - width / 2, y - css(10), width, css(18), css(8));
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#9ee6ff";
        ctx.fillText(label, n.x, y + css(3));
      }
    });

  // Materials remain in their context: one count badge, never one orb per note.
  nodes.filter(n => n._type === 'domain' || n._type === 'project').forEach(n => {
    const count = state.knowledge.filter(item => n._type === 'project' ? item.projectId === n.id :
      (!item.projectId && item.domainId === n.id)).length;
    if (!count) return;
    ctx.font = `600 ${css(11)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#b9cbe4';
    ctx.fillText(`Мысли и заметки · ${count}`, n.x, n.y + n.r + css(22));
  });

  // View-only home for tasks that belong to a Domain but not to a Project.
  nodes
    .filter((n) => n._type === "unassigned")
    .forEach((n) => {
      if (!inView(n.x, n.y, n.r + 24 * DPR)) return;
      ctx.beginPath();
      ctx.fillStyle = hoverNodeId === n.id ? "rgba(86,204,242,.09)" : "rgba(86,204,242,.045)";
      ctx.strokeStyle = hoverNodeId === n.id ? "rgba(147,197,253,.82)" : "rgba(147,197,253,.3)";
      ctx.lineWidth = css(1.1);
      ctx.setLineDash([css(4), css(4)]);
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#9dbde0";
      ctx.font = `650 ${css(10.5)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textAlign = "center";
      ctx.fillText(`БЕЗ ПРОЕКТА · ${n.count}`, n.x, n.y - n.r - css(8));
    });

  // projects
  nodes
    .filter((n) => n._type === "project")
    .forEach((n) => {
      if (!inView(n.x, n.y, n.r + 30 * DPR)) return;
      // highlight if drop target (pulsing)
      if (dropTargetProjectId === n.id) {
        const t = (performance.now() / 300) % (Math.PI * 2);
        const pulse = 1 + Math.sin(t) * 0.18;
        ctx.save();
        ctx.shadowColor = "#ffe066";
        ctx.shadowBlur = 22 * DPR;
        ctx.lineWidth = 6 * DPR * pulse;
        ctx.strokeStyle = "#ffd27a";
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 18 * DPR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      // A project is a contained workspace: a quiet territory plus a diamond hub.
      ctx.beginPath();
      ctx.fillStyle = "rgba(96,165,250,.025)";
      ctx.arc(n.x, n.y, n.r + css(18), 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.strokeStyle = hoverNodeId === n.id ? "rgba(147,197,253,.9)" : "rgba(96,165,250,.24)";
      ctx.lineWidth = hoverNodeId === n.id ? css(1.6) : css(1);
      ctx.arc(n.x, n.y, n.r + css(18), 0, Math.PI * 2);
      ctx.stroke();
      const hub = css(7);
      ctx.save();
      ctx.translate(n.x, n.y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = "#8ab4ff";
      ctx.fillRect(-hub, -hub, hub * 2, hub * 2);
      ctx.restore();
      ctx.fillStyle = "#cde1ff";
      ctx.font = `600 ${css(11.5)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      // project titles stay readable at normal zoom; below ~0.65 they would
      // collide inside packed domains, so they yield to hover tooltips
      if (viewState.scale >= 0.82 || hoverNodeId === n.id || selectedNodeId === n.id) {
        ctx.fillText(
          fitLabel(`Проект · ${n.title}`, css(170)),
          n.x,
          n.y - n.r - css(11)
        );
      }
    });

  // transient drag feedback: dashed connector from dragged task to potential drop target
  if (draggedNode && draggedNode._type === "task") {
    try {
      const target = nodes.find(
        (n) => n._type === "project" && n.id === dropTargetProjectId
      );
      if (target) {
        ctx.beginPath();
        ctx.setLineDash([8 * DPR, 6 * DPR]);
        ctx.strokeStyle = "#ffd27a";
        ctx.lineWidth = 1.6 * DPR;
        ctx.moveTo(draggedNode.x, draggedNode.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    } catch (e) {}
  }

  // tasks
  nodes
    .filter((n) => n._type === "task")
    .forEach((n) => {
      if (!inView(n.x, n.y, n.r + 20 * DPR)) return;
      const t = state.tasks.find((x) => x.id === n.id);
      const baseColor =
        n.status === "done"
          ? "#6b7280"
          : n.status === "today"
          ? "#ffd166"
          : n.status === "doing"
          ? "#60a5fa"
          : "#9ca3af";
      if (state.showAging && selectedNodeId !== n.id) {
        ctx.beginPath();
        ctx.arc(
          n.x,
          n.y,
          n.r + css(3),
          -Math.PI * 0.72,
          -Math.PI * 0.18
        );
        ctx.strokeStyle = colorByAging(n.aging);
        ctx.lineWidth = css(2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      if (state.showGlow && allowGlow) {
        ctx.shadowColor = baseColor;
        ctx.shadowBlur = 12 * DPR;
      } else {
        ctx.shadowBlur = 0;
      }
      ctx.fillStyle = baseColor;
      // done: dimmed fill + a check glyph, so status never relies on color alone
      if (n.status === "done") ctx.globalAlpha = 0.55;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      if (hoverNodeId === n.id && selectedNodeId !== n.id) {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(207,232,255,.92)";
        ctx.lineWidth = css(1.4);
        ctx.arc(n.x, n.y, n.r + css(6), 0, Math.PI * 2);
        ctx.stroke();
      }
      if (n.status === "today") {
        ctx.beginPath();
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = css(1.5);
        ctx.arc(n.x, n.y, n.r + css(5), 0, Math.PI * 2);
        ctx.stroke();
      } else if (n.status === "doing") {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(147,197,253,0.9)";
        ctx.lineWidth = css(1.5);
        ctx.setLineDash([css(2.5), css(2.5)]);
        ctx.arc(n.x, n.y, n.r + css(4.5), 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (n.status === "done" && n.r * viewState.scale >= 7) {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(255,255,255,0.92)";
        ctx.lineWidth = css(1.4);
        ctx.lineCap = "round";
        const s = n.r * 0.5;
        ctx.moveTo(n.x - s * 0.55, n.y + s * 0.05);
        ctx.lineTo(n.x - s * 0.12, n.y + s * 0.4);
        ctx.lineTo(n.x + s * 0.55, n.y - s * 0.42);
        ctx.stroke();
        ctx.lineCap = "butt";
      }
      // Progressive disclosure: the active/hovered task is always named;
      // all task labels appear only once the user has deliberately zoomed in.
      const showTaskLabel =
        selectedNodeId === n.id ||
        hoverNodeId === n.id ||
        (viewState.scale >= 1.2 && n.r * viewState.scale >= 8);
      if (showTaskLabel) {
        ctx.font = `${selectedNodeId === n.id ? 600 : 400} ${css(10.5)}px system-ui`;
        ctx.textAlign = "center";
        const maxW = css(110);
        const text = fitLabel(n.title, maxW);
        let labelX = n.x;
        let labelY = n.y + n.r + css(12);
        if (selectedNodeId === n.id && viewState.scale < 0.82 && t?.projectId) {
          const parentProject = nodes.find(
            (item) => item._type === "project" && item.id === t.projectId
          );
          if (parentProject) {
            labelX = parentProject.x;
            labelY = parentProject.y + parentProject.r + css(30);
          }
        }
        ctx.lineWidth = css(2.5);
        ctx.strokeStyle = "rgba(11,15,23,0.85)";
        ctx.strokeText(text, labelX, labelY);
        ctx.fillStyle = n.status === "done" ? "#8b98a9" : "#cfe0f5";
        ctx.fillText(text, labelX, labelY);
      }
    });

  // Visualize pending attach (dashed connector + highlights)
  if (pendingAttach) {
    try {
      const taskNode = nodes.find(
        (n) => n._type === "task" && n.id === pendingAttach.taskId
      );
      const projNode = nodes.find(
        (n) => n._type === "project" && n.id === pendingAttach.toProjectId
      );
      if (taskNode && projNode) {
        // dashed connector
        ctx.beginPath();
        ctx.setLineDash([6 * DPR, 6 * DPR]);
        ctx.strokeStyle = "#ffd27a";
        ctx.lineWidth = 1.5 * DPR;
        ctx.moveTo(taskNode.x, taskNode.y);
        ctx.lineTo(projNode.x, projNode.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // highlight task outline
        ctx.beginPath();
        ctx.strokeStyle = "#ffcc66";
        ctx.lineWidth = 3 * DPR;
        ctx.arc(taskNode.x, taskNode.y, taskNode.r + 8 * DPR, 0, Math.PI * 2);
        ctx.stroke();

        // highlight target project with small badge
        ctx.beginPath();
        ctx.fillStyle = "#ffd27a";
        const bx = projNode.x + (projNode.r + 10 * DPR) * Math.cos(0.2);
        const by = projNode.y - (projNode.r + 10 * DPR) * Math.sin(0.2);
        ctx.arc(bx, by, 6 * DPR, 0, Math.PI * 2);
        ctx.fill();
      }
    } catch (e) {
      // defensive: ignore drawing errors
    }
  }

  // active object ring + navigation ping (drawn on top of everything)
  drawSelection();
  drawLandingPing();

  // FPS overlay
  if (showFps) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = "#a0b6d6";
    ctx.font = `${12 * DPR}px system-ui`;
    const fps = (1000 / (emaDt || 16)).toFixed(0);
    ctx.fillText(`FPS: ${fps}`, 8 * DPR, 16 * DPR);
    ctx.restore();
  }
  ctx.restore();
  // perf bookkeeping with hysteresis
  const dt = performance.now() - t0;
  emaDt = emaDt == null ? dt : emaDt * 0.9 + dt * 0.1;
  if (emaDt > 22) {
    // ~45 fps
    lowFrames++;
    highFrames = 0;
    if (lowFrames > 10) {
      dynamicEdgeCap = Math.max(100, dynamicEdgeCap - 25);
      allowGlow = false;
      lowFrames = 0;
    }
  } else if (emaDt < 14) {
    // ~70+ fps
    highFrames++;
    lowFrames = 0;
    if (highFrames > 10) {
      dynamicEdgeCap = Math.min(state.maxEdges || 300, dynamicEdgeCap + 10);
      allowGlow = true;
      highFrames = 0;
    }
  }
}
// optionally draw debug overlay
debugOverlay();

// DEBUG: optional overlay to help diagnose layout issues
// Enable by setting `window.ALF_DEBUG = true` in the console and reloading.
function debugOverlay() {
  if (!window.ALF_DEBUG) return;
  try {
    // compute bbox of nodes
    if (nodes && nodes.length) {
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      nodes.forEach((n) => {
        minX = Math.min(minX, n.x - (n.r || 0));
        minY = Math.min(minY, n.y - (n.r || 0));
        maxX = Math.max(maxX, n.x + (n.r || 0));
        maxY = Math.max(maxY, n.y + (n.r || 0));
      });
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.strokeStyle = "rgba(255,80,80,0.9)";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        (minX * viewState.scale + viewState.tx) / DPR,
        (minY * viewState.scale + viewState.ty) / DPR,
        ((maxX - minX) * viewState.scale) / DPR,
        ((maxY - minY) * viewState.scale) / DPR
      );
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.font = "12px monospace";
      const info = `nodes:${nodes.length} view: scale=${viewState.scale.toFixed(
        2
      )} tx=${viewState.tx.toFixed(0)} ty=${viewState.ty.toFixed(0)}`;
      ctx.fillText(info, 8, 18);
      ctx.restore();
      console.log(
        "ALF_DEBUG nodes count",
        nodes.length,
        "viewState",
        viewState
      );
      console.log("ALF_DEBUG sample nodes", nodes.slice(0, 10));
    } else {
      console.log("ALF_DEBUG: nodes empty", nodes);
    }
  } catch (e) {
    console.warn("ALF_DEBUG overlay failed", e);
  }
}

function screenToWorld(x, y) {
  const dpr = window.devicePixelRatio || 1;
  const cx = x * dpr,
    cy = y * dpr;
  const invScale = 1 / viewState.scale;
  return {
    x: (cx - viewState.tx) * invScale,
    y: (cy - viewState.ty) * invScale,
  };
}
function hit(x, y) {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    const dx = x - n.x,
      dy = y - n.y;
    const rr =
      n._type === "task"
        ? n.r + 6 * DPR
        : n._type === "project"
        ? n.r + 10 * DPR
        : n.r;
    if (dx * dx + dy * dy <= rr * rr) {
      return n;
    }
  }
  return null;
}

// hit test that ignores a specific node id (useful while dragging)
function hitExcluding(x, y, ignoreId) {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    if (n.id === ignoreId) continue;
    const dx = x - n.x,
      dy = y - n.y;
    const rr =
      n._type === "task"
        ? n.r + 6 * DPR
        : n._type === "project"
        ? n.r + 10 * DPR
        : n.r;
    if (dx * dx + dy * dy <= rr * rr) {
      return n;
    }
  }
  return null;
}

function onMouseMove(e) {
  // track last mouse for mouseup outside canvas
  lastMouseClient = {
    clientX: e.clientX,
    clientY: e.clientY,
    offsetX: e.offsetX,
    offsetY: e.offsetY,
  };
  if (viewState.dragging) {
    const dx = e.clientX - viewState.lastX,
      dy = e.clientY - viewState.lastY;
    const dpr = window.devicePixelRatio || 1;
    viewState.tx += (dx * dpr) / viewState.scale;
    viewState.ty += (dy * dpr) / viewState.scale;
    viewState.lastX = e.clientX;
    viewState.lastY = e.clientY;
    requestDraw();
    return;
  }
  // promote pending drag after threshold (4-6px)
  if (pendingDragNode) {
    const dx = e.clientX - pendingDragStart.x;
    const dy = e.clientY - pendingDragStart.y;
    const dist = Math.hypot(dx, dy);
    const threshold = 5; // px
    if (dist >= threshold) {
      // start actual drag
      const pt = screenToWorld(
        pendingDragStart.x - (e.clientX - e.offsetX),
        pendingDragStart.y - (e.clientY - e.offsetY)
      );
      draggedNode = pendingDragNode;
      dragOffset.x = pt.x - pendingDragNode.x;
      dragOffset.y = pt.y - pendingDragNode.y;
      pendingDragNode = null;
      canvas.style.cursor = "grabbing";
    }
  }
  if (draggedNode) {
    const pt = screenToWorld(e.offsetX, e.offsetY);
    draggedNode.x = pt.x - dragOffset.x;
    draggedNode.y = pt.y - dragOffset.y;
    // detect potential drop targets while dragging
    dropTargetProjectId = null;
    dropTargetDomainId = null;
    const hitNode = hitExcluding(pt.x, pt.y, draggedNode.id);
    if (hitNode) {
      if (draggedNode._type === "task" && hitNode._type === "project") {
        dropTargetProjectId = hitNode.id;
      }
      if (
        (draggedNode._type === "project" || draggedNode._type === "task") &&
        hitNode._type === "domain"
      ) {
        dropTargetDomainId = hitNode.id;
      }
    }
    requestDraw();
    return;
  }
  const pt = screenToWorld(e.offsetX, e.offsetY);
  const n = hit(pt.x, pt.y);
  if (!n) {
    hoverNodeId = null;
    canvas.style.cursor = "";
    tooltip.style.opacity = 0;
    // clear drop targets when not dragging
    dropTargetProjectId = null;
    dropTargetDomainId = null;
    requestDraw();
    return;
  }
  tooltip.style.left = e.clientX + "px";
  tooltip.style.top = e.clientY + "px";
  tooltip.style.opacity = 1;
  hoverNodeId = n.id;
  canvas.style.cursor = "pointer";
  if (n._type === "task") {
    const t = state.tasks.find((x) => x.id === n.id);
    const tags = (t.tags || []).map((s) => `#${s}`).join(" ");
    const est = t.estimateMin ? ` ~${t.estimateMin}м` : "";
    tooltip.innerHTML = `🪐 <b>${t.title}</b> — ${
      t.status
    }${est}<br/><span class="hint">обновл. ${daysSince(
      t.updatedAt
    )} дн. ${tags}</span>`;
  } else if (n._type === "project") {
    const p = state.projects.find((x) => x.id === n.id);
    const tags = (p.tags || []).map((s) => `#${s}`).join(" ");
    tooltip.innerHTML = `🛰 Проект: <b>${p.title}</b>${
      tags ? `<br/><span class="hint">${tags}</span>` : ""
    }`;
  } else if (n._type === "unassigned") {
    const domain = state.domains.find(item => item.id === n.domainId);
    tooltip.innerHTML = `Без проекта: <b>${n.count} задач</b>${domain ? `<br/><span class="hint">${domain.title}</span>` : ""}`;
  } else {
    const d = state.domains.find((x) => x.id === n.id);
    tooltip.innerHTML = `🌌 Домен: <b>${d.title}</b>`;
  }
  requestDraw();
}

function onMouseLeave() {
  pendingDragNode = null;
  if (draggedNode) {
    draggedNode = null;
    canvas.style.cursor = "";
  }
  hoverNodeId = null;
  canvas.style.cursor = "";
  tooltip.style.opacity = 0;
  dropTargetProjectId = null;
  dropTargetDomainId = null;
  drawMap();
}

function onMouseDown(e) {
  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    viewState.dragging = true;
    viewState.lastX = e.clientX;
    viewState.lastY = e.clientY;
    return;
  }
  // DnD: захват задачи
  if (e.button === 0) {
    const pt = screenToWorld(e.offsetX, e.offsetY);
    const n = hit(pt.x, pt.y);
    if (n && n._type === "task") {
      pendingDragNode = n;
      pendingDragStart.x = e.clientX;
      pendingDragStart.y = e.clientY;
      dragOffset.x = pt.x - n.x;
      dragOffset.y = pt.y - n.y;
      return;
    }
  }
}
// DnD: отпускание задачи
// Consolidated mouseup handler: finalize drag, persist, push undo entry
window.addEventListener("mouseup", (e) => {
  // if drag never started, clear any pending drag
  if (!draggedNode && pendingDragNode) {
    pendingDragNode = null;
    return;
  }
  if (!draggedNode) return;
  let moved = false;
  let taskMoveDeferred = false;
  let taskMoveCommitted = false;
  // record before state for undo
  const before = {};
  if (draggedNode._type === "project") {
    const p = state.projects.find((x) => x.id === draggedNode.id);
    if (p) {
      before.fromPos = p._pos ? { x: p._pos.x, y: p._pos.y } : null;
      before.fromDomainId = p.domainId;
    }
  }

  // DnD: если есть dropTargetProjectId и он отличается от текущего projectId — переносим задачу
  // If mouseup occurred outside canvas, ensure we compute hit from last known mouse position
  if (!dropTargetProjectId && draggedNode && draggedNode._type === "task") {
    // attempt to compute target under last mouse
    const offX = lastMouseClient.offsetX;
    const offY = lastMouseClient.offsetY;
    if (typeof offX === "number") {
      const ptCheck = screenToWorld(offX, offY);
      const hitNodeCheck = hitExcluding(ptCheck.x, ptCheck.y, draggedNode.id);
      if (hitNodeCheck && hitNodeCheck._type === "project")
        dropTargetProjectId = hitNodeCheck.id;
    }
  }

  if (dropTargetProjectId && draggedNode._type === "task") {
    const task = state.tasks.find((t) => t.id === draggedNode.id);
    if (task && task.projectId !== dropTargetProjectId) {
      // Найдём все задачи, которые уже принадлежат этому проекту
      const projectTasks = state.tasks.filter(
        (t) => t.projectId === dropTargetProjectId && t.id !== draggedNode.id
      );
      const pNode = nodes.find(
        (n) => n._type === "project" && n.id === dropTargetProjectId
      );
      let pos = { x: draggedNode.x, y: draggedNode.y };
      if (pNode) {
        // Определяем угол для новой задачи
        const idx = projectTasks.length;
        const total = projectTasks.length + 1;
        const angle = (idx / total) * 2 * Math.PI;
        // Радиус размещения — по краю круга проекта с небольшим отступом внутрь
        const taskRadius = sizeByImportance(task) * DPR;
        const r = pNode.r - taskRadius - 8 * DPR;
        pos = {
          x: pNode.x + Math.cos(angle) * r,
          y: pNode.y + Math.sin(angle) * r,
        };
      }
      pendingAttach = {
        taskId: draggedNode.id,
        fromProjectId: task.projectId,
        toProjectId: dropTargetProjectId,
        pos,
      };
      taskMoveDeferred = true;
      // update inspector so user sees confirm/cancel immediately
      try {
        const obj = state.tasks.find((t) => t.id === draggedNode.id);
        openInspectorFor({ ...obj, _type: "task" });
      } catch (e) {}
      // show attach toast with buttons
      const toast = document.getElementById("toast");
      if (toast) {
        toast.className = "toast attach";
        toast.innerHTML = `Привязать задачу к проекту? <button id="attachOk">Привязать</button> <button id="attachCancel">Отменить</button>`;
        toast.style.display = "block";
        toast.style.opacity = "1";
        // handlers
        setTimeout(() => {
          const ok = document.getElementById("attachOk");
          const cancel = document.getElementById("attachCancel");
          if (ok)
            ok.onclick = () => {
              confirmAttach();
            };
          if (cancel)
            cancel.onclick = () => {
              cancelAttach();
            };
        }, 20);
      }
    }
  }

  // For projects: if dropped over a domain, move project to that domain
  if (draggedNode._type === "project") {
    // find world point under mouse
    const offX =
      e && typeof e.offsetX === "number" ? e.offsetX : lastMouseClient.offsetX;
    const offY =
      e && typeof e.offsetY === "number" ? e.offsetY : lastMouseClient.offsetY;
    const pt = screenToWorld(offX || 0, offY || 0);
    const n = hit(pt.x, pt.y);
    if (n && n._type === "domain") {
      const p = state.projects.find((x) => x.id === draggedNode.id);
      if (p && p.domainId !== n.id) {
        p.domainId = n.id;
        p.updatedAt = Date.now();
        // mark moved for toast
        var projectMoved = true;
      }
    }
  }

  // For tasks: if dropped over a domain, ask to move into that domain (select project or keep independent)
  if (draggedNode._type === "task" && dropTargetDomainId) {
    const t = state.tasks.find((x) => x.id === draggedNode.id);
    const curDomain = t?.projectId
      ? state.projects.find((p) => p.id === t.projectId)?.domainId
      : t?.domainId;
    if (t && dropTargetDomainId && dropTargetDomainId !== curDomain) {
      // Если задача была полностью независимой (без domainId), сразу прикрепляем к домену
      if (!t.domainId && !t.projectId) {
        const result = moveTask(t.id, {
          projectId: null,
          domainId: dropTargetDomainId,
          pos: { x: draggedNode.x, y: draggedNode.y },
        }, { reason: "map.attach_domain" });
        taskMoveCommitted = rememberTaskMove(result);
        requestSyncNow(); // C2: routed Task placement follows immediately
        const toast = document.getElementById("toast");
        if (toast) {
          toast.className = "toast ok";
          toast.textContent = "Задача прикреплена к домену";
          setTimeout(() => { toast.style.display = "none"; }, 1400);
        }
        layoutMap();
        drawMap();
      } else {
        // Для остальных случаев показываем модалку выбора
        taskMoveDeferred = true;
        openMoveTaskModal(t, dropTargetDomainId, {
          x: draggedNode.x,
          y: draggedNode.y,
        });
      }
    }
  }

  // If task dropped outside any domain and beyond its project circle, propose detach
  if (
    draggedNode._type === "task" &&
    !dropTargetDomainId &&
    !pendingAttach
  ) {
    const t = state.tasks.find((x) => x.id === draggedNode.id);
    if (t && t.projectId) {
      const pNode = nodes.find(
        (n) => n._type === "project" && n.id === t.projectId
      );
      if (pNode) {
        const dx = draggedNode.x - pNode.x;
        const dy = draggedNode.y - pNode.y;
        const dist = Math.hypot(dx, dy);
        if (dist > pNode.r + 12 * DPR) {
          // mirror pendingDetach flow used elsewhere
          pendingDetach = {
            taskId: draggedNode.id,
            fromProjectId: t.projectId,
            pos: { x: draggedNode.x, y: draggedNode.y },
          };
          taskMoveDeferred = true;
          const toast = document.getElementById("toast");
          if (toast) {
            toast.className = "toast detach";
            toast.innerHTML = `Отвязать задачу от проекта? <button id="detachOk">Отвязать</button> <button id="detachCancel">Отмена</button>`;
            toast.style.display = "block";
            toast.style.opacity = "1";
            setTimeout(() => {
              const ok = document.getElementById("detachOk");
              if (ok) {
                ok.onclick = () => {
                  try {
                    confirmDetach();
                  } catch (e) {
                    console.error("Error in detach confirm:", e);
                  }
                };
              }
              const cancel = document.getElementById("detachCancel");
              if (cancel) {
                cancel.onclick = () => {
                  pendingDetach = null;
                  toast.style.display = "none";
                  layoutMap();
                  drawMap();
                };
              }
            }, 10);
          }
        }
      }
    }
  }

  // persist visual position back to state
  if (draggedNode._type === "task") {
    const t = state.tasks.find((x) => x.id === draggedNode.id);
    if (t && !taskMoveDeferred && !taskMoveCommitted && !t.projectId) {
      const result = moveTask(t.id, {
        projectId: null,
        domainId: t.domainId ?? null,
        pos: { x: draggedNode.x, y: draggedNode.y },
      }, { reason: "map.reposition" });
      taskMoveCommitted = rememberTaskMove(result);
      requestSyncNow(); // C2: routed Task placement follows immediately
      moved = taskMoveCommitted;
    }
  }
  if (draggedNode._type === "project") {
    const p = state.projects.find((x) => x.id === draggedNode.id);
    if (p) {
      p.pos = { x: draggedNode.x, y: draggedNode.y };
      saveState();
    }
  }

  // record after state and push undo entry if relevant
  const after = {};
  if (draggedNode._type === "project") {
    const p = state.projects.find((x) => x.id === draggedNode.id);
    if (p) {
      after.toPos = p.pos ? { x: p.pos.x, y: p.pos.y } : null;
      after.toDomainId = p.domainId;
      if (
        before.fromPos ||
        after.toPos ||
        before.fromDomainId !== after.toDomainId
      ) {
        undoStack.push({
          type: "project",
          id: draggedNode.id,
          fromPos: before.fromPos,
          toPos: after.toPos,
          fromDomainId: before.fromDomainId,
          toDomainId: after.toDomainId,
        });
        if (undoStack.length > 50) undoStack.shift();
      }
    }
  }

  draggedNode = null;
  dropTargetProjectId = null;
  dropTargetDomainId = null;
  canvas.style.cursor = "";
  layoutMap();
  drawMap();

  // Показываем toast при успешном переносе
  if (moved) {
    const toast = document.getElementById("toast");
    if (toast) {
      toast.className = "toast ok";
      toast.textContent = "Задача перенесена";
      toast.style.display = "block";
      toast.style.opacity = "1";
      setTimeout(() => {
        toast.style.transition = "opacity .3s linear";
        toast.style.opacity = "0";
        setTimeout(() => {
          toast.style.display = "none";
          toast.style.transition = "";
        }, 320);
      }, 1800);
    }
  }
  // toast for project move
  if (typeof projectMoved !== "undefined" && projectMoved) {
    const toast = document.getElementById("toast");
    if (toast) {
      toast.className = "toast ok";
      toast.textContent = "Проект перенесён";
      toast.style.display = "block";
      toast.style.opacity = "1";
      setTimeout(() => {
        toast.style.transition = "opacity .3s linear";
        toast.style.opacity = "0";
        setTimeout(() => {
          toast.style.display = "none";
          toast.style.transition = "";
        }, 320);
      }, 1800);
    }
  }
});

// expose undo function
export function undoLastMove() {
  const item = undoStack.pop();
  if (!item) return false;
  if (item.type === "task.move") {
    const result = undoTaskMove(item.moveResult, { reason: "map.undo" });
    if (!result) return false;
    layoutMap();
    drawMap();
    return true;
  }
  if (item.type === "project") {
    const p = state.projects.find((x) => x.id === item.id);
    if (!p) return false;
    if (item.fromPos) p.pos = { x: item.fromPos.x, y: item.fromPos.y };
    saveState();
    layoutMap();
    drawMap();
    return true;
  }
  return false;
}

export function confirmAttach() {
  if (!pendingAttach) return false;
  const item = pendingAttach;
  const result = moveTask(item.taskId, {
    projectId: item.toProjectId,
  }, { reason: "map.attach_project" });
  if (!result) {
    pendingAttach = null;
    return false;
  }
  rememberTaskMove(result);
  requestSyncNow(); // C2: routed Task placement follows immediately
  pendingAttach = null;
  // hide toast
  const toast = document.getElementById("toast");
  if (toast) {
    toast.style.opacity = "0";
    setTimeout(() => {
      toast.style.display = "none";
      toast.innerHTML = "";
    }, 300);
  }
  layoutMap();
  drawMap();
  return true;
}

export function cancelAttach() {
  pendingAttach = null;
  const toast = document.getElementById("toast");
  if (toast) {
    toast.style.opacity = "0";
    setTimeout(() => {
      toast.style.display = "none";
      toast.innerHTML = "";
    }, 300);
  }
  layoutMap();
  drawMap();
}

// Confirm detach task from its current project (uses pendingDetach)
function confirmDetach() {
  try {
    if (!pendingDetach) return false;
    const item = pendingDetach;
    const t = state.tasks.find((x) => x.id === item.taskId);
    if (!t) {
      pendingDetach = null;
      return false;
    }
    
    // Определяем, находится ли задача внутри какого-либо домена
    const taskPos = item.pos || { x: 100, y: 100 };
    let insideDomain = null;
    
    // Проверяем все домены на пересечение с позицией задачи
    for (const domain of state.domains) {
      const dNode = nodes.find(n => n._type === 'domain' && n.id === domain.id);
      if (dNode) {
        const dx = taskPos.x - dNode.x;
        const dy = taskPos.y - dNode.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= dNode.r) {
          insideDomain = domain.id;
          break;
        }
      }
    }
    
    const result = moveTask(t.id, {
      projectId: null,
      domainId: insideDomain,
      pos: state.settings?.layoutMode === "auto" ? null : taskPos,
    }, { reason: "map.detach_project" });
    if (!result) {
      pendingDetach = null;
      return false;
    }
    rememberTaskMove(result);
    requestSyncNow(); // C2: routed Task placement follows immediately
    pendingDetach = null;
    const toast = document.getElementById("toast");
    if (toast) {
      toast.className = "toast ok";
      toast.textContent = insideDomain ? "Отвязано от проекта" : "Задача стала независимой";
      setTimeout(() => { toast.style.display = "none"; }, 1400);
    }
    layoutMap();
    drawMap();
    return true;
  } catch (e) {
    console.error("Error in confirmDetach:", e);
    pendingDetach = null;
    const toast = document.getElementById("toast");
    if (toast) {
      toast.className = "toast error";
      toast.textContent = "Ошибка при отвязке";
      setTimeout(() => { toast.style.display = "none"; }, 1400);
    }
    return false;
  }
}

export function getPendingAttach() {
  return pendingAttach;
}

// ── Selection & navigation feedback ─────────────────────────────────
// The Inspector and the map share one "active object". setSelectedNode is
// called from the Inspector (and from fitTask) so the ring always matches
// the Inspector, regardless of how the object was reached.
function setSelectedNode(id, _type, opts) {
  const o = opts || {};
  selectedNodeId = id || null;
  if (!id) landingPing = null;
  if (o.ping && id) {
    landingPing = { id, t0: performance.now() };
  }
  drawMap();
}

// map → Inspector refresh hook: inspector used window.mapApi.refresh but the
// function never existed, so creating a project/task from the Inspector left
// the map stale. Implement it here (layout:true rebuilds node positions).
function refreshMap(opts) {
  const o = opts || {};
  if (o.layout) layoutMap();
  drawMap();
}

function drawSelection() {
  if (!selectedNodeId) return;
  const node = nodes.find((n) => n.id === selectedNodeId);
  if (!node) return;
  const pad = node._type === "task" ? 8 : node._type === "project" ? 12 : 16;
  const gap = (pad * DPR) / viewState.scale;
  // Atlas locator: four brackets read as "active location" without adding
  // another full ring on top of status and aging contours.
  const locatorRadius = node.r + gap;
  const arcSize = Math.PI * 0.16;
  ctx.strokeStyle = "#56ccf2";
  ctx.lineWidth = (2.6 * DPR) / viewState.scale;
  ctx.lineCap = "round";
  [0, Math.PI / 2, Math.PI, Math.PI * 1.5].forEach((angle) => {
    ctx.beginPath();
    ctx.arc(node.x, node.y, locatorRadius, angle - arcSize, angle + arcSize);
    ctx.stroke();
  });
  ctx.lineCap = "butt";
  // parent-chain context: where does this object belong?
  const drawContextRing = (n) => {
    ctx.beginPath();
    ctx.strokeStyle = "rgba(86,204,242,0.34)";
    ctx.lineWidth = (1 * DPR) / viewState.scale;
    ctx.setLineDash([(5 * DPR) / viewState.scale, (4 * DPR) / viewState.scale]);
    ctx.arc(n.x, n.y, n.r + (10 * DPR) / viewState.scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  };
  if (node._type === "task") {
    const t = state.tasks.find((x) => x.id === node.id);
    if (t && t.projectId) {
      const pn = nodes.find(
        (x) => x._type === "project" && x.id === t.projectId
      );
      if (pn) drawContextRing(pn);
    }
  } else if (node._type === "project") {
    const p = state.projects.find((x) => x.id === node.id);
    if (p) {
      const dn = nodes.find((x) => x._type === "domain" && x.id === p.domainId);
      if (dn) drawContextRing(dn);
    }
  }
}

// transient expanding ring right after camera navigation (Открыть задачу etc.)
function drawLandingPing() {
  if (!landingPing || !landingPing.id) return;
  const dt = performance.now() - landingPing.t0;
  if (dt > 1200) {
    landingPing = null;
    return;
  }
  const node = nodes.find((n) => n.id === landingPing.id);
  if (!node) return;
  const p = dt / 1200;
  ctx.beginPath();
  ctx.strokeStyle = `rgba(86,204,242,${(0.85 * (1 - p)).toFixed(3)})`;
  ctx.lineWidth = ((3 - 1.5 * p) * DPR) / viewState.scale;
  ctx.arc(
    node.x,
    node.y,
    node.r + ((8 + p * 26) * DPR) / viewState.scale,
    0,
    Math.PI * 2
  );
  ctx.stroke();
}

// expose some API to the global so inspector can avoid circular import
window.mapApi = window.mapApi || {};
window.mapApi.getPendingAttach = getPendingAttach;
window.mapApi.confirmAttach = confirmAttach;
window.mapApi.cancelAttach = cancelAttach;
window.mapApi.confirmDetach = confirmDetach;
window.mapApi.drawMap = drawMap;
window.mapApi.initMap = initMap;
window.mapApi.fitAll = fitAll;
window.mapApi.fitDomain = fitDomain;
window.mapApi.fitTask = fitTask;
window.mapApi.layoutMap = layoutMap;
window.mapApi.refresh = refreshMap;
window.mapApi.setSelectedNode = setSelectedNode;
window.mapApi.getSelectedNodeId = () => selectedNodeId;
window.mapApi.getNodes = () => nodes.map((n) => ({ ...n }));
window.mapApi.getCamera = () => ({
  scale: viewState.scale,
  tx: viewState.tx,
  ty: viewState.ty,
  width: W,
  height: H,
  dpr: DPR,
});
// expose scale helpers: percent-like values (100 -> scale 1)
function getScale() {
  return Math.round(viewState.scale * 100);
}
function setZoom(percent) {
  const p = clamp(percent / 100, 0.5, 2.2);
  // keep center unchanged (zoom about center of canvas)
  const cx = W * 0.5;
  const cy = H * 0.5;
  const invOld = 1 / viewState.scale;
  const wx = (cx - viewState.tx) * invOld;
  const wy = (cy - viewState.ty) * invOld;
  viewState.scale = p;
  viewState.tx = cx - wx * p;
  viewState.ty = cy - wy * p;
  syncZoomSlider();
  drawMap();
}
window.mapApi.getScale = getScale;
window.mapApi.setZoom = setZoom;

// small modal helper (reuse existing modal structure in index.html)
function openModalLocal({
  title,
  bodyHTML,
  onConfirm,
  confirmText = "OK",
  cancelText = "Отмена",
}) {
  const modal = document.getElementById("modal");
  if (!modal) return onConfirm && onConfirm(null);
  const ttl = document.getElementById("modalTitle");
  const body = document.getElementById("modalBody");
  const ok = document.getElementById("modalOk");
  const cancel = document.getElementById("modalCancel");
  ttl.textContent = title || "";
  body.innerHTML = bodyHTML || "";
  ok.textContent = confirmText;
  cancel.textContent = cancelText;
  function close() {
    modal.style.display = "none";
    ok.onclick = null;
    cancel.onclick = null;
  }
  cancel.onclick = () => close();
  ok.onclick = () => {
    try {
      onConfirm && onConfirm(body);
    } finally {
      close();
    }
  };
  modal.style.display = "flex";
}

function openMoveTaskModal(task, targetDomainId, dropPosition = null) {
  const projs = state.projects.filter((p) => p.domainId === targetDomainId);
  const options = [`<option value="__indep__">Оставить независимой</option>`]
    .concat(projs.map((p) => `<option value="${p.id}">${p.title}</option>`))
    .join("");
  const domTitle =
    state.domains.find((d) => d.id === targetDomainId)?.title || "";
  const body = `<div style="display:flex;flex-direction:column;gap:8px">
    <div>Перенести в домен "${domTitle}"?</div>
    <label>В проект:</label>
    <select id="selProject">${options}</select>
  </div>`;
  openModalLocal({
    title: `Переместить задачу`,
    bodyHTML: body,
    confirmText: "Переместить",
    onConfirm: (bodyEl) => {
      const sel = bodyEl.querySelector("#selProject");
      const val = sel ? sel.value : "__indep__";
      const destination = val === "__indep__"
        ? {
          projectId: null,
          domainId: targetDomainId,
          pos: state.settings?.layoutMode === "auto" ? null : dropPosition,
        }
        : { projectId: val };
      const result = moveTask(task.id, destination, {
        reason: val === "__indep__" ? "map.move_domain" : "map.move_project",
      });
      if (!result) return;
      rememberTaskMove(result);
      requestSyncNow(); // C2: routed Task placement follows immediately
      const toast = document.getElementById("toast");
      if (toast) {
        toast.className = "toast ok";
        toast.textContent = "Перемещено";
        toast.style.display = "block";
        toast.style.opacity = "1";
        setTimeout(() => {
          toast.style.opacity = "0";
          setTimeout(() => {
            toast.style.display = "none";
            toast.style.transition = "";
          }, 320);
        }, 1400);
      }
      layoutMap();
      drawMap();
    },
  });
}

function onDblClick(e) {
  const pt = screenToWorld(e.offsetX, e.offsetY);
  const n = hit(pt.x, pt.y);
  try {
    logEvent("map_dblclick", { node: n?._type || "none" });
  } catch (_) {}
  if (!n) return;
  if (n._type === "project") {
    // compute bbox around project + its tasks and fit
    const pId = n.id;
    const members = nodes.filter(
      (x) =>
        (x._type === "project" && x.id === pId) ||
        (x._type === "task" &&
          state.tasks.find((t) => t.id === x.id)?.projectId === pId)
    );
    if (members.length) {
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      members.forEach((m) => {
        minX = Math.min(minX, m.x - m.r);
        minY = Math.min(minY, m.y - m.r);
        maxX = Math.max(maxX, m.x + m.r);
        maxY = Math.max(maxY, m.y + m.r);
      });
      fitToBBox({ minX, minY, maxX, maxY });
      return;
    }
  }
  if (n._type === "domain") {
    state.activeDomain = n.id;
    try { window.refreshQuickDock?.(); } catch (_) {}
    setDomainVisible(n.id, true, state.domains);
    try { window.renderSidebar?.(); } catch (_) {}
    drawMap();
    fitActiveDomain();
  }
}

function onClick(e) {
  const pt = screenToWorld(e.offsetX, e.offsetY);
  const n = hit(pt.x, pt.y);
  if (!n) {
    // Empty space returns to the atlas overview and clears the shared active
    // object, so the Inspector never claims something is still selected.
    openInspectorFor(null);
    return;
  }
  hoverNodeId = n.id;
  if (n._type === "task") {
    const obj = state.tasks.find((t) => t.id === n.id);
    openInspectorFor({ ...obj, _type: "task" });
  } else if (n._type === "project") {
    const obj = state.projects.find((p) => p.id === n.id);
    openInspectorFor({ ...obj, _type: "project" });
  } else if (n._type === "unassigned") {
    openInspectorFor({ ...n, _type: "unassigned" });
  } else {
    const obj = state.domains.find((d) => d.id === n.id);
    state.activeDomain = n.id;
    try { window.refreshQuickDock?.(); } catch (_) {}
    try { window.renderSidebar?.(); } catch (_) {}
    openInspectorFor({ ...obj, _type: "domain" });
  }
}
