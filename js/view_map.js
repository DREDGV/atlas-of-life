import { gridAddress, childAddress, DOMAIN_RADIUS, PROJECT_RADIUS, domainPages, projectPage, revealProjectPage, revealedTaskId, revealTask } from './features/map/spatial-layout.js';
// js/view_map.js
import {
  state,
  byId,
  project,
  tasksOfProject,
  clamp,
  sizeByImportance,
  daysSince,
} from "./state.js";
import { openInspectorFor } from "./inspector.js";
import { moveTask, undoTaskMove, moveProject, undoProjectMove } from "./core/commands.js";
import { revealProject } from "./features/map/project-placement.js";
import { requestSyncNow } from "./sync/runtime.js";
import { logEvent } from "./utils/analytics.js";
import {
  getVisibleDomainIds,
  setDomainVisible,
  getMapLens,
  getMapQuery,
  isMapFilterActive,
  setMapLens,
  setMapQuery,
  MAP_LENSES,
  matchesMapView,
} from "./ui/map-session.js";
import { dueState, dueLabel, localDay } from "./features/today/model.js";
import { statusLabel, plural } from "./ui/status-language.js";
import { buildAttention } from "./features/map/attention.js";
import { renderAttention } from "./features/map/attention-view.js";
import { drawAtlasScene } from "./features/map/scene.js";
import { renderMapNavigator } from "./features/map/navigator.js";
import { containsTerritory, projectRadius } from "./features/map/geometry.js";
import { expandedCompletedProjects } from './ui/map-session.js';
import { withSpatialAddresses } from './core/spatial-address.js';

let attentionSnapshot = new Map();
let attentionDay = '';
let skipClickUntil = 0;

function openAttentionArea(area) {
  document.querySelector('[data-view="map"]')?.click();
  // A direct navigation must reveal the destination even if filters hid it.
  document.querySelector('#tagsList [data-tag=""]')?.click();
  setMapLens('all');
  setMapQuery('');
  setDomainVisible(area.domainId, true, state.domains);
  window.renderSidebar?.();
  layoutMap();
  const entity = (area.type === 'project' ? state.projects : state.domains).find(e => e.id === area.id);
  if (!entity) return;
  openInspectorFor({ ...entity, _type: area.type });
  fitDomain(area.domainId);
  window.dispatchEvent(new Event('atlas:map-reveal'));
  drawMap();
}

function openAttentionTask(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  const domainId = task.projectId ? state.projects.find(p => p.id === task.projectId)?.domainId : task.domainId;
  openAttentionArea({ type: 'domain', id: domainId, domainId });
  openInspectorFor({ ...task, _type: 'task' });
  fitTask(id);
}

// A task orb carries its meaning explicitly instead of leaving the renderer to
// re-derive it: status (filled/dashed/check), deadline urgency (red ring),
// today's Focus (crosshair), priority and age. The map used to know only
// `status` and `aging`, so an overdue task looked exactly like a backlog one.
//
// The canvas also has to respect the interface theme. Its labels used to be
// light-on-dark constants (`#cfe8ff`, `#cde1ff`, `#9dbde0`), which measured
// 1.26–1.95:1 against the light panel — that is, in the light theme the map had
// effectively no readable text. Colours that carry text or structure are read
// from here, and every pair below is checked with
// .agents/skills/atlas-visual-verification.
function mapThemeIsLight() {
  return typeof document !== "undefined"
    && document.documentElement.getAttribute("data-theme") === "light";
}

// ── Lenses and search ────────────────────────────────────────────────
// A lens is a way of looking at the map, not a change to it. Filtering never
// moves or hides an object: a task that does not match stays where it is and
// recedes, so the map keeps its shape and the user does not lose the place they
// remember. What it does change is emphasis, labels and the reported counts.
const LENS_DIM_ALPHA = 0.16;

// taskId → whether the task matches the current lens/search, for the current
// layout. Filled by layoutMap, read by the renderer and by the header counter.
let taskMatches = new Map();
let taskTotals = { tasks: 0, matching: 0 };
let staleDays = 30;

function currentTaskVisibility(task) {
  return taskMatches.get(task.id) !== false;
}

// ── Territory statistics ─────────────────────────────────────────────
// A Domain and a Project are containers, so the useful question about them is
// not "what is this" but "how is it going": how much is finished, how much is
// overdue, when does the next deadline land. One function answers it for both
// the progress ring around the territory and the hovered card, so the picture
// and the numbers cannot disagree.
export function areaStats(node) {
  if (!node || (node._type !== "project" && node._type !== "domain")) return null;
  return attentionSnapshot.get(`${node._type}:${node.id}`) || null;
}

function buildTaskMatches(list, today) {
  const matches = new Map();
  let matching = 0;
  for (const task of list) {
    const project = task.projectId
      ? state.projects.find(entry => entry.id === task.projectId)
      : null;
    const hit = matchesMapView(task, { projectTitle: project?.title || "", today, staleDays });
    matches.set(task.id, hit);
    if (hit) matching++;
  }
  return { matches, matching };
}

export function getMapFilterState() {
  return {
    lens: getMapLens(),
    query: getMapQuery(),
    active: isMapFilterActive(),
    lenses: [...MAP_LENSES],
    total: taskTotals.tasks,
    matching: taskTotals.matching,
  };
}

export function setMapFilter({ lens = getMapLens(), query = getMapQuery() } = {}) {
  setMapLens(lens);
  setMapQuery(query);
  layoutMap();
  // A search is a question about a specific task, so the map answers it by
  // moving to the first match instead of leaving the user to hunt for it.
  const firstMatch = nodes.find(node => node._type === "task" && currentTaskVisibility(node));
  const foundProject=state.projects.find(p=>getMapQuery() && p.title.toLocaleLowerCase('ru-RU').includes(getMapQuery().toLocaleLowerCase('ru-RU')));
  if(foundProject){openInspectorFor({...foundProject,_type:'project'});setSelectedNode(foundProject.id,'project');fitProject(foundProject.id);return getMapFilterState();}

  if (getMapQuery() && firstMatch) {
    fitTask(firstMatch.id);
  } else {
    drawMap();
  }
  return getMapFilterState();
}

// How much of a task the current lens lets through, in one place: the renderer
// paints with it and a regression can read it, so the two cannot drift apart.
function taskEmphasis(node) {
  if (isMapFilterActive() && !currentTaskVisibility(node)) return LENS_DIM_ALPHA;
  if (node.status === "done") return 0.55;
  return 1;
}

// Which tasks the current lens emphasises. Exposed for tests and diagnostics.
export function getTaskEmphasisList() {
  return nodes
    .filter(node => node._type === "task")
    .map(node => ({ id: node.id, title: node.title, alpha: taskEmphasis(node) }));
}

function taskNode(task, x, y, groupId = null) {
  const due = dueState(task);
  return {
    _type: "task",
    id: task.id,
    title: task.title,
    x,
    y,
    r: sizeByImportance(task) * DPR,
    status: task.status,
    aging: task.updatedAt,
    groupId,
    projectId: task.projectId || null,
    priority: Number(task.priority) || 2,
    estimateMin: Number(task.estimateMin) || 0,
    ageDays: daysSince(task.updatedAt),
    focus: task.focus === true,
    due: due.kind,
    dueDay: due.day,
    dueInDays: due.days,
    progress: task.progress ?? null,
  };
}

// Which map context owns a material (Thought/Note).
//
// Materials exist once in `state.knowledge` and belong to a Project, to a Domain,
// or to nothing at all. A Project is the more specific context and wins when both
// are set; a material with a Domain and no Project belongs to that Domain. The
// previous check required `!item.projectId && item.domainId === id` for a Domain
// but was asked with a Project id as well, so a Domain's own materials were
// counted by nothing: they were visible in the library and absent from the map.
// Materials without any context have no place on the map on purpose — they are
// reachable through «Мысли и заметки».
function knowledgeOwner(item) {
  if (item?.projectId) return { type: 'project', id: item.projectId };
  if (item?.domainId) return { type: 'domain', id: item.domainId };
  return null;
}

export function knowledgeCountFor(nodesList, knowledge) {
  const counts = new Map();
  for (const item of knowledge || []) {
    const owner = knowledgeOwner(item);
    if (!owner) continue;
    const key = `${owner.type}:${owner.id}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const result = {};
  for (const node of nodesList || []) {
    if (node._type !== 'domain' && node._type !== 'project') continue;
    result[`${node._type}:${node.id}`] = counts.get(`${node._type}:${node.id}`) || 0;
  }
  return result;
}
// Which tasks are worth showing when a packed group cannot show everything:
// a missed deadline or today's Focus matters more than an old backlog item.
// Deterministic, so the same state always draws the same picture.
function taskDisplayOrder(a, b) {
  const score = (task) => {
    const due = dueState(task);
    if (due.kind === 'overdue') return 0;
    if (task.focus === true) return 1;
    if (due.kind === 'today') return 2;
    if (due.kind === 'soon') return 3;
    if (task.status === 'doing') return 4;
    if (task.status === 'today') return 5;
    if (due.kind === 'later') return 6;
    return 7;
  };
  return score(a) - score(b)
    || (Number(a.priority) || 2) - (Number(b.priority) || 2)
    || String(a.id).localeCompare(String(b.id));
}

// How many orbs may be drawn inside one packed group before density costs more
// than it explains. The rest are reported as a count, honestly.
const GROUP_ORB_LIMIT = 12;

// Group packing with a minimum gap, so orbs of different sizes stop overlapping
// and their labels have room. Deterministic: same input, same picture.
export function separateGroup(nodeList, groupId, cx, cy, drawRadius, { maxRadius = drawRadius * 1.6 } = {}) {
  const items = nodeList.filter((n) => n._type === "task" && n.groupId === groupId);
  if (items.length < 2) return drawRadius;
  const GAP = 5 * DPR;
  let limit = drawRadius;
  for (let pass = 0; pass < 30; pass++) {
    let moved = 0;
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distance = Math.hypot(dx, dy);
        const min = a.r + b.r + GAP;
        if (distance >= min) continue;
        if (distance < 0.001) {
          // Coincident centres: break the tie deterministically by index.
          dx = Math.cos(i * 2.4) * 0.6;
          dy = Math.sin(i * 2.4) * 0.6;
          distance = 0.6;
        }
        const push = (min - distance) / 2;
        const ux = dx / distance;
        const uy = dy / distance;
        a.x -= ux * push;
        a.y -= uy * push;
        b.x += ux * push;
        b.y += uy * push;
        moved++;
      }
    }
    // Keep the whole group inside its drawn territory.
    for (const item of items) {
      const dx = item.x - cx;
      const dy = item.y - cy;
      const distance = Math.hypot(dx, dy);
      const max = Math.max(0, limit - item.r - 3 * DPR);
      if (distance > max && distance > 0.001) {
        item.x = cx + (dx / distance) * max;
        item.y = cy + (dy / distance) * max;
      }
    }
    if (!moved) break;
    // The group could not be separated inside its territory: give it more room
    // instead of drawing a smear of overlapping dots.
    if (pass % 6 === 5 && limit < maxRadius) limit = Math.min(maxRadius, limit + 6 * DPR);
  }
  return limit;
}

let canvas,
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
  cameraAnimation++;
  // handle pinch/scroll zoom centered on cursor
  try {
    e.preventDefault();
  } catch (_) {}
  const d = e.deltaY || e.wheelDelta || 0;
  const zoomFactor = d > 0 ? 0.9 : 1.1;
  const old = viewState.scale;
  const next = clamp(old * zoomFactor, 0.025, 2.2);
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

// Hit areas and keyboard focus.
// An orb is drawn as small as 12 CSS px at 100% zoom, which is unclickable in
// practice, so the pointer target has a floor in CSS pixels and grows with the
// orb as the user zooms in. Keyboard focus is a separate index into the visible
// tasks, because a canvas cannot expose its nodes through the DOM.
const MIN_HIT_CSS = 26;
let kbdIndex = -1;
let kbdNodeId = null;
let liveRegionEl = null;

function hitSlop(node) {
  const minWorld = (MIN_HIT_CSS * DPR) / Math.max(0.2, viewState.scale);
  return node._type === "task" ? Math.max(minWorld, node.r * 0.6) : 0;
}

// The pointer target radius of a node, in world units. A task gets a floor in
// CSS pixels (see MIN_HIT_CSS) so a tiny orb stays clickable; every canvas-click
// decision goes through this one function, so the target cannot drift between
// hover, click and drag.
function hitRadius(node) {
  if (node._type === "task") return node.r + hitSlop(node);
  if (node._type === "project") return projectRadius(node, DPR);
  return node.r;
}

// Which object a click at this world point belongs to.
//
// The map is a hierarchy of nested territories: a task lives inside a Project,
// a Project inside a Domain, and a task without a Project lives inside the
// "Без проекта" group. Choosing by array position (the previous `hit`) meant the
// answer depended on the order nodes happened to be built in, not on what the
// user sees. Two rules make the target match the picture instead:
//   * the smallest territory wins — the more specific object is what was clicked;
//   * when two candidates are equally specific, the one drawn on top wins.
// A task therefore always beats the Project and the Domain it sits in, and an
// empty patch of a Project still belongs to that Project.
function hitRank(node) {
  if (node._type === "task") return 0;
  if (node._type === "project") return 1;
  if (node._type === "unassigned") return 2;
  return 3;
}

function bestHit(x, y, ignoreId = null) {
  // The visible diamond is a project handle; invisible task slop must not steal it.
  const actualTask=nodes.some(n=>n._type==='task' && n.id!==ignoreId && Math.hypot(x-n.x,y-n.y)<=n.r);
  if(!actualTask){
    const handle=nodes.find(n=>n._type==='project' && n.id!==ignoreId && Math.hypot(x-n.x,y-n.y)<=8*DPR/Math.max(.1,viewState.scale));
    if(handle)return handle;
  }
  let best = null;
  let bestRadius = 0;
  let bestRank = 0;
  for (const node of nodes) {
    if (ignoreId !== null && node.id === ignoreId) continue;
    const dx = x - node.x;
    const dy = y - node.y;
    const radius = hitRadius(node);
    if (node._type === 'project' || node._type === 'domain') {
      if (!containsTerritory(node, x, y, DPR)) continue;
    } else if (dx * dx + dy * dy > radius * radius) continue;
    const rank = hitRank(node);
    if (best && (radius > bestRadius || (radius === bestRadius && rank >= bestRank))) continue;
    best = node;
    bestRadius = radius;
    bestRank = rank;
  }
  return best;
}

function announce(message) {
  if (!liveRegionEl || !message) return;
  liveRegionEl.textContent = message;
}

// Visible-world bounds, shared by the renderer and by keyboard navigation
// (which must never walk into off-screen tasks).
function viewportRect() {
  const inv = 1 / Math.max(0.0001, viewState.scale);
  const pad = 120 * inv;
  return {
    x0: -viewState.tx * inv - pad,
    y0: -viewState.ty * inv - pad,
    x1: (W - viewState.tx) * inv + pad,
    y1: (H - viewState.ty) * inv + pad,
  };
}

function nodeInView(x, y, r = 0) {
  const view = viewportRect();
  return x + r > view.x0 && x - r < view.x1 && y + r > view.y0 && y - r < view.y1;
}

// Order used by Tab / arrow navigation: the same order the eye reads the map
// in, so keyboard movement stays predictable.
function keyboardTasks() {
  return nodes
    .filter((n) => n._type === "task" && nodeInView(n.x, n.y, n.r + 24 * DPR))
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

function focusTaskNode(node, { reveal = true } = {}) {
  if (!node) return;
  let list = keyboardTasks();
  if (!list.length) return;
  kbdNodeId = node.id;
  kbdIndex = Math.max(0, list.findIndex((n) => n.id === node.id));
  const task = state.tasks.find((t) => t.id === node.id);
  if (task) {
    try { openInspectorFor({ ...task, _type: "task" }); } catch (_) {}
    const deadline = dueLabel(task);
    announce(
      `${task.title}. ${statusLabel(task.status)}${deadline ? `. ${deadline}` : ""}. ` +
      `Задача ${kbdIndex + 1} из ${list.length}.`
    );
  }
  if (reveal) {
    const x = node.x * viewState.scale + viewState.tx;
    const y = node.y * viewState.scale + viewState.ty;
    const margin = 70 * DPR;
    if (x < margin || y < margin || x > W - margin || y > H - margin) {
      try { fitTask(node.id); } catch (_) {}
    }
  }
  requestDraw();
}

function moveKeyboardFocus(step) {
  const list = keyboardTasks();
  if (!list.length) {
    announce("На карте нет задач");
    return;
  }
  if (kbdNodeId) {
    const current = list.findIndex((n) => n.id === kbdNodeId);
    if (current >= 0) kbdIndex = current;
  }
  const next = (kbdIndex + step + list.length * 2) % list.length;
  focusTaskNode(list[next], { reveal: false });
  const node = list[next];
  const x = node.x * viewState.scale + viewState.tx;
  const y = node.y * viewState.scale + viewState.ty;
  const margin = 70 * DPR;
  if (x < margin || y < margin || x > W - margin || y > H - margin) {
    try { fitTask(node.id); } catch (_) {}
  }
}

function onKeyDown(e) {
  const list = keyboardTasks();
  if (!list.length) return;
  switch (e.key) {
    case "Tab": {
      // Tab enters the map on the first task and leaves from the last one; the
      // map never traps focus.
      if (e.shiftKey) {
        if (kbdNodeId && kbdIndex <= 0) {
          kbdNodeId = null;
          kbdIndex = -1;
          requestDraw();
          return; // let the browser move focus back out
        }
        e.preventDefault();
        if (!kbdNodeId) { kbdIndex = list.length; }
        moveKeyboardFocus(-1);
      } else {
        if (kbdNodeId && kbdIndex >= list.length - 1) {
          kbdNodeId = null;
          kbdIndex = -1;
          requestDraw();
          return;
        }
        e.preventDefault();
        if (!kbdNodeId) { kbdIndex = -1; }
        moveKeyboardFocus(1);
      }
      return;
    }
    case "ArrowDown":
    case "ArrowRight":
      e.preventDefault();
      moveKeyboardFocus(1);
      return;
    case "ArrowUp":
    case "ArrowLeft":
      e.preventDefault();
      moveKeyboardFocus(-1);
      return;
    case "Home":
      e.preventDefault();
      kbdIndex = -1;
      moveKeyboardFocus(1);
      return;
    case "End":
      e.preventDefault();
      kbdIndex = list.length - 2;
      moveKeyboardFocus(1);
      return;
    case "Enter":
    case " ": {
      const node = list.find((n) => n.id === kbdNodeId) || list[0];
      if (!node) return;
      e.preventDefault();
      focusTaskNode(node);
      return;
    }
    case "Escape":
      kbdNodeId = null;
      kbdIndex = -1;
      announce("");
      requestDraw();
      return;
    default:
      return;
  }
}

export function initMap(canvasEl) {
  canvas = canvasEl;
  emptyStateEl = document.getElementById("mapEmpty");
  // Keyboard and screen-reader access: the canvas itself cannot be read, so it
  // is focusable, labelled, and announces the focused task through a live
  // region while the Inspector shows the same object.
  canvas.setAttribute("tabindex", "0");
  canvas.setAttribute("role", "application");
  canvas.setAttribute("aria-label", "Карта жизни: домены, проекты и задачи. Стрелки — перемещение по задачам, Enter — открыть в инспекторе.");
  liveRegionEl = document.getElementById("mapLiveRegion");
  canvas.addEventListener("keydown", onKeyDown);
  canvas.addEventListener("blur", () => {
    kbdNodeId = null;
    kbdIndex = -1;
    requestDraw();
  });
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

let cameraAnimation = 0;
function animateTo(target, ms = 230) {
  const animation = ++cameraAnimation;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) ms = 0;
  const start = { sx: viewState.scale, tx: viewState.tx, ty: viewState.ty };
  const t0 = performance.now();
  function step() {
    if (animation !== cameraAnimation) return;
    const t = ms ? Math.min(1, (performance.now() - t0) / ms) : 1;
    const e = 1 - Math.pow(1 - t, 3);
    viewState.scale = start.sx + (target.sx - start.sx) * e;
    viewState.tx = start.tx + (target.tx - start.tx) * e;
    viewState.ty = start.ty + (target.ty - start.ty) * e;
    drawMap();
    syncZoomSlider();
    if (t < 1) requestAnimationFrame(step);
  }
  if (ms === 0) step(); else requestAnimationFrame(step);
}

function fitToBBox(bx, { maxScale = 2.2, padK = 0.2 } = {}) {
  if (!bx) {
    drawMap();
    return;
  }
  // Padding is generous on purpose: zooming onto a single task is only useful if
  // the Project and Domain around it stay on screen. Framing the bare object
  // fills the canvas with one dot and hides the very context the map exists to
  // show, so callers that aim at one small thing ask for a looser frame instead.
  const w = Math.max(1, bx.maxX - bx.minX);
  const h = Math.max(1, bx.maxY - bx.minY);
  const cx = (bx.minX + bx.maxX) / 2;
  const cy = (bx.minY + bx.maxY) / 2;
  const wPad = w * (1 + padK);
  const hPad = h * (1 + padK);
  const sx = Math.min(W / Math.max(1, wPad), Math.max(100 * DPR, H - 116 * DPR) / Math.max(1, hPad));
  const scale = clamp(sx, 0.025, maxScale);
  const target = {
    sx: scale,
    tx: W * 0.5 - cx * scale,
    ty: (H + 60 * DPR) * 0.5 - cy * scale,
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
  const labelMargin = 42 * DPR;
  fitToBBox({ minX, minY: minY - labelMargin, maxX, maxY: maxY + labelMargin }, { maxScale: 1.1 });
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
  revealTask(taskId);
  const owner=state.projects.find(p=>state.tasks.some(t=>t.id===taskId && t.projectId===p.id));
  if(owner){revealProjectPage(owner);expandedCompletedProjects.add(owner.id);}
  layoutMap();
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
  // A task inside a Project is framed together with its Domain, not with the
  // Project alone: "here is your task" only reads as an answer when the place it
  // lives in is visible too.
  if (task && task.projectId) {
    const pNode = nodes.find(
      (n) => n._type === "project" && n.id === task.projectId
    );
    if (pNode) {
      minX = Math.min(minX, pNode.x - pNode.r);
      minY = Math.min(minY, pNode.y - pNode.r);
      maxX = Math.max(maxX, pNode.x + pNode.r);
      maxY = Math.max(maxY, pNode.y + pNode.r);
      const dNode = nodes.find((n) => n._type === "domain" && n.id === pNode.parent);
      if (dNode) {
        minX = Math.min(minX, dNode.x - dNode.r);
        minY = Math.min(minY, dNode.y - dNode.r);
        maxX = Math.max(maxX, dNode.x + dNode.r);
        maxY = Math.max(maxY, dNode.y + dNode.r);
      }
    }
  } else {
    // independent task: keep a comfortable margin around the dot
    const pad = 40 * DPR;
    minX = node.x - r - pad;
    minY = node.y - r - pad;
    maxX = node.x + r + pad;
    maxY = node.y + r + pad;
  }
  fitToBBox({ minX, minY, maxX, maxY }, { padK: 0.06 });
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

// The radius used to draw a child. Projects carry a halo (see the project
// renderer), so they take a little more room than the group.
function childDrawRadius(child) {
  return child.type === "project" ? projectRadius(child, DPR) : child.r;
}

export function layoutMap() {
  const wasEmpty = nodes.length === 0;
  const spatial = withSpatialAddresses(state);
  attentionSnapshot = buildAttention(state);
  attentionDay = localDay();
  renderAttention(document.getElementById('mapAttention'), attentionSnapshot, {
    openArea: openAttentionArea, openTask: openAttentionTask,
  });
  nodes = [];
  edges = [];
  const visibleDomainIds = getVisibleDomainIds(state.domains);
  const domains = spatial.domains.filter((domain) => visibleDomainIds.has(domain.id));
  const domainIds = new Set(domains.map((domain) => domain.id));
  const matchesFilter = (task) =>
    !state.filterTag || (task.tags || []).includes(state.filterTag);

  const query=getMapQuery().toLocaleLowerCase('ru-RU');
  if(query){
    const found=state.projects.find(p=>`${p.title}`.toLocaleLowerCase('ru-RU').includes(query)) ||
      state.projects.find(p=>state.tasks.some(t=>t.projectId===p.id && matchesMapView(t,{projectTitle:p.title,today:localDay()})));
    if(found)revealProjectPage(found);
  }
  for(const domain of domains){
    const pages=[...new Set(state.projects.filter(p=>p.domainId===domain.id).map(projectPage))].sort((a,b)=>a-b);
    if(pages.length && !pages.includes(domainPages.get(domain.id)||0))domainPages.set(domain.id,pages[0]);
  }
  const visibleProjects = spatial.projects.filter(p=>domainIds.has(p.domainId))
    .filter(p=>projectPage(p)===(domainPages.get(p.domainId)||0))
    .filter(p=>!state.filterTag || state.tasks.some(t=>t.projectId===p.id && matchesFilter(t)));
  const visibleProjectIds = new Set(visibleProjects.map((project) => project.id));
  const taskList = state.tasks.filter(
    (task) => visibleProjectIds.has(task.projectId) && matchesFilter(task) &&
      (project(task.projectId)?.lifecycle !== 'completed' || expandedCompletedProjects.has(task.projectId) || getMapQuery() || getMapLens() !== 'all')
  );

  // Lenses and search do not remove anything from the map: they decide what is
  // emphasised, named and counted. The map keeps its shape while the answer to
  // "what is due / focus / stale / this word" comes forward. The lens must judge
  // every task the layout draws — inside a visible Project, in a Domain's
  // "Без проекта" group, or fully independent beside the Domains — and nothing
  // else, or the counter would report tasks that are not on screen at all.
  const drawnTaskList = state.tasks.filter(task => matchesFilter(task)
    && (visibleProjectIds.has(task.projectId) || (!task.projectId && domainIds.has(task.domainId))));
  const today = localDay();
  const view = buildTaskMatches(drawnTaskList, today);
  taskMatches = view.matches;
  taskTotals = { tasks: taskMatches.size, matching: view.matching };

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
      r: PROJECT_RADIUS * DPR,
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
    const meta = {
      domain,
      projects,
      independentTasks,
      children,
      groupRadius,
    };
    domainMeta.set(domain.id, meta);
    return meta;
  });

  // Viewport independent addresses. Hidden spheres keep their reserved place.
  const domainPositions = new Map(domains.map(d=>{
    const slot=Number.isInteger(d.mapSlot)?d.mapSlot:state.domains.indexOf(d);
    const point=gridAddress(slot);
    return [d.id,{x:point.x*DPR,y:point.y*DPR,r:Math.min(DOMAIN_RADIUS, Math.max(235,...state.projects.filter(p=>p.domainId===d.id).map(p=>{const c=childAddress((p.mapSlot||0)%18+1);return Math.hypot(c.x,c.y)+210;})))*DPR}];
  }));
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

  // Place each Domain's children on the ring that fitDomainChildren decided.
  // Positioning and sizing are one decision, so a child territory can no longer
  // end up outside the Domain it belongs to. An only child sits off centre
  // instead of exactly on it: its territory used to cover the whole Domain.
  const childRadii = new Map();
  const childSlots = new Map();
  domainLayout.forEach((meta) => {
    const dNode = nodes.find(node => node._type === "domain" && node.id === meta.domain.id);
    if (!dNode || !meta.children.length) return;
    meta.children.forEach(child=>{
      const p=spatial.projects.find(p=>p.id===child.id);
      const slot=child.type==='project' ? (p?.mapSlot||0)%18+1 : 0;
      const point=childAddress(slot);
      childRadii.set(child.key,childDrawRadius(child));
      childSlots.set(child.key,{x:dNode.x+point.x*DPR,y:dNode.y+point.y*DPR,r:child.r});
    });
  });
  visibleProjects.forEach(p=>{
    const slot=childSlots.get(`project:${p.id}`);
    nodes.push({_type:'project',id:p.id,title:p.title,x:slot.x,y:slot.y,r:slot.r,parent:p.domainId});
  });

  const golden = Math.PI * (3 - Math.sqrt(5));
  for(const p of visibleProjects){
    const parent=nodes.find(n=>n.id===p.id);
    const all=taskList.filter(t=>t.projectId===p.id).sort(taskDisplayOrder);
    const preferred=all.filter(t=>t.id===revealedTaskId || currentTaskVisibility(t)).sort((a,b)=>(a.id===revealedTaskId?-1:0)-(b.id===revealedTaskId?-1:0));
    const shown=[...preferred,...all.filter(t=>!preferred.includes(t))].slice(0,GROUP_ORB_LIMIT);
    parent.hidden=all.length-shown.length;
    shown.forEach((t,i)=>{
      const angle=i*golden;
      const orbit=shown.length===1 ? 55*DPR : Math.sqrt((i+.5)/shown.length)*80*DPR;
      nodes.push(taskNode(t,parent.x+Math.cos(angle)*orbit,parent.y+Math.sin(angle)*orbit,p.id));
    });
    separateGroup(nodes,p.id,parent.x,parent.y,parent.r,{maxRadius:parent.r});
  }

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
      // Reserve a little extra room for the «+N» counter drawn at the bottom of
      // the group, so the chip never lands on top of an orb. The base radius is
      // the one the Domain was sized around; only the counter allowance is added
      // here, so the group cannot grow past the territory it was given.
      const groupRadius = (slot?.r || clamp(42 + Math.sqrt(total) * 10, 48, 82) * DPR) + 14 * DPR;
      const groupX = slot?.x ?? dNode.x;
      const groupY = slot?.y ?? dNode.y;
      // The radius used to size the Domain (without the counter allowance).
      const fittedRadius = childRadii.get(`unassigned:${d.id}`) ?? slot?.r ?? 0;
      // A packed group of twenty dots explains nothing: draw the most
      // decision-relevant ones and report the rest as a count.
      const sorted = [...list].sort((a,b)=>(a.id===revealedTaskId?-2:currentTaskVisibility(a)?-1:0)-(b.id===revealedTaskId?-2:currentTaskVisibility(b)?-1:0) || taskDisplayOrder(a,b));
      const shown = sorted.slice(0, GROUP_ORB_LIMIT);
      const hiddenCount = total - shown.length;
      nodes.push({
        _type: "unassigned",
        id: `unassigned:${d.id}`,
        domainId: d.id,
        title: "Без проекта",
        count: total,
        hidden: hiddenCount,
        x: groupX,
        y: groupY,
        r: groupRadius,
      });
      shown.forEach((t, idx) => {
          const taskRadius = sizeByImportance(t) * DPR;
          // Orbs are packed inside the radius the group was fitted with, not the
          // one enlarged for the «+N» chip: that allowance is not orb space.
          const packedRadius = Math.max(0, fittedRadius || groupRadius);
          const orbit = shown.length === 1 ? 0 : Math.sqrt((idx + 0.55) / shown.length) * Math.max(0, packedRadius - taskRadius - 12 * DPR);
          const angle = idx * golden - Math.PI / 2;
          const x = groupX + Math.cos(angle) * orbit;
          const y = groupY + Math.sin(angle) * orbit;
          nodes.push(taskNode(t, x, y, `unassigned:${d.id}`));
      });
      // The golden-angle spiral packs tasks by angle only, so orbs of different
      // radii end up overlapping and their labels collide. Separate them after
      // placement, keeping every orb inside the group it belongs to.
      separateGroup(nodes, `unassigned:${d.id}`, groupX, groupY, Math.max(0, fittedRadius || groupRadius));
    });
    
    // Полностью независимые задачи размещаем там, куда их перетащили
    fullyIndependent.forEach((t, idx) => {
        const maxDomainX = domains.length
          ? Math.max(...domains.map(d => {
              const dNode = nodes.find(n => n._type === 'domain' && n.id === d.id);
              return dNode ? dNode.x + dNode.r : 0;
            }))
          : W * 0.5;
        const startX = maxDomainX + 100 * DPR;
        const spacing = 80 * DPR;
        const x = startX + (idx % 3) * spacing;
        const y = Math.floor(idx / 3) * spacing;
        nodes.push(taskNode(t, x, y));
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
          edges.push({ a, b, tag, color: mapThemeIsLight() ? "#b9cbe0" : "#1e2f53", w: 0.7 * DPR });
        }
      }
    });
    const cap = Math.min(state.maxEdges || 300, dynamicEdgeCap || 300);
    edges = edges.slice(0, cap);
  }
  if(wasEmpty && nodes.length && W>0 && H>0)fitAll();
}

export function drawMap() {
  if (!ctx) return;
  if (attentionDay !== localDay()) layoutMap();
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

  // empty-state overlay: nothing to show on the map yet
  if (emptyStateEl) emptyStateEl.hidden = nodes.length > 0;

  drawAtlasScene(ctx, {
    nodes, facts: attentionSnapshot, camera: viewState, dpr: DPR,
    light: mapThemeIsLight(), selected: selectedNodeId, hovered: hoverNodeId,
    keyboard: kbdNodeId, emphasis: taskEmphasis, knowledgeCounts: knowledgeCountFor(nodes, state.knowledge),
    edges, showLinks: state.showLinks, showAging: state.showAging, showGlow: state.showGlow && allowGlow,
    targetDomain: dropTargetDomainId, targetProject: dropTargetProjectId, pendingAttach, dragged: draggedNode,
  });
  renderMapNavigator({
    state, selected: selectedNodeId, type: nodes.find(n => n.id === selectedNodeId)?._type,
    nodes, camera: viewState, width: W, height: H, dpr: DPR,
    open: (entity, type) => openInspectorFor({ ...entity, _type: type }),
    fit: (id, type) => {
      if(type === 'domain') fitDomain(id);
      else if(type === 'project') fitProject(id);
      else if(type === 'task') fitMembers(nodes.filter(n => n.id === id));
    },
    overview: () => { openInspectorFor(null); fitAll(); },
    pan: (x, y) => animateTo({ sx: viewState.scale, tx: W / 2 - x * viewState.scale, ty: H / 2 - y * viewState.scale }),
  });

  // active object ring + navigation ping (drawn on top of everything)
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

// Read-only view of the last layout: used by tests and diagnostics to check
// that packed groups are actually separated and that each orb carries the
// semantic channels the renderer draws.
export function getLayoutSnapshot() {
  return {
    nodes: nodes.map((n) => ({ ...n })),
    scale: viewState.scale,
    tx: viewState.tx,
    ty: viewState.ty,
    keyboardFocusId: kbdNodeId,
    size: { width: W || 0, height: H || 0, dpr: DPR || 1 },
  };
}

// Which object owns a point in world coordinates. Exposed so a regression can
// check the hierarchy (task before its Project before its Domain) without
// synthesising mouse events, and so diagnostics can ask the map the same
// question the user's click will ask.
export function resolveHit(x, y) {
  const node = bestHit(x, y);
  return node ? { id: node.id, type: node._type, title: node.title || null, groupId: node.groupId || null } : null;
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
// Hover, click and drag all resolve the pointer target the same way (bestHit),
// so what the tooltip describes is always what a click would open.
function hit(x, y) {
  return bestHit(x, y);
}

// hit test that ignores a specific node id (useful while dragging)
function hitExcluding(x, y, ignoreId) {
  return bestHit(x, y, ignoreId);
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
    cameraAnimation++;
    viewState.tx += dx * dpr;
    viewState.ty += dy * dpr;
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
    const dx = pt.x - dragOffset.x - draggedNode.x;
    const dy = pt.y - dragOffset.y - draggedNode.y;
    if (draggedNode._type === 'project') {
      const ids = new Set(state.tasks.filter(t => t.projectId === draggedNode.id).map(t => t.id));
      nodes.filter(n => n._type === 'task' && ids.has(n.id)).forEach(n => { n.x += dx; n.y += dy; });
    }
    draggedNode.x = pt.x - dragOffset.x;
    draggedNode.y = pt.y - dragOffset.y;
    // detect potential drop targets while dragging
    dropTargetProjectId = null;
    dropTargetDomainId = null;
    const hitNode = hitExcluding(pt.x, pt.y, draggedNode.id);
    if (draggedNode._type === 'project') {
      dropTargetDomainId = nodes.filter(n => n._type === 'domain' && containsTerritory(n, pt.x, pt.y, DPR))
        .sort((a, b) => a.r - b.r)[0]?.id || null;
    }
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
    hideMapHoverCard();
    // clear drop targets when not dragging
    dropTargetProjectId = null;
    dropTargetDomainId = null;
    requestDraw();
    return;
  }
  hoverNodeId = n.id;
  canvas.style.cursor = "pointer";
  // The card answers "how is this going"; the one-line tooltip answered "what is
  // this". Details belong to the Inspector, so the card carries counts and the
  // source text is not repeated on the canvas.
  showMapHoverCard(n);
  requestDraw();
}

// The card is built by app.js (which owns the page chrome) and reached through a
// window hook, because view_map.js cannot import app.js without a cycle. Keeping
// one fallback path here means a missing card never breaks hovering.
function showMapHoverCard(node) {
  try {
    if (typeof window.renderMapHoverCard === "function") {
      window.renderMapHoverCard({
        _type: node._type,
        id: node.id,
        title: node.title,
        color: node.color || null,
        domainId: node.domainId || null,
        parent: node.parent || null,
        groupId: node.groupId || null,
      });
    }
  } catch (error) {
    console.error("map card failed", error);
  }
}

function hideMapHoverCard() {
  try {
    if (typeof window.renderMapHoverCard === "function") window.renderMapHoverCard(null);
  } catch (_) {}
}

function onMouseLeave() {
  pendingDragNode = null;
  if (draggedNode) {
    draggedNode = null;
    canvas.style.cursor = "";
  }
  hoverNodeId = null;
  canvas.style.cursor = "";
  hideMapHoverCard();
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
    if (n && (n._type === "task" || n._type === "project")) {
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
  if (draggedNode._type === 'project') {
    skipClickUntil = performance.now() + 250;
    const id = draggedNode.id;
    const destination = dropTargetDomainId;
    // Clear the preview before Core refreshes the map; a failed save restores it.
    draggedNode = null;
    dropTargetDomainId = null;
    dropTargetProjectId = null;
    canvas.style.cursor = '';
    try {
      if (destination) {
        const result = moveProject(id, destination);
        if (result.operation) {
          undoStack.push({ type: 'project.move', moveResult: result });
          if (undoStack.length > 50) undoStack.shift();
          revealProject(result.project);
          openInspectorFor({ ...result.project, _type: 'project' });
          showProjectMoveNotice('Проект перенесён вместе с задачами и материалами.', true);
        } else showProjectMoveNotice('Проект уже в этой сфере. Положение задаёт автоматическая раскладка.');
      } else showProjectMoveNotice('Перенос отменён. Отпустите проект внутри нужной сферы.');
    } catch (error) { showProjectMoveNotice(`Не удалось перенести: ${error.message}`); }
    layoutMap(); drawMap();
    return;
  }
  let moved = false;
  let taskMoveDeferred = false;
  let taskMoveCommitted = false;
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
      showProjectMoveNotice('Место задачи определяется сферой. Для переноса отпустите её в другом проекте или сфере.');
    }
    if (t?.projectId && !taskMoveDeferred && !taskMoveCommitted) {
      showProjectMoveNotice('Внутри проекта задачи раскладываются автоматически. Для переноса отпустите задачу в другом проекте или сфере.');
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

});

// expose undo function
function showProjectMoveNotice(message, allowUndo = false) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.replaceChildren(document.createTextNode(message + ' '));
  toast.className = 'toast';
  toast.style.display = 'block'; toast.style.opacity = '1';
  if (allowUndo) {
    const undo = document.createElement('button');
    undo.textContent = 'Отменить перенос'; undo.type = 'button';
    undo.onclick = () => {
      try { if (undoLastMove()) toast.style.display = 'none'; }
      catch (error) { showProjectMoveNotice(error.message); }
    };
    toast.append(undo);
  }
  const close = document.createElement('button');
  close.type = 'button'; close.textContent = 'Закрыть';
  close.onclick = () => { toast.style.display = 'none'; };
  toast.append(close);
}

export function undoLastMove() {
  const latest = undoStack.at(-1);
  if (latest?.type === 'project.move') {
    const result = undoProjectMove(latest.moveResult);
    undoStack.pop();
    revealProject(result.project);
    openInspectorFor({ ...result.project, _type: 'project' });
    return true;
  }
  const item = undoStack.pop();
  if (!item) return false;
  if (item.type === "task.move") {
    const result = undoTaskMove(item.moveResult, { reason: "map.undo" });
    if (!result) return false;
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
      pos: null,
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
  const p = clamp(percent / 100, 0.025, 2.2);
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
          pos: null,
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

// Fit the camera around one packed group and its tasks. Shared by the group
// click and the project double-click.
function fitMembers(members) {
  if (!members.length) return false;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  members.forEach((m) => {
    const radius=m._type==='project' ? projectRadius(m,DPR)+24*DPR : m.r;
    minX = Math.min(minX, m.x - radius);
    minY = Math.min(minY, m.y - radius);
    maxX = Math.max(maxX, m.x + radius);
    maxY = Math.max(maxY, m.y + radius);
  });
  fitToBBox({ minX, minY, maxX, maxY });
  return true;
}

export function fitGroup(groupId) {
  const group = nodes.find((n) => n._type === "unassigned" && n.id === groupId);
  if (!group) return;
  const members = [group, ...nodes.filter((n) => n._type === "task" && n.groupId === groupId)];
  fitMembers(members);
}

export function fitProject(projectId) {
  const owner=state.projects.find(p=>p.id===projectId);
  if(owner){revealProjectPage(owner);setDomainVisible(owner.domainId,true,state.domains);layoutMap();}
  const ids = new Set(state.tasks.filter(t => t.projectId === projectId).map(t => t.id));
  fitMembers(nodes.filter(n => (n._type === 'project' && n.id === projectId) || (n._type === 'task' && ids.has(n.id))));
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
    if (fitMembers(members)) return;
  }
  if (n._type === "unassigned") {
    fitGroup(n.id);
    return;
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
  if (performance.now() < skipClickUntil) return;
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
    // A packed group is a doorway, not a dead end: one click zooms into its
    // members, which is the only way to reach a task hidden behind the counter.
    openInspectorFor({ ...n, _type: "unassigned" });
    fitGroup(n.id);
  } else {
    const obj = state.domains.find((d) => d.id === n.id);
    state.activeDomain = n.id;
    try { window.refreshQuickDock?.(); } catch (_) {}
    try { window.renderSidebar?.(); } catch (_) {}
    openInspectorFor({ ...obj, _type: "domain" });
  }
}
