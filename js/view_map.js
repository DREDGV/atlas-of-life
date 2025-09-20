// js/view_map.js

// Helper function for rounded rectangles (compatibility)
function drawRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

import {
  state,
  byId,
  project,
  tasksOfProject,
  clamp,
  colorByAging,
  sizeByImportance,
  daysSince,
  getProjectColor,
  getRandomProjectColor,
  getRandomIdeaColor,
  getRandomNoteColor,
  getContrastColor,
  getDomainMood,
  getMoodColor,
  getMoodDescription,
  generateId,
  isObjectLocked,
  canMoveObject,
  getChecklistProgress,
  canChangeHierarchy
} from "./state.js";

// Mood functions imported
import { openInspectorFor } from "./inspector.js";
import { saveState } from "./storage.js";
import { logEvent } from "./utils/analytics.js";
import { openChecklistWindow, closeChecklistWindow } from "./ui/checklist-window.js";

// showToast is defined globally in app.js

let canvas,
  tooltip,
  ctx,
  W = 0,
  H = 0,
  DPR = 1;

let contextMenuState = {
  isVisible: false,
  x: 0,
  y: 0
};
let nodes = [],
  edges = [];
let hoverNodeId = null;
let clickedNodeId = null;
let clickEffectTime = 0;
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

// Focus mode "Black Hole" - hide all except selected domain
let focusMode = {
  active: false,
  domainId: null,
  originalOpacity: {}
};

// wheel/zoom handler
let pendingFrame = false;
let lastDrawTime = 0;
const MIN_DRAW_INTERVAL = 16; // 60 FPS

function requestDraw() {
  if (pendingFrame || isDrawing) return;
  pendingFrame = true;
  requestAnimationFrame(() => {
    pendingFrame = false;
    if (!isDrawing) {
      drawMap();
    }
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
  requestDraw();
}
// DnD state
let draggedNode = null;
let dragOffset = { x: 0, y: 0 };
let dropTargetProjectId = null;
let dropTargetDomainId = null;
// drag threshold (px, screen space before scale/DPR)
let pendingDragNode = null;

// GPT-5 mouse system
const mouse = {
  phase: 'idle',            // 'idle' | 'press' | 'drag-object' | 'pan'
  startX: 0, startY: 0,     // экранные координаты старта
  lastX: 0, lastY: 0,       // экранные координаты предыдущего move
  threshold: 10,
  target: null,             // объект под курсором в момент mousedown
  dragOffsetX: 0,           // смещение хвата внутри объекта (в мировых координатах)
  dragOffsetY: 0
};

// GPT-5 utilities
function distance2(x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  return dx*dx + dy*dy;
}

function setCursor(type) {
  canvas.style.cursor = type;
}

function selectObject(obj) {
  if (obj) {
    clickedNodeId = obj.id;
    console.log('🖱️ Object selected:', obj._type, obj.id);
  } else {
    clickedNodeId = null;
    console.log('🖱️ Selection cleared');
  }
  requestDraw();
}

function commitObjectPosition(obj) {
  if (!obj) return;
  
  console.log('🖱️ Object position committed:', obj._type, obj.id, 'at:', obj.x, obj.y);
  
  // Сохраняем текущий зум перед изменениями
  const currentScale = viewState.scale;
  const currentTx = viewState.tx;
  const currentTy = viewState.ty;
  
  // Временно отключаем mapApi чтобы saveState не вызывал layoutMap
  const tempMapApi = window.mapApi;
  window.mapApi = null;
  
  try {
    // Сохраняем позицию в зависимости от типа объекта
    if (obj._type === "task") {
      const task = state.tasks.find(t => t.id === obj.id);
      if (task) {
        task._pos = { x: obj.x, y: obj.y };
        task.updatedAt = Date.now();
        saveState();
        showToast("Позиция задачи обновлена", "ok");
      }
    } else if (obj._type === "project") {
      const project = state.projects.find(p => p.id === obj.id);
      if (project) {
        project._pos = { x: obj.x, y: obj.y };
        project.updatedAt = Date.now();
        saveState();
        showToast("Позиция проекта обновлена", "ok");
      }
    } else if (obj._type === "idea") {
      const idea = state.ideas.find(i => i.id === obj.id);
      if (idea) {
        idea.x = obj.x;
        idea.y = obj.y;
        idea.updatedAt = Date.now();
        saveState();
        showToast("Позиция идеи обновлена", "ok");
      }
    } else if (obj._type === "note") {
      const note = state.notes.find(n => n.id === obj.id);
      if (note) {
        note.x = obj.x;
        note.y = obj.y;
        note.updatedAt = Date.now();
        saveState();
        showToast("Позиция заметки обновлена", "ok");
      }
    }
  } finally {
    // Восстанавливаем mapApi
    window.mapApi = tempMapApi;
  }
  
  // Восстанавливаем зум после сохранения
  if (viewState.scale !== currentScale || viewState.tx !== currentTx || viewState.ty !== currentTy) {
    console.log('🖱️ Zoom was reset, restoring:', currentScale, currentTx, currentTy);
    viewState.scale = currentScale;
    viewState.tx = currentTx;
    viewState.ty = currentTy;
    requestDraw();
  }
}

// Visualization style settings
let projectVisualStyle = 'original'; // 'galaxy', 'simple', 'planet', 'modern', 'original' - default to original style

// Function to change visualization style
function setProjectVisualStyle(style) {
  if (['galaxy', 'simple', 'planet', 'modern', 'neon', 'tech', 'minimal', 'holographic', 'gradient', 'mixed', 'original'].includes(style)) {
    projectVisualStyle = style;
    drawMap(); // Redraw with new style
    console.log(`Project visualization style changed to: ${style}`);
  } else {
    console.warn('Invalid visualization style. Use: galaxy, simple, planet, modern, neon, tech, minimal, holographic, gradient, mixed, or original');
  }
}

// Export function globally
try { 
  window.setProjectVisualStyle = setProjectVisualStyle;
  // Добавляем удобные функции для тестирования
  window.testProjectColors = () => {
    console.log('🎨 Доступные стили проектов:');
    console.log('- original (по умолчанию) - улучшенный с эффектами');
    console.log('- modern, simple, planet');
    console.log('- neon, tech, minimal, holographic');
    console.log('- gradient, mixed, galaxy');
    console.log('Использование: setProjectVisualStyle("modern")');
    console.log('✨ Все стили теперь имеют улучшенные эффекты клика!');
  };
  
  // Функция для тестирования эффекта клика
  window.testClickEffect = () => {
    if (nodes.length > 0) {
      const project = nodes.find(n => n._type === 'project');
      if (project) {
        clickedNodeId = project.id;
        clickEffectTime = 1.0;
        console.log('🎯 Тестируем эффект клика на проекте:', project.id);
      } else {
        console.log('❌ Проекты не найдены');
      }
    } else {
      console.log('❌ Узлы не загружены');
    }
  };
  
  // Функция для тестирования мыши
  window.testMouse = () => {
    console.log('🖱️ Тестирование мыши:');
    console.log('- Средняя кнопка мыши: панорамирование (только на пустом месте)');
    console.log('- Alt + левая кнопка: панорамирование (только на пустом месте)');
    console.log('- Левая кнопка: перетаскивание объектов');
    console.log('- Для отладки: window.DEBUG_MOUSE = true');
  };
  
  // Функция для тестирования задач
  window.testTasks = () => {
    console.log('📋 Тестирование задач:');
    console.log('State tasks:', state.tasks);
    console.log('Nodes:', nodes);
    console.log('Task nodes:', nodes.filter(n => n._type === 'task'));
    console.log('Для отладки: window.DEBUG_EDGE_TASKS = true');
    console.log('Принудительно перерисовать: layoutMap(); drawMap();');
  };
} catch (_) {}

// Demo functions for different visual styles
function demoNeonStyle(ctx, x, y, radius, color, type) {
  ctx.save();
  
  if (type === 'domain') {
    // Neon domain with pulsing glow
    const time = performance.now() * 0.003;
    const pulse = 1 + Math.sin(time) * 0.3;
    
    // Outer glow
    ctx.shadowColor = color;
    ctx.shadowBlur = 20 * pulse;
    ctx.fillStyle = color + '20';
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.2, 0, Math.PI * 2);
    ctx.fill();
    
    // Main circle
    ctx.shadowBlur = 0;
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    
    // Inner glow
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.fillStyle = color + '40';
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.6, 0, Math.PI * 2);
    ctx.fill();
    
  } else if (type === 'project') {
    // Neon hexagon with particles
    const time = performance.now() * 0.002;
    
    // Hexagon
    ctx.shadowColor = color;
    ctx.shadowBlur = 15;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    
    // Particles
    ctx.shadowBlur = 8;
    ctx.fillStyle = color;
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 + time;
      const distance = radius * 1.5;
      const px = x + Math.cos(angle) * distance;
      const py = y + Math.sin(angle) * distance;
      
      ctx.beginPath();
      ctx.arc(px, py, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    
  } else if (type === 'task') {
    // Neon task with pulsing border
    const time = performance.now() * 0.005;
    const pulse = 1 + Math.sin(time) * 0.2;
    
    ctx.shadowColor = color;
    ctx.shadowBlur = 12 * pulse;
    ctx.fillStyle = color + '60';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.shadowBlur = 0;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  
  ctx.restore();
}

function demoTechStyle(ctx, x, y, radius, color, type) {
  ctx.save();
  
  if (type === 'domain') {
    // Tech domain with circuit pattern
    const time = performance.now() * 0.001;
    
    // Main circle
    ctx.fillStyle = color + '20';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    
    // Circuit lines
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + time;
      const startRadius = radius * 0.7;
      const endRadius = radius * 1.1;
      
      ctx.beginPath();
      ctx.moveTo(
        x + Math.cos(angle) * startRadius,
        y + Math.sin(angle) * startRadius
      );
      ctx.lineTo(
        x + Math.cos(angle) * endRadius,
        y + Math.sin(angle) * endRadius
      );
      ctx.stroke();
    }
    
    // Center node
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
    
  } else if (type === 'project') {
    // Tech project with data flow
    const time = performance.now() * 0.002;
    
    // Hexagon outline
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    
    // Data flow lines
    ctx.strokeStyle = color + '80';
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2 + time;
      const distance = radius * 0.8;
      
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(
        x + Math.cos(angle) * distance,
        y + Math.sin(angle) * distance
      );
      ctx.stroke();
    }
    
  } else if (type === 'task') {
    // Tech task with status indicator
    ctx.fillStyle = color + '40';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    
    // Status dot
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  
  ctx.restore();
}

function demoMinimalStyle(ctx, x, y, radius, color, type) {
  ctx.save();
  
  if (type === 'domain') {
    // Minimal domain - clean circle
    ctx.fillStyle = color + '30';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    
  } else if (type === 'project') {
    // Minimal project - clean rectangle
    const width = radius * 1.4;
    const height = radius * 1.0;
    
    ctx.fillStyle = color + '40';
    ctx.fillRect(x - width/2, y - height/2, width, height);
    
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x - width/2, y - height/2, width, height);
    
  } else if (type === 'task') {
    // Minimal task - clean circle
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  
  ctx.restore();
}

// Demo function to show all styles
function showStyleDemo(style) {
  const canvas = document.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  
  // Clear canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Demo positions
  const demos = [
    { x: 200, y: 150, type: 'domain', color: '#00ffff' },
    { x: 400, y: 150, type: 'project', color: '#ff00ff' },
    { x: 300, y: 300, type: 'task', color: '#ffff00' }
  ];
  
  demos.forEach(demo => {
    if (style === 'neon') {
      demoNeonStyle(ctx, demo.x, demo.y, 40, demo.color, demo.type);
    } else if (style === 'tech') {
      demoTechStyle(ctx, demo.x, demo.y, 40, demo.color, demo.type);
    } else if (style === 'minimal') {
      demoMinimalStyle(ctx, demo.x, demo.y, 40, demo.color, demo.type);
    }
  });
  
  console.log(`Demo style: ${style}`);
}

// Fixed drawing functions that work with real map data
function drawNeonStyle(ctx, x, y, radius, color, type) {
  ctx.save();
  
  if (type === 'domain') {
    // Enhanced neon domain with multiple glow layers
    const time = performance.now() * 0.003;
    const pulse = 1 + Math.sin(time) * 0.4;
    const pulse2 = 1 + Math.sin(time * 1.3) * 0.2;
    
    // Outer mega glow
    ctx.shadowColor = color;
    ctx.shadowBlur = 40 * pulse;
    ctx.fillStyle = color + '15';
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.8, 0, Math.PI * 2);
    ctx.fill();
    
    // Middle glow
    ctx.shadowBlur = 25 * pulse2;
    ctx.fillStyle = color + '25';
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.3, 0, Math.PI * 2);
    ctx.fill();
    
    // Main circle with thick border
    ctx.shadowBlur = 0;
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    
    // Inner bright core
    ctx.shadowColor = color;
    ctx.shadowBlur = 15;
    ctx.fillStyle = color + '80';
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.4, 0, Math.PI * 2);
    ctx.fill();
    
    // Center bright dot
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
    
  } else if (type === 'project') {
    // Enhanced neon hexagon with energy field
    const time = performance.now() * 0.002;
    
    // Energy field around hexagon
    ctx.shadowColor = color;
    ctx.shadowBlur = 30;
    ctx.fillStyle = color + '10';
    ctx.beginPath();
    ctx.arc(x, y, radius * 2, 0, Math.PI * 2);
    ctx.fill();
    
    // Hexagon with thick glow
    ctx.shadowColor = color;
    ctx.shadowBlur = 20;
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    
    // Rotating energy particles
    ctx.shadowBlur = 12;
    ctx.fillStyle = color;
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + time;
      const distance = radius * 1.8;
      const px = x + Math.cos(angle) * distance;
      const py = y + Math.sin(angle) * distance;
      
      ctx.beginPath();
      ctx.arc(px, py, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    
    // Center energy core
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
    
  } else if (type === 'task') {
    // Enhanced neon task with energy pulse
    const time = performance.now() * 0.005;
    const pulse = 1 + Math.sin(time) * 0.3;
    const pulse2 = 1 + Math.sin(time * 1.5) * 0.2;
    
    // Outer energy ring
    ctx.shadowColor = color;
    ctx.shadowBlur = 20 * pulse;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.5, 0, Math.PI * 2);
    ctx.stroke();
    
    // Main task with strong glow
    ctx.shadowColor = color;
    ctx.shadowBlur = 15 * pulse2;
    ctx.fillStyle = color + '70';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    
    // Bright border
    ctx.shadowBlur = 0;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    
    // Center bright dot
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  
  ctx.restore();
}

function drawTechStyle(ctx, x, y, radius, color, type) {
  ctx.save();
  
  if (type === 'domain') {
    // Tech domain with circuit pattern
    const time = performance.now() * 0.001;
    
    // Main circle
    ctx.fillStyle = color + '20';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    
    // Circuit lines
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + time;
      const startRadius = radius * 0.7;
      const endRadius = radius * 1.1;
      
      ctx.beginPath();
      ctx.moveTo(
        x + Math.cos(angle) * startRadius,
        y + Math.sin(angle) * startRadius
      );
      ctx.lineTo(
        x + Math.cos(angle) * endRadius,
        y + Math.sin(angle) * endRadius
      );
      ctx.stroke();
    }
    
    // Center node
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
    
  } else if (type === 'project') {
    // Tech project with data flow
    const time = performance.now() * 0.002;
    
    // Hexagon outline
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    
    // Data flow lines
    ctx.strokeStyle = color + '80';
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2 + time;
      const distance = radius * 0.8;
      
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(
        x + Math.cos(angle) * distance,
        y + Math.sin(angle) * distance
      );
      ctx.stroke();
    }
    
  } else if (type === 'task') {
    // Tech task with status indicator
    ctx.fillStyle = color + '40';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    
    // Status dot
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  
  ctx.restore();
}

function drawMinimalStyle(ctx, x, y, radius, color, type) {
  ctx.save();
  
  if (type === 'domain') {
    // Minimal domain - clean circle
    ctx.fillStyle = color + '30';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    
  } else if (type === 'project') {
    // Minimal project - clean rectangle
    const width = radius * 1.4;
    const height = radius * 1.0;
    
    ctx.fillStyle = color + '40';
    ctx.fillRect(x - width/2, y - height/2, width, height);
    
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x - width/2, y - height/2, width, height);
    
  } else if (type === 'task') {
    // Minimal task - clean circle
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  
  ctx.restore();
}

// New style: Holographic
function drawHolographicStyle(ctx, x, y, radius, color, type) {
  ctx.save();
  
  if (type === 'domain') {
    // Holographic domain with scan lines
    const time = performance.now() * 0.001;
    
    // Base circle with transparency
    ctx.fillStyle = color + '30';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    
    // Scan lines effect
    ctx.strokeStyle = color + '60';
    ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + time;
      const startRadius = radius * 0.3;
      const endRadius = radius * 1.1;
      
      ctx.beginPath();
      ctx.moveTo(
        x + Math.cos(angle) * startRadius,
        y + Math.sin(angle) * startRadius
      );
      ctx.lineTo(
        x + Math.cos(angle) * endRadius,
        y + Math.sin(angle) * endRadius
      );
      ctx.stroke();
    }
    
    // Holographic border
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Center data node
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
    
  } else if (type === 'project') {
    // Holographic project with data matrix
    const time = performance.now() * 0.002;
    
    // Base hexagon
    ctx.fillStyle = color + '20';
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    
    // Data streams
    ctx.strokeStyle = color + '80';
    ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 + time;
      const distance = radius * 1.3;
      
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(
        x + Math.cos(angle) * distance,
        y + Math.sin(angle) * distance
      );
      ctx.stroke();
    }
    
    // Holographic border
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
    
  } else if (type === 'task') {
    // Holographic task with data pulse
    const time = performance.now() * 0.003;
    const pulse = 1 + Math.sin(time) * 0.3;
    
    // Base circle
    ctx.fillStyle = color + '40';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    
    // Data pulse rings
    ctx.strokeStyle = color + '60';
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const ringRadius = radius * (0.5 + i * 0.3) * pulse;
      ctx.beginPath();
      ctx.arc(x, y, ringRadius, 0, Math.PI * 2);
      ctx.stroke();
    }
    
    // Holographic border
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  
  ctx.restore();
}

// New style: Gradient
function drawGradientStyle(ctx, x, y, radius, color, type) {
  ctx.save();
  
  if (type === 'domain') {
    // Gradient domain with multiple color stops
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.5, color + '80');
    gradient.addColorStop(1, color + '20');
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    
    // Outer glow
    ctx.shadowColor = color;
    ctx.shadowBlur = 15;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    
  } else if (type === 'project') {
    // Gradient project with diagonal gradient
    const gradient = ctx.createLinearGradient(x - radius, y - radius, x + radius, y + radius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.5, color + '60');
    gradient.addColorStop(1, color + '30');
    
    // Rounded rectangle
    const width = radius * 1.4;
    const height = radius * 1.0;
    
    ctx.fillStyle = gradient;
    ctx.fillRect(x - width/2, y - height/2, width, height);
    
    // Border
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x - width/2, y - height/2, width, height);
    
  } else if (type === 'task') {
    // Gradient task with radial gradient
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.3, color);
    gradient.addColorStop(1, color + '60');
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    
    // Border
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  
  ctx.restore();
}

// Mixed style: Combines neon, gradient and holographic effects
function drawMixedStyle(ctx, x, y, radius, color, type) {
  ctx.save();
  
  if (type === 'domain') {
    // Mixed domain: gradient base + neon glow + holographic scan lines
    const time = performance.now() * 0.002;
    const pulse = 1 + Math.sin(time) * 0.3;
    
    // Gradient base
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.6, color + '60');
    gradient.addColorStop(1, color + '20');
    
    // Neon glow
    ctx.shadowColor = color;
    ctx.shadowBlur = 25 * pulse;
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    
    // Holographic scan lines
    ctx.shadowBlur = 0;
    ctx.strokeStyle = color + '80';
    ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 + time;
      const startRadius = radius * 0.4;
      const endRadius = radius * 1.2;
      
      ctx.beginPath();
      ctx.moveTo(
        x + Math.cos(angle) * startRadius,
        y + Math.sin(angle) * startRadius
      );
      ctx.lineTo(
        x + Math.cos(angle) * endRadius,
        y + Math.sin(angle) * endRadius
      );
      ctx.stroke();
    }
    
    // Neon border
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    
    // Bright center
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
    
  } else if (type === 'project') {
    // Mixed project: gradient hexagon + neon particles + holographic data streams
    const time = performance.now() * 0.001;
    
    // Gradient hexagon
    const gradient = ctx.createLinearGradient(x - radius, y - radius, x + radius, y + radius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.5, color + '70');
    gradient.addColorStop(1, color + '30');
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    
    // Neon particles
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.fillStyle = color;
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 + time;
      const distance = radius * 1.6;
      const px = x + Math.cos(angle) * distance;
      const py = y + Math.sin(angle) * distance;
      
      ctx.beginPath();
      ctx.arc(px, py, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    
    // Holographic data streams
    ctx.shadowBlur = 0;
    ctx.strokeStyle = color + '60';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    for (let i = 0; i < 3; i++) {
      const angle = (i / 3) * Math.PI * 2 + time;
      const distance = radius * 1.2;
      
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(
        x + Math.cos(angle) * distance,
        y + Math.sin(angle) * distance
      );
      ctx.stroke();
    }
    ctx.setLineDash([]);
    
    // Neon border
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    
  } else if (type === 'task') {
    // Mixed task: gradient + neon pulse + holographic rings
    const time = performance.now() * 0.003;
    const pulse = 1 + Math.sin(time) * 0.4;
    
    // Gradient base
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.4, color);
    gradient.addColorStop(1, color + '50');
    
    // Neon glow
    ctx.shadowColor = color;
    ctx.shadowBlur = 18 * pulse;
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    
    // Holographic rings
    ctx.shadowBlur = 0;
    ctx.strokeStyle = color + '70';
    ctx.lineWidth = 1;
    ctx.setLineDash([1, 1]);
    for (let i = 0; i < 2; i++) {
      const ringRadius = radius * (0.6 + i * 0.4) * pulse;
      ctx.beginPath();
      ctx.arc(x, y, ringRadius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    
    // Neon border
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    
    // Bright center
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
  }
  
  ctx.restore();
}


// Export demo functions globally (temporarily disabled for debugging)
// try { 
//   window.showStyleDemo = showStyleDemo;
//   window.demoNeonStyle = demoNeonStyle;
//   window.demotechStyle = demoTechStyle;
//   window.demoMinimalStyle = demoMinimalStyle;
// } catch (_) {}
let pendingDragStart = { x: 0, y: 0 };
// simple undo stack for moves: store { type: 'task'|'project', id, fromProjectId, toProjectId, fromPos, toPos }
let undoStack = [];
// transient pending attach: { taskId, fromProjectId, toProjectId, pos }
let pendingAttach = null;
// transient pending detach: { taskId, fromProjectId, pos }
let pendingDetach = null;
// transient pending project move: { projectId, fromDomainId, toDomainId, pos }
let pendingProjectMove = null;
let isModalOpen = false; // Flag to block canvas events when toast is shown

// DnD State Machine
const DnDState = {
  IDLE: 'idle',
  PRESSED: 'pressed',
  DRAGGING: 'dragging',
  DROPPED: 'dropped',
  CANCELED: 'canceled'
};

let dndState = DnDState.IDLE;
let dndData = null; // { type: 'task'|'project', id: string, startPos: {x,y} }
// Suppress synthetic click after pan/drag
let suppressClickUntil = 0;

// Navigation model: left-drag pans everywhere; click selects; drag node requires Alt or long-press
const NAV = {
  mode: 'idle', // 'idle'|'pending'|'pan'|'drag'
  downCX: 0,
  downCY: 0,
  lastCX: 0,
  lastCY: 0,
  downTime: 0,
  pointerId: null,
  hitNode: null,
  dragOffset: { x: 0, y: 0 },
};
const CLICK_MS = 220;
const HOLD_MS = 320; // reserved (long-press currently disabled)
const MOVE_SLOP = 5; // px (screen) — более чувствительное управление

function startPan() {
  NAV.mode = 'pan';
  canvas.style.cursor = 'grabbing';
  // Показываем подсказку о панорамировании
  if (window.DEBUG_MOUSE) console.log('[NAV] Pan mode activated - LMB drag to pan');
}
function updatePan(e) {
  const dx = e.clientX - NAV.lastCX;
  const dy = e.clientY - NAV.lastCY;
  NAV.lastCX = e.clientX;
  NAV.lastCY = e.clientY;
  const dpr = window.devicePixelRatio || 1;
  viewState.tx += dx * dpr;
  viewState.ty += dy * dpr;
  requestDraw();
}
function endPan() {
  NAV.mode = 'idle';
  canvas.style.cursor = '';
}
function triggerClickAt(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const offsetX = clientX - rect.left;
  const offsetY = clientY - rect.top;
  try { onClick({ offsetX, offsetY }); } catch(_) {}
}

// Function to position toast near user action
function positionToastNearAction(worldX, worldY, toast) {
  if (!toast) return;
  
  // Convert world coordinates to screen coordinates
  const screenPos = worldToScreen(worldX, worldY);
  
  // Get canvas position
  const canvas = document.getElementById('canvas');
  const canvasRect = canvas.getBoundingClientRect();
  
  // Calculate toast position relative to screen
  const toastX = canvasRect.left + screenPos.x;
  const toastY = canvasRect.top + screenPos.y;
  
  // Ensure toast stays within viewport
  const toastWidth = 300; // Approximate toast width
  const toastHeight = 60; // Approximate toast height
  const margin = 20;
  
  let finalX = toastX;
  let finalY = toastY;
  
  // Adjust X position if toast would go off screen
  if (finalX + toastWidth > window.innerWidth - margin) {
    finalX = window.innerWidth - toastWidth - margin;
  }
  if (finalX < margin) {
    finalX = margin;
  }
  
  // Adjust Y position if toast would go off screen
  if (finalY + toastHeight > window.innerHeight - margin) {
    finalY = window.innerHeight - toastHeight - margin;
  }
  if (finalY < margin) {
    finalY = margin;
  }
  
  // Apply position
  toast.style.position = 'fixed';
  toast.style.left = finalX + 'px';
  toast.style.top = finalY + 'px';
  toast.style.right = 'auto';
  toast.style.transform = 'none';
}

// Helper function to convert world coordinates to screen coordinates
function worldToScreen(worldX, worldY) {
  const canvas = document.getElementById('canvas');
  const dpr = window.devicePixelRatio || 1;
  
  // Apply view transform
  const screenX = (worldX - viewState.tx) * viewState.scale / dpr;
  const screenY = (worldY - viewState.ty) * viewState.scale / dpr;
  
  return { x: screenX, y: screenY };
}
// perf tuning
let dynamicEdgeCap = 300;
let allowGlow = true;
let emaDt = null; // ms
let lowFrames = 0,
  highFrames = 0;
let showFps = false;

// Cosmic effects
let starField = [];
let lastStarUpdate = 0;

// Global flag to prevent multiple map initialization
let mapInitialized = false;

export function initMap(canvasEl, tooltipEl) {
  // Prevent multiple initialization
  if (mapInitialized) {
    console.log('Map already initialized, skipping...');
    return;
  }
  
  mapInitialized = true;
  canvas = canvasEl;
  tooltip = tooltipEl;
  resize();
  // initStarField(); // TEMPORARILY DISABLED
  
  // Initialize cosmic animations
  if (window.cosmicAnimations) {
    console.log('Initializing cosmic animations...');
    window.cosmicAnimations.init(canvas, ctx);
    console.log('Cosmic animations initialized successfully');
  } else {
    console.warn('Cosmic animations not available!');
  }
  
  window.addEventListener("resize", () => {
    resize();
    // initStarField(); // TEMPORARILY DISABLED
    try { fitAll(); } catch(_) {}
  });
  // Use pointer events for better DnD handling - FIXED BY GPT-5
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("click", onClick);
  canvas.addEventListener("dblclick", onDblClick);
  canvas.addEventListener("contextmenu", onContextMenu);
  
  // Дополнительно отключаем контекстное меню на canvas
  canvas.oncontextmenu = function(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    return false;
  };
  
  // Также отключаем на уровне document для canvas
  document.addEventListener('contextmenu', function(e) {
    if (e.target === canvas) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return false;
    }
  }, true);
  
  // DISABLED: Mouse events - using pointer events instead
  // canvas.addEventListener("mousedown", onMouseDown);
  // canvas.addEventListener("mousemove", onMouseMove);
  // canvas.addEventListener("mouseup", onMouseUp);
  layoutMap();
  drawMap();
  // Автоматически подгоняем вид под все объекты при инициализации
  setTimeout(() => {
    try { fitAll(); } catch(_) {}
  }, 100);
  
  // Start cosmic animation loop
  startCosmicAnimationLoop();
  
  // Initialize context menu
  initContextMenu();
}

// Context menu functions
function initContextMenu() {
  const contextMenu = document.getElementById('contextMenu');
  if (!contextMenu) return;
  
  // Add event listeners to context menu items
  contextMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.context-menu-item');
    if (!item) return;
    
    const action = item.dataset.action;
    const worldPos = screenToWorld(contextMenuState.x, contextMenuState.y);
    
    switch (action) {
      case 'create-task':
        createTaskAtPosition(worldPos.x, worldPos.y);
        break;
      case 'create-project':
        createProjectAtPosition(worldPos.x, worldPos.y);
        break;
      case 'create-idea':
        createIdeaAtPosition(worldPos.x, worldPos.y);
        break;
      case 'create-note':
        createNoteAtPosition(worldPos.x, worldPos.y);
        break;
      case 'create-checklist':
        createChecklistAtPosition(worldPos.x, worldPos.y);
        break;
      case 'create-domain':
        createDomainAtPosition(worldPos.x, worldPos.y);
        break;
    }
    
    hideContextMenu();
  });
  
  // Hide context menu when clicking outside
  document.addEventListener('click', (e) => {
    if (!contextMenu.contains(e.target)) {
      hideContextMenu();
    }
  });
}

function showContextMenu(x, y) {
  const contextMenu = document.getElementById('contextMenu');
  if (!contextMenu) return;
  
  contextMenuState.x = x;
  contextMenuState.y = y;
  contextMenuState.isVisible = true;
  
  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';
  contextMenu.style.display = 'block';
}

function hideContextMenu() {
  const contextMenu = document.getElementById('contextMenu');
  if (!contextMenu) return;
  
  contextMenuState.isVisible = false;
  contextMenu.style.display = 'none';
}

// Creation functions for different object types
function createTaskAtPosition(x, y) {
  const newTask = {
    id: generateId(),
    title: 'Новая задача',
    description: '',
    projectId: null,
    status: 'backlog',
    priority: 'p3',
    dueDate: null,
    estimatedTime: null,
    tags: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  
  state.tasks.push(newTask);
  saveState();
  showTaskEditor(newTask);
}

function createProjectAtPosition(x, y) {
  const domainId = state.activeDomain || state.domains[0]?.id || null;
  if (!domainId) {
    showToast("Сначала выберите домен", "warn");
    return;
  }
  
  const newProject = {
    id: generateId(),
    domainId: domainId,
    title: 'Новый проект',
    description: '',
    color: getRandomProjectColor(),
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  
  state.projects.push(newProject);
  saveState();
  showProjectEditor(newProject);
}

function createIdeaAtPosition(x, y) {
  const idea = {
    id: generateId(),
    title: 'Новая идея',
    content: '',
    domainId: state.activeDomain || state.domains[0]?.id || null,
    x: x,
    y: y,
    r: 20,
    color: getRandomIdeaColor(),
    opacity: 0.8,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  
  state.ideas.push(idea);
  saveState();
  layoutMap();
  drawMap();
  showIdeaEditor(idea);
}

function createNoteAtPosition(x, y) {
  const note = {
    id: generateId(),
    title: 'Новая заметка',
    content: '',
    domainId: state.activeDomain || state.domains[0]?.id || null,
    x: x,
    y: y,
    r: 18,
    color: getRandomNoteColor(),
    opacity: 0.9,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  
  state.notes.push(note);
  saveState();
  layoutMap();
  drawMap();
  showNoteEditor(note);
}

function createChecklistAtPosition(x, y) {
  const checklist = {
    id: 'c' + generateId(),
    title: 'Новый чек-лист',
    projectId: null,
    domainId: state.activeDomain || state.domains[0]?.id || null,
    x: x,
    y: y,
    r: 20,
    color: getRandomProjectColor(),
    opacity: 0.9,
    items: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  
  state.checklists.push(checklist);
  saveState();
  
  // Принудительно обновляем карту
  if (window.layoutMap) window.layoutMap();
  if (window.drawMap) window.drawMap();
  
  // Открываем редактор
  window.showChecklistEditor(checklist);
}

function createDomainAtPosition(x, y) {
  const newDomain = {
    id: generateId(),
    title: 'Новый домен',
    mood: 'balance',
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  
  state.domains.push(newDomain);
  saveState();
  showDomainEditor(newDomain);
}

// Global flags to prevent multiple initialization and loops
let cosmicAnimationRunning = false;
let isDrawing = false;
let isLayouting = false;

// Export demo functions globally
try { 
  window.showStyleDemo = showStyleDemo;
  window.demoNeonStyle = demoNeonStyle;
  window.demotechStyle = demoTechStyle;
  window.demoMinimalStyle = demoMinimalStyle;
} catch (_) {}

// Optimized cosmic animation loop
function startCosmicAnimationLoop() {
  // Prevent multiple animation loops
  if (cosmicAnimationRunning) {
    console.log('Cosmic animation loop already running, skipping...');
    return;
  }
  
  cosmicAnimationRunning = true;
  console.log('Starting cosmic animation loop...');
  let lastUpdate = 0;
  const targetFPS = 30; // Limit to 30 FPS for better performance
  const frameInterval = 1000 / targetFPS;
  
  function animate(currentTime) {
    // Only update if enough time has passed and not already drawing
    if (currentTime - lastUpdate >= frameInterval && !isDrawing) {
      // Update cosmic effects
      if (window.cosmicAnimations) {
        window.cosmicAnimations.update();
      }
      
      // Only redraw if there are active particles and not already drawing
      if (window.cosmicAnimations && window.cosmicAnimations.particles.length > 0 && !isDrawing) {
        drawMap();
      }
      
      lastUpdate = currentTime;
    }
    
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}

export function setShowFps() {
  showFps = !showFps;
  drawMap();
}

// Export function to get current nodes for external modules
export function getMapNodes() {
  return nodes;
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
  drawMap();
}

// Focus mode "Black Hole" functions
export function toggleFocusMode(domainId = null) {
  if (focusMode.active) {
    // Exit focus mode
    focusMode.active = false;
    focusMode.domainId = null;
    focusMode.originalOpacity = {};
    showToast("Режим фокуса выключен", "ok");
  } else {
    // Enter focus mode
    if (!domainId) {
      // If no domain specified, use active domain
      domainId = state.activeDomain;
    }
    if (!domainId) {
      showToast("Выберите домен для фокуса", "warn");
      return;
    }
    
    focusMode.active = true;
    focusMode.domainId = domainId;
    showToast(`Режим фокуса: ${state.domains.find(d => d.id === domainId)?.title}`, "ok");
  }
  
  // Recalculate layout and redraw
  layoutMap();
  drawMap();
}

export function isFocusModeActive() {
  return focusMode.active;
}

export function getFocusedDomainId() {
  return focusMode.domainId;
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
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function fitToBBox(bx) {
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
  const scale = clamp(sx, 0.5, 2.2);
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
  fitToBBox({ minX, minY, maxX, maxY });
}

export function fitActiveDomain() {
  const domId = state.activeDomain;
  const dn = nodes.find(
    (n) => n._type === "domain" && (!domId || n.id === domId)
  );
  if (!dn) {
    drawMap();
    return;
  }
  // Включаем домен, все его проекты и все задачи (как привязанные к проектам, так и независимые в домене)
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
        (state.tasks.find((t) => t.id === n.id)?.domainId === dn.id)
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
  const baseRadius = 32 * DPR;

  if (tasks.length === 0) return baseRadius;

  // Вычисляем максимальный размер задачи
  const maxTaskSize = Math.max(...tasks.map(task => sizeByImportance(task) * DPR));
  
  // Вычисляем количество задач
  const taskCount = tasks.length;
  
  // Минимальное расстояние между центрами задач
  const minDist = maxTaskSize * 2.2 + 10 * DPR;
  
  // Для небольшого количества задач используем простую формулу
  if (taskCount <= 3) {
    return Math.max(baseRadius, maxTaskSize * 2.5 + 16 * DPR);
  }
  
  // Для большего количества задач используем кольцевую упаковку
  // Максимум 8 задач в кольце
  const maxTasksPerRing = 8;
  const ringsNeeded = Math.ceil(taskCount / maxTasksPerRing);
  
  // Вычисляем радиус для каждого кольца
  let totalRadius = 0;
  for (let ring = 0; ring < ringsNeeded; ring++) {
    const tasksInRing = Math.min(maxTasksPerRing, taskCount - ring * maxTasksPerRing);
    const ringRadius = minDist + ring * minDist;
    totalRadius = Math.max(totalRadius, ringRadius);
  }
  
  // Добавляем отступ от края
  const finalRadius = totalRadius + maxTaskSize + 16 * DPR;

  // Возвращаем максимальное значение между базовым радиусом и вычисленным
  return Math.max(baseRadius, finalRadius);
}

function calculateDomainRadius(projects) {
  // Минимальный размер для пустых доменов (с учетом DPR)
  const baseRadius = 80 * DPR;

  if (projects.length === 0) return baseRadius;

  // Вычисляем максимальный размер проекта
  const maxProjectSize = Math.max(...projects.map(project => project.r || 40 * DPR));
  
  // Вычисляем количество проектов
  const projectCount = projects.length;
  
  // Для небольшого количества проектов используем простую формулу
  if (projectCount <= 2) {
    return Math.max(baseRadius, maxProjectSize * 2.0 + 32 * DPR);
  }
  
  // Для большего количества проектов используем площадь
  const totalProjectArea = projects.reduce((sum, project) => {
    const projectSize = project.r || 40 * DPR;
    return sum + Math.PI * projectSize * projectSize;
  }, 0);

  // Добавляем пространство для отступов между проектами (50%)
  const areaWithPadding = totalProjectArea * 1.5;

  // Вычисляем радиус круга, который может вместить эту площадь
  const radiusFromArea = Math.sqrt(areaWithPadding / Math.PI) + 32 * DPR;

  // Возвращаем максимальное значение между базовым радиусом и вычисленным
  return Math.max(baseRadius, radiusFromArea);
}

export function layoutMap() {
  // Prevent recursive layout calls
  if (isLayouting) {
    return;
  }
  isLayouting = true;
  
  // Отладка для Edge
  if (window.DEBUG_EDGE_TASKS) {
    console.log('=== LAYOUT MAP ===');
    console.log('layoutMap called, state.tasks:', state.tasks.length, state.tasks);
    console.log('state.projects:', state.projects.length, state.projects);
    console.log('state.domains:', state.domains.length, state.domains);
  }
  
  nodes = [];
  edges = [];
  // Filter domains based on focus mode
  let domains;
  if (focusMode.active) {
    // In focus mode, show only the focused domain
    domains = state.domains.filter((d) => d.id === focusMode.domainId);
  } else {
    // Normal mode - show active domain or all domains
    domains = state.activeDomain
    ? state.domains.filter((d) => d.id === state.activeDomain)
    : state.domains.slice();
  }
  const domainCount = domains.length;
  // Радиусы доменов (можно сделать динамическими, если потребуется)
  const domainRadius = 220 * DPR;
  const midY = H / 2;
  // Автоматическое размещение доменов без пересечений
  let domainXs = [];
  let totalWidth = 0;
  for (let i = 0; i < domainCount; i++) {
    totalWidth += (i === 0 ? 0 : domainRadius * 2) + 32 * DPR;
  }
  // Центрируем домены по ширине
  let startX =
    (W -
      ((domainCount - 1) * (domainRadius * 2 + 32 * DPR) + domainRadius * 2)) /
      2 +
    domainRadius;
  for (let i = 0; i < domainCount; i++) {
    domainXs.push(startX + i * (domainRadius * 2 + 32 * DPR));
  }

  // Prepare task list first since we need it for project sizing
  const taskList = state.tasks
    .filter((t) =>
      state.projects.some(
        (p) => domains.some((d) => d.id === p.domainId) && p.id === t.projectId
      )
    )
    .filter(
      (t) => !state.filterTag || (t.tags || []).includes(state.filterTag)
    )
    .filter(
      (t) => !state.filterStatus || t.status === state.filterStatus
    )
    .filter(
      (t) => !state.searchQuery || 
        t.title.toLowerCase().includes(state.searchQuery.toLowerCase()) ||
        (t.tags || []).some(tag => tag.toLowerCase().includes(state.searchQuery.toLowerCase()))
    );

  domains.forEach((d, i) => {
    const x = domainXs[i];
    const y = midY;
    const color = (d.color || "").startsWith("var(")
      ? getComputedStyle(document.documentElement)
          .getPropertyValue(d.color.replace("var(", "").replace(")", "").trim())
          .trim()
      : d.color || "#2dd4bf";
    
    // Добавляем mood для домена
    console.log(`=== CALCULATING MOOD FOR DOMAIN: ${d.title} (${d.id}) ===`);
    
    // Объявляем переменные вне try блока
    let mood, moodColor, moodDescription;
    
    // Простая проверка
    try {
      mood = getDomainMood(d.id);
      moodColor = getMoodColor(mood);
      moodDescription = getMoodDescription(mood);
    } catch (error) {
      console.error(`Error calculating mood for ${d.title}:`, error);
      mood = 'balance';
      moodColor = getMoodColor(mood);
      moodDescription = getMoodDescription(mood);
    }
    
    nodes.push({
      _type: "domain",
      id: d.id,
      title: d.title,
      x,
      y,
      r: domainRadius,
      color,
      mood,
      moodColor,
      moodDescription,
    });
  });

  const visibleProjects = state.projects
    .filter((p) => domains.some((d) => d.id === p.domainId) || p.domainId === null) // Include independent projects
    .filter((p) => {
      if (!state.filterTag) return true;
      return state.tasks.some(
        (t) => t.projectId === p.id && (t.tags || []).includes(state.filterTag)
      );
    });

  visibleProjects.forEach((p) => {
    const dNode = nodes.find(
      (n) => n._type === "domain" && n.id === p.domainId
    );
    
    if (p.domainId === null) {
      // Independent project - use saved position or default position
      const projectTasks = taskList.filter((t) => t.projectId === p.id);
      let projectRadius = calculateProjectRadius(projectTasks);
      const saved = p.pos || p._pos;
      
      // Default position for independent projects (center-right of screen)
      const defaultX = W * 0.75;
      const defaultY = H * 0.5;
      
      nodes.push({
        _type: "project",
        id: p.id,
        title: p.title,
        x: saved && typeof saved.x === "number" ? saved.x : defaultX,
        y: saved && typeof saved.y === "number" ? saved.y : defaultY,
        r: projectRadius,
        color: p.color,
      });
    } else if (dNode) {
      // Project in domain - use existing logic
    const prjs = visibleProjects.filter((pp) => pp.domainId === p.domainId);
    const ii = prjs.indexOf(p);
    const total = prjs.length;
    // Радиус проекта не должен превышать радиус домена минус отступ
    const maxProjectRadius = dNode.r - 32 * DPR;
    const projectTasks = taskList.filter((t) => t.projectId === p.id);
    let projectRadius = calculateProjectRadius(projectTasks);
    if (projectRadius > maxProjectRadius) projectRadius = maxProjectRadius;
    // Размещаем проекты по кругу внутри домена с учётом их радиусов
    const angle = (ii / Math.max(1, total)) * Math.PI * 2;
    const orbit = dNode.r - projectRadius - 16 * DPR;
    const x = dNode.x + Math.cos(angle) * orbit;
    const y = dNode.y + Math.sin(angle) * orbit;
    // prefer saved position if present (pos first, fallback to _pos)
    const saved = p.pos || p._pos;
    nodes.push({
      _type: "project",
      id: p.id,
      title: p.title,
      x: saved && typeof saved.x === "number" ? saved.x : x,
      y: saved && typeof saved.y === "number" ? saved.y : y,
      r: projectRadius,
      parent: dNode.id,
    });
    }
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
      // 4. Группируем задачи по кольцам с ограничением по количеству
      let rings = [];
      let placed = 0;
      let currentRadius = minDist;
      
      while (placed < siblings.length && currentRadius <= maxR) {
        // Максимальное количество задач в кольце (не более 8)
        const maxTasksInRing = Math.min(8, Math.floor((2 * Math.PI * currentRadius) / minDist));
        const tasksInRing = Math.min(maxTasksInRing, siblings.length - placed);
        
        if (tasksInRing > 0) {
          const ringTasks = siblings.slice(placed, placed + tasksInRing);
          rings.push({ radius: currentRadius, tasks: ringTasks });
          placed += tasksInRing;
        }
        
        currentRadius += minDist;
      }
      
      // Если задач больше, чем поместилось на кольцах, увеличиваем размер проекта
      if (placed < siblings.length) {
        // Вычисляем необходимый радиус для оставшихся задач
        const remainingTasks = siblings.length - placed;
        const additionalRadius = Math.ceil(remainingTasks / 8) * minDist;
        const newProjectRadius = Math.min(pNode.r + additionalRadius, maxR + additionalRadius);
        
        // Обновляем радиус проекта
        pNode.r = newProjectRadius;
        
        // Добавляем оставшиеся задачи в новые кольца
        let remainingPlaced = placed;
        let newRadius = currentRadius;
        
        while (remainingPlaced < siblings.length && newRadius <= newProjectRadius - maxSize - 8 * DPR) {
          const maxTasksInRing = Math.min(8, Math.floor((2 * Math.PI * newRadius) / minDist));
          const tasksInRing = Math.min(maxTasksInRing, siblings.length - remainingPlaced);
          
          if (tasksInRing > 0) {
            const ringTasks = siblings.slice(remainingPlaced, remainingPlaced + tasksInRing);
            rings.push({ radius: newRadius, tasks: ringTasks });
            remainingPlaced += tasksInRing;
          }
          
          newRadius += minDist;
        }
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
            nodes.push({
              _type: "task",
              id: t.id,
              title: t.title,
              x: x,
              y: y,
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
    } else {
      // Свободное размещение вне проектов
      const savedT = t.pos || t._pos;
      nodes.push({
        _type: "task",
        id: t.id,
        title: t.title,
        x: savedT && typeof savedT.x === "number" ? savedT.x : 100,
        y: savedT && typeof savedT.y === "number" ? savedT.y : 100,
        r: sizeByImportance(t) * DPR,
        status: t.status,
        aging: t.updatedAt,
      });
    }
  });

  // independent tasks: render per-domain belt (auto) or saved pos (manual)
  try {
    const indepAll = state.tasks
      .filter((t) => !t.projectId)
      .filter(
        (t) => !state.filterTag || (t.tags || []).includes(state.filterTag)
      )
      .filter(
        (t) => !state.filterStatus || t.status === state.filterStatus
      )
      .filter(
        (t) => !state.searchQuery || 
          t.title.toLowerCase().includes(state.searchQuery.toLowerCase()) ||
          (t.tags || []).some(tag => tag.toLowerCase().includes(state.searchQuery.toLowerCase()))
      );
    
    // Разделяем на задачи с доменом и полностью независимые
    const tasksWithDomain = indepAll.filter(t => t.domainId);
    const fullyIndependent = indepAll.filter(t => !t.domainId);
    
    // Задачи с доменом размещаем по доменам
    domains.forEach((d) => {
      const dNode = nodes.find((n) => n._type === "domain" && n.id === d.id);
      if (!dNode) return;
      const list = tasksWithDomain.filter((t) => t.domainId === d.id);
      const total = list.length;
      list.forEach((t, idx) => {
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
          // Автоматическое размещение по орбите домена
          const orbit = Math.max(48 * DPR, dNode.r - 22 * DPR);
          const angle =
            (idx / Math.max(1, total)) * 2 * Math.PI + golden * 0.37;
          const x = dNode.x + Math.cos(angle) * orbit;
          const y = dNode.y + Math.sin(angle) * orbit;
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
        const maxDomainX = Math.max(...domains.map(d => {
          const dNode = nodes.find(n => n._type === 'domain' && n.id === d.id);
          return dNode ? dNode.x + dNode.r : 0;
        }));
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

  // Добавляем идеи и заметки в nodes
  if (state.ideas && state.ideas.length > 0) {
    console.log('🎨 Adding ideas to nodes:', state.ideas.length);
    state.ideas.forEach(idea => {
      if (idea.x !== undefined && idea.y !== undefined && idea.r !== undefined) {
        nodes.push({
          _type: "idea",
          id: idea.id,
          title: idea.title,
          x: idea.x,
          y: idea.y,
          r: idea.r,
          color: idea.color,
          opacity: idea.opacity,
          content: idea.content,
          domainId: idea.domainId
        });
      } else {
        console.warn('⚠️ Idea missing coordinates:', idea);
      }
    });
  }

  if (state.notes && state.notes.length > 0) {
    console.log('📝 Adding notes to nodes:', state.notes.length);
    state.notes.forEach(note => {
      if (note.x !== undefined && note.y !== undefined && note.r !== undefined) {
        nodes.push({
          _type: "note",
          id: note.id,
          title: note.title,
          x: note.x,
          y: note.y,
          r: note.r,
          color: note.color,
          opacity: note.opacity,
          content: note.content,
          domainId: note.domainId
        });
      } else {
        console.warn('⚠️ Note missing coordinates:', note);
      }
    });
  }

  // Добавляем чек-листы в nodes
  if (state.checklists && state.checklists.length > 0) {
    console.log('✓ Adding checklists to nodes:', state.checklists.length);
    state.checklists.forEach(checklist => {
      if (checklist.x !== undefined && checklist.y !== undefined && checklist.r !== undefined) {
        nodes.push({
          _type: "checklist",
          id: checklist.id,
          title: checklist.title,
          x: checklist.x,
          y: checklist.y,
          r: checklist.r,
          color: checklist.color,
          opacity: checklist.opacity,
          items: checklist.items,
          projectId: checklist.projectId,
          domainId: checklist.domainId
        });
      } else {
        console.warn('⚠️ Checklist missing coordinates:', checklist);
      }
    });
  }

  if (state.showLinks) {
    const tasks = nodes.filter((n) => n._type === "task");
    const dataTasks = taskList;
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
  
  // Отладка для Edge - показываем результат layoutMap
  if (window.DEBUG_EDGE_TASKS) {
    console.log('=== LAYOUT RESULT ===');
    console.log('Total nodes created:', nodes.length);
    console.log('Node types:', nodes.map(n => n._type));
    console.log('Task nodes:', nodes.filter(n => n._type === 'task').length);
    console.log('Project nodes:', nodes.filter(n => n._type === 'project').length);
    console.log('Domain nodes:', nodes.filter(n => n._type === 'domain').length);
  }
  
  // Reset layouting flag
  isLayouting = false;
}

export function drawMap() {
  if (!ctx) return;
  
  // Prevent recursive drawing
  if (isDrawing) {
    return;
  }
  isDrawing = true;
  
  // if nodes not prepared (empty), try to rebuild layout once — helps recover after edits
  if (!nodes || nodes.length === 0) {
    try {
      layoutMap();
    } catch (_) {}
  }
  const t0 = performance.now();
  
  // Анимация эффекта клика (медленнее и плавнее)
  if (clickEffectTime > 0) {
    clickEffectTime -= 0.02; // Медленнее затухание (было 0.05)
    if (clickEffectTime <= 0) {
      clickEffectTime = 0;
      clickedNodeId = null;
    }
  }
  
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  
  // Focus mode "Black Hole" effect
  if (focusMode.active) {
    // Create dark overlay with gradient effect
    const gradient = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, Math.max(W, H)/2);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.3)');
    gradient.addColorStop(0.7, 'rgba(0, 0, 0, 0.7)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0.9)');
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);
    
    // Add "event horizon" effect around focused domain
    const focusedDomain = nodes.find(n => n._type === 'domain' && n.id === focusMode.domainId);
    if (focusedDomain) {
      const gradient2 = ctx.createRadialGradient(
        focusedDomain.x, focusedDomain.y, focusedDomain.r,
        focusedDomain.x, focusedDomain.y, focusedDomain.r + 100
      );
      gradient2.addColorStop(0, 'rgba(0, 0, 0, 0)');
      gradient2.addColorStop(0.8, 'rgba(0, 0, 0, 0.5)');
      gradient2.addColorStop(1, 'rgba(0, 0, 0, 0.8)');
      
      ctx.fillStyle = gradient2;
      ctx.fillRect(0, 0, W, H);
    }
  }
  
  // single transform matrix: scale + translate
  ctx.setTransform(
    viewState.scale,
    0,
    0,
    viewState.scale,
    viewState.tx,
    viewState.ty
  );

  // Cosmic starfield with twinkling stars - TEMPORARILY DISABLED
  // drawStarfield(ctx, W, H, viewState);
  
  // Render cosmic effects (particles, animations)
  if (window.cosmicAnimations) {
    window.cosmicAnimations.render();
  }
  
  // Draw new cosmic objects
  if (W > 0 && H > 0) {
    drawIdeas();
    drawNotes();
    drawChecklists();
  }

  // compute viewport in world coords for culling
  const inv = 1 / Math.max(0.0001, viewState.scale);
  const pad = 120 * inv;
  const vx0 = -viewState.tx * inv - pad;
  const vy0 = -viewState.ty * inv - pad;
  const vx1 = (W - viewState.tx) * inv + pad;
  const vy1 = (H - viewState.ty) * inv + pad;
  const inView = (x, y, r = 0) =>
    x + r > vx0 && x - r < vx1 && y + r > vy0 && y - r < vy1;

  // edges - enhanced visibility
  if (state.showLinks) {
    ctx.lineCap = "round";
    edges.forEach((e) => {
      if (!inView(e.a.x, e.a.y, e.a.r) && !inView(e.b.x, e.b.y, e.b.r)) return;
      
      // Add energy flow effect for connections
      if (window.cosmicAnimations && Math.random() < 0.1) { // 10% chance per frame
        window.cosmicAnimations.createEnergyFlow(e.a.x, e.a.y, e.b.x, e.b.y, e.color);
      }
      
      const a = e.a,
        b = e.b;
      const mx = (a.x + b.x) / 2,
        my = (a.y + b.y) / 2;
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const k = 0.12 * (1 / (1 + dist / (300 * DPR)));
      const dx = (b.y - a.y) * k,
        dy = (a.x - b.x) * k;
      
      // Draw connection with enhanced visibility
      // Outer glow
      ctx.shadowBlur = 8;
      ctx.shadowColor = e.color + '40';
      ctx.strokeStyle = e.color + '20';
      ctx.lineWidth = e.w + 4;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.bezierCurveTo(mx + dx, my + dy, mx - dx, my - dy, b.x, b.y);
      ctx.stroke();
      
      // Main connection
      ctx.shadowBlur = 0;
      ctx.strokeStyle = e.color;
      ctx.lineWidth = e.w;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.bezierCurveTo(mx + dx, my + dy, mx - dx, my - dy, b.x, b.y);
      ctx.stroke();
      
      // Add connection dots at endpoints
      ctx.fillStyle = e.color;
      ctx.beginPath();
      ctx.arc(a.x, a.y, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(b.x, b.y, 2, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // highlight edges + neighbor contours
  if (hoverNodeId) {
    const neighborIds = new Set();
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
        neighborIds.add(a.id);
        neighborIds.add(b.id);
      }
    });
    const hovered = nodes.find((n) => n.id === hoverNodeId);
    nodes.forEach((n) => {
      if (n.id === hoverNodeId) return;
      const isNeighbor =
        neighborIds.has(n.id) ||
        (hovered?._type === "project" &&
          n._type === "task" &&
          state.tasks.find((t) => t.id === n.id)?.projectId === hovered.id) ||
        (hovered?._type === "domain" &&
          n._type === "project" &&
          state.projects.find((p) => p.id === n.id)?.domainId === hovered.id);
      if (isNeighbor) {
        ctx.beginPath();
        ctx.strokeStyle = "#7fb3ff";
        ctx.lineWidth = 1 * DPR;
        ctx.arc(n.x, n.y, n.r + 6 * DPR, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  }

  // domains as nebulae
  nodes
    .filter((n) => n._type === "domain")
    .forEach((n) => {
      const __skipCull = window.DEBUG_EDGE_TASKS === true;
      if (!__skipCull && !inView(n.x, n.y, n.r + 30 * DPR)) return;
      
      // Используем mood цвет вместо обычного цвета домена
      const domainColor = n.moodColor || n.color;
      
      // Draw nebula with mood-based effects
      if (projectVisualStyle === 'original') {
        // Original domain drawing with mood enhancements
      const grad = ctx.createRadialGradient(n.x, n.y, n.r * 0.3, n.x, n.y, n.r);
        grad.addColorStop(0, domainColor + "33");
      grad.addColorStop(1, "#0000");
      ctx.beginPath();
      ctx.fillStyle = grad;
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fill();
        
        // Mood-based border effects
        ctx.beginPath();
        ctx.strokeStyle = domainColor;
        ctx.lineWidth = 1.2 * DPR;
        
        // Different dash patterns based on mood
        if (n.mood === 'crisis') {
          ctx.setLineDash([2 * DPR, 2 * DPR]); // Fast blinking for crisis
        } else if (n.mood === 'pressure') {
          ctx.setLineDash([4 * DPR, 2 * DPR]); // Uneven pattern for pressure
        } else if (n.mood === 'growth') {
          ctx.setLineDash([6 * DPR, 2 * DPR]); // Growing pattern for growth
        } else {
          ctx.setLineDash([4 * DPR, 4 * DPR]); // Steady pattern for balance
        }
        
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Add mood indicator ring
        if (n.mood !== 'balance') {
          ctx.beginPath();
          ctx.strokeStyle = domainColor + "80";
          ctx.lineWidth = 3 * DPR;
          ctx.arc(n.x, n.y, n.r + 8 * DPR, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else if (projectVisualStyle === 'neon') {
        drawNeonStyle(ctx, n.x, n.y, n.r, domainColor, 'domain');
      } else if (projectVisualStyle === 'tech') {
        drawTechStyle(ctx, n.x, n.y, n.r, domainColor, 'domain');
      } else if (projectVisualStyle === 'minimal') {
        drawMinimalStyle(ctx, n.x, n.y, n.r, domainColor, 'domain');
      } else if (projectVisualStyle === 'holographic') {
        drawHolographicStyle(ctx, n.x, n.y, n.r, domainColor, 'domain');
      } else if (projectVisualStyle === 'gradient') {
        drawGradientStyle(ctx, n.x, n.y, n.r, domainColor, 'domain');
      } else if (projectVisualStyle === 'mixed') {
        drawMixedStyle(ctx, n.x, n.y, n.r, domainColor, 'domain');
      } else {
        // Original domain rendering (M-01: Domain Aura)
        console.log("Rendering domain with original style:", n.id, domainColor);
        const gradient = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
        gradient.addColorStop(0, domainColor + "40");
        gradient.addColorStop(0.7, domainColor + "20");
        gradient.addColorStop(1, domainColor + "10");
        
        ctx.beginPath();
        ctx.fillStyle = gradient;
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
        
        // Dashed border
        ctx.beginPath();
        ctx.strokeStyle = domainColor;
        ctx.lineWidth = 1.2 * DPR;
        ctx.setLineDash([4 * DPR, 4 * DPR]);
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      
      // Search highlight
      if (state.searchResults && state.searchResults.domains && state.searchResults.domains.includes(n.id)) {
      ctx.beginPath();
        ctx.strokeStyle = "#ffd700";
        ctx.lineWidth = 2 * DPR;
        ctx.arc(n.x, n.y, n.r + 8 * DPR, 0, Math.PI * 2);
        ctx.stroke();
      }
      
      // domain highlight when target for project drop or hover
      if (dropTargetDomainId === n.id || hoverNodeId === n.id) {
        ctx.beginPath();
        ctx.strokeStyle = "#7fffd4";
        ctx.lineWidth = 3 * DPR;
        ctx.arc(n.x, n.y, n.r + 6 * DPR, 0, Math.PI * 2);
        ctx.stroke();
      }
      
      // Domain border
      ctx.beginPath();
      ctx.strokeStyle = n.color;
      ctx.lineWidth = 1.2 * DPR;
      ctx.setLineDash([4 * DPR, 4 * DPR]);
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      
      // Domain title
      ctx.fillStyle = "#cfe8ff";
      ctx.font = `${14 * DPR}px system-ui`;
      ctx.textAlign = "center";
      ctx.fillText(n.title, n.x, n.y - n.r - 8 * DPR);
      
      // Визуальные индикаторы блокировок
      const domain = state.domains.find(d => d.id === n.id);
      if (domain && domain.locks) {
        // Иконка замка для блокировки перемещения
        if (domain.locks.move) {
          ctx.fillStyle = "#ff6b6b";
          ctx.font = `${12 * DPR}px system-ui`;
          ctx.textAlign = "center";
          ctx.fillText("🔒", n.x + n.r - 15 * DPR, n.y - n.r + 20 * DPR);
        }
        
        // Иконка цепи для блокировки смены связей
        if (domain.locks.hierarchy) {
          ctx.fillStyle = "#ffa500";
          ctx.font = `${12 * DPR}px system-ui`;
          ctx.textAlign = "center";
          ctx.fillText("⛓️", n.x + n.r - 15 * DPR, n.y - n.r + 35 * DPR);
        }
      }
    });

  // projects as planets
  nodes
    .filter((n) => n._type === "project")
    .forEach((n) => {
      const __skipCull2 = window.DEBUG_EDGE_TASKS === true;
      if (!__skipCull2 && !inView(n.x, n.y, n.r + 30 * DPR)) return;
      
      // Draw planet with gentle pulsing animation
      const time = performance.now() * 0.0008; // Очень медленная анимация
      const pulse = 1 + Math.sin(time) * 0.05; // Очень слабая пульсация
      const pulseRadius = n.r * pulse;
      
      // Use project ID as seed for unique shape and project color
      const seed = n.id ? n.id.split('').reduce((a, b) => a + b.charCodeAt(0), 0) : 0;
      const project = byId(state.projects, n.id);
      const projectColor = getProjectColor(project) || "#7b68ee";
      
      // Отладка цветов проектов
      if (window.DEBUG_COLORS) {
        console.log(`Project ${n.id}:`, project, 'Color:', projectColor);
      }
      
      // Показываем информацию о цвете в консоли при первом рендере
      if (!window._colorsLogged) {
        console.log('🎨 Цвета проектов загружены!');
        console.log('Для отладки: window.DEBUG_COLORS = true');
        console.log('Для смены стиля: setProjectVisualStyle("modern")');
        console.log('🔧 Для отладки Edge: window.DEBUG_EDGE_TASKS = true');
        console.log('🖱️ Средняя кнопка мыши для панорамирования работает!');
        window._colorsLogged = true;
      }
      
      // Choose visualization style based on settings
      if (projectVisualStyle === 'original') {
        // Улучшенная отрисовка проектов
        const isHovered = hoverNodeId === n.id;
        const baseRadius = 12 * DPR;
        const hoverRadius = isHovered ? baseRadius + 4 * DPR : baseRadius;
        
        // Основной круг проекта (непрозрачный)
        ctx.beginPath();
        ctx.fillStyle = projectColor;
        ctx.arc(n.x, n.y, hoverRadius, 0, Math.PI * 2);
        ctx.fill();
        
        // Обводка (тонкая, контрастная)
        ctx.beginPath();
        ctx.strokeStyle = getContrastColor(projectColor);
        ctx.lineWidth = 1.5 * DPR;
        ctx.arc(n.x, n.y, hoverRadius, 0, Math.PI * 2);
        ctx.stroke();
        
        // Свечение при наведении
        if (isHovered) {
          ctx.shadowColor = projectColor;
          ctx.shadowBlur = 15 * DPR;
          ctx.beginPath();
          ctx.fillStyle = projectColor + "60";
          ctx.arc(n.x, n.y, hoverRadius + 3 * DPR, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        }
        
      } else if (projectVisualStyle === 'modern') {
        drawProjectModern(ctx, n.x, n.y, pulseRadius, projectColor, seed);
      } else if (projectVisualStyle === 'simple') {
        drawProjectSimple(ctx, n.x, n.y, pulseRadius, projectColor, seed);
      } else if (projectVisualStyle === 'planet') {
        drawPlanet(ctx, n.x, n.y, pulseRadius, projectColor, 'planet');
      } else if (projectVisualStyle === 'neon') {
        drawNeonStyle(ctx, n.x, n.y, pulseRadius, projectColor, 'project');
      } else if (projectVisualStyle === 'tech') {
        drawTechStyle(ctx, n.x, n.y, pulseRadius, projectColor, 'project');
      } else if (projectVisualStyle === 'minimal') {
        drawMinimalStyle(ctx, n.x, n.y, pulseRadius, projectColor, 'project');
      } else if (projectVisualStyle === 'holographic') {
        drawHolographicStyle(ctx, n.x, n.y, pulseRadius, projectColor, 'project');
      } else if (projectVisualStyle === 'gradient') {
        drawGradientStyle(ctx, n.x, n.y, pulseRadius, projectColor, 'project');
      } else if (projectVisualStyle === 'mixed') {
        drawMixedStyle(ctx, n.x, n.y, pulseRadius, projectColor, 'project');
      } else {
        // Original project rendering (M-02: Project Orbit)
        console.log("Rendering project with original style:", n.id, projectColor);
        ctx.beginPath();
        ctx.fillStyle = projectColor;
        ctx.arc(n.x, n.y, pulseRadius, 0, Math.PI * 2);
        ctx.fill();
        
        // Thin border
        ctx.beginPath();
        ctx.strokeStyle = getContrastColor(projectColor);
        ctx.lineWidth = 1 * DPR;
        ctx.arc(n.x, n.y, pulseRadius, 0, Math.PI * 2);
        ctx.stroke();
      }
      
      // Универсальный эффект клика для всех стилей
      if (clickedNodeId === n.id && clickEffectTime > 0) {
        const baseRadius = n.r || pulseRadius;
        const clickRadius = baseRadius + (clickEffectTime * 40 * DPR);
        const easeOut = 1 - Math.pow(1 - clickEffectTime, 3);
        const clickAlpha = easeOut * 0.6;
        
        // Внешнее кольцо
        ctx.shadowColor = projectColor;
        ctx.shadowBlur = 30 * DPR;
        ctx.beginPath();
        ctx.strokeStyle = projectColor + Math.floor(clickAlpha * 255).toString(16).padStart(2, '0');
        ctx.lineWidth = 3 * DPR;
        ctx.arc(n.x, n.y, clickRadius, 0, Math.PI * 2);
        ctx.stroke();
        
        // Внутреннее кольцо
        const innerRadius = baseRadius + (clickEffectTime * 25 * DPR);
        const innerAlpha = easeOut * 0.4;
        ctx.beginPath();
        ctx.strokeStyle = projectColor + Math.floor(innerAlpha * 255).toString(16).padStart(2, '0');
        ctx.lineWidth = 2 * DPR;
        ctx.arc(n.x, n.y, innerRadius, 0, Math.PI * 2);
        ctx.stroke();
        
        ctx.shadowBlur = 0;
      }
      
      // Search highlight
      if (state.searchResults && state.searchResults.projects && state.searchResults.projects.includes(n.id)) {
        ctx.beginPath();
        ctx.strokeStyle = "#ffd700";
        ctx.lineWidth = 2 * DPR;
        ctx.arc(n.x, n.y, n.r + 8 * DPR, 0, Math.PI * 2);
        ctx.stroke();
      }
      
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
      if (hoverNodeId === n.id) {
        ctx.beginPath();
        ctx.strokeStyle = "#7fb3ff";
        ctx.lineWidth = 2 * DPR;
        ctx.arc(n.x, n.y, n.r + 22 * DPR, 0, Math.PI * 2);
        ctx.stroke();
      }
      
      // Project orbit ring
      ctx.beginPath();
      ctx.strokeStyle = "#1d2b4a";
      ctx.lineWidth = 1 * DPR;
      ctx.arc(n.x, n.y, n.r + 18 * DPR, 0, Math.PI * 2);
      ctx.stroke();
      
      // Project title
      ctx.fillStyle = "#cde1ff";
      ctx.font = `${12 * DPR}px system-ui`;
      ctx.textAlign = "center";
      ctx.fillText(n.title, n.x, n.y - (n.r + 28 * DPR));
      
      // Визуальные индикаторы блокировок для проектов
      const projectData = state.projects.find(p => p.id === n.id);
      if (projectData && projectData.locks) {
        // Иконка замка для блокировки перемещения
        if (projectData.locks.move) {
          ctx.fillStyle = "#ff6b6b";
          ctx.font = `${10 * DPR}px system-ui`;
          ctx.textAlign = "center";
          ctx.fillText("🔒", n.x + n.r - 10 * DPR, n.y - n.r + 15 * DPR);
        }
        
        // Иконка цепи для блокировки смены связей
        if (projectData.locks.hierarchy) {
          ctx.fillStyle = "#ffa500";
          ctx.font = `${10 * DPR}px system-ui`;
          ctx.textAlign = "center";
          ctx.fillText("⛓️", n.x + n.r - 10 * DPR, n.y - n.r + 30 * DPR);
        }
      }
    });

  // Enhanced drag feedback: improved visual indicators for all drag operations
  if (draggedNode) {
    try {
      // Draw dragged object with enhanced visibility
      ctx.save();
      ctx.globalAlpha = 0.8;
      ctx.shadowBlur = 12;
      ctx.shadowColor = '#ffffff';
      
      if (draggedNode._type === "task") {
        // Draw task with glow effect
        ctx.fillStyle = getTaskColor(draggedNode.status);
        ctx.beginPath();
        ctx.arc(draggedNode.x, draggedNode.y, draggedNode.r, 0, Math.PI * 2);
        ctx.fill();
        
        // Add pulsing border
        const time = performance.now() * 0.005;
        const pulse = 1 + Math.sin(time) * 0.2;
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 2 * pulse;
        ctx.beginPath();
        ctx.arc(draggedNode.x, draggedNode.y, draggedNode.r + 4, 0, Math.PI * 2);
        ctx.stroke();
      } else if (draggedNode._type === "project") {
        // Draw project with glow effect
        // Use project ID as seed for unique shape and project color
        const seed = draggedNode.id ? draggedNode.id.split('').reduce((a, b) => a + b.charCodeAt(0), 0) : 0;
        const project = byId(state.projects, draggedNode.id);
        const projectColor = getProjectColor(project) || "#7b68ee";
        
        // Choose visualization style based on settings
        if (projectVisualStyle === 'original') {
          // Улучшенная отрисовка перетаскиваемого проекта
          const dragRadius = 16 * DPR; // Немного больше при перетаскивании
          
          // Основной круг проекта (непрозрачный)
          ctx.beginPath();
          ctx.fillStyle = projectColor;
          ctx.arc(draggedNode.x, draggedNode.y, dragRadius, 0, Math.PI * 2);
          ctx.fill();
          
          // Обводка (тонкая, контрастная)
          ctx.beginPath();
          ctx.strokeStyle = getContrastColor(projectColor);
          ctx.lineWidth = 2 * DPR;
          ctx.arc(draggedNode.x, draggedNode.y, dragRadius, 0, Math.PI * 2);
          ctx.stroke();
          
          // Свечение при перетаскивании
          ctx.shadowColor = projectColor;
          ctx.shadowBlur = 20 * DPR;
          ctx.beginPath();
          ctx.fillStyle = projectColor + "80";
          ctx.arc(draggedNode.x, draggedNode.y, dragRadius + 5 * DPR, 0, Math.PI * 2);
          ctx.fill();
          ctx.shadowBlur = 0;
        } else if (projectVisualStyle === 'modern') {
          drawProjectModern(ctx, draggedNode.x, draggedNode.y, draggedNode.r, projectColor, seed);
        } else if (projectVisualStyle === 'simple') {
          drawProjectSimple(ctx, draggedNode.x, draggedNode.y, draggedNode.r, projectColor, seed);
        } else if (projectVisualStyle === 'planet') {
          drawPlanet(ctx, draggedNode.x, draggedNode.y, draggedNode.r, projectColor, 'planet');
        } else if (projectVisualStyle === 'neon') {
          drawNeonStyle(ctx, draggedNode.x, draggedNode.y, draggedNode.r, projectColor, 'project');
        } else if (projectVisualStyle === 'tech') {
          drawTechStyle(ctx, draggedNode.x, draggedNode.y, draggedNode.r, projectColor, 'project');
        } else if (projectVisualStyle === 'minimal') {
          drawMinimalStyle(ctx, draggedNode.x, draggedNode.y, draggedNode.r, projectColor, 'project');
        } else if (projectVisualStyle === 'holographic') {
          drawHolographicStyle(ctx, draggedNode.x, draggedNode.y, draggedNode.r, projectColor, 'project');
        } else if (projectVisualStyle === 'gradient') {
          drawGradientStyle(ctx, draggedNode.x, draggedNode.y, draggedNode.r, projectColor, 'project');
        } else if (projectVisualStyle === 'mixed') {
          drawMixedStyle(ctx, draggedNode.x, draggedNode.y, draggedNode.r, projectColor, 'project');
        } else {
          drawGalaxy(ctx, draggedNode.x, draggedNode.y, draggedNode.r, projectColor, seed);
        }
        
        // Add pulsing border
        const time = performance.now() * 0.005;
        const pulse = 1 + Math.sin(time) * 0.2;
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 3 * pulse;
        ctx.beginPath();
        ctx.arc(draggedNode.x, draggedNode.y, draggedNode.r + 6, 0, Math.PI * 2);
        ctx.stroke();
      }
      
      ctx.restore();
      
      // Draw connection line to drop target
      if (draggedNode._type === "task" && dropTargetProjectId) {
      const target = nodes.find(
        (n) => n._type === "project" && n.id === dropTargetProjectId
      );
      if (target) {
        ctx.beginPath();
        ctx.setLineDash([8 * DPR, 6 * DPR]);
          ctx.strokeStyle = "#00ff00"; // Green for valid drop
          ctx.lineWidth = 3 * DPR;
        ctx.moveTo(draggedNode.x, draggedNode.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
        ctx.setLineDash([]);
        }
      } else if (dropTargetDomainId) {
        const target = nodes.find(
          (n) => n._type === "domain" && n.id === dropTargetDomainId
        );
        if (target) {
          ctx.beginPath();
          ctx.setLineDash([8 * DPR, 6 * DPR]);
          ctx.strokeStyle = "#00ff00"; // Green for valid drop
          ctx.lineWidth = 3 * DPR;
          ctx.moveTo(draggedNode.x, draggedNode.y);
          ctx.lineTo(target.x, target.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    } catch (e) {}
  }

  // tasks as stars/asteroids
  const taskNodes = nodes.filter((n) => n._type === "task");
  
  // Отладка для Edge - показываем количество задач
  if (window.DEBUG_EDGE_TASKS) {
    console.log('=== ОТЛАДКА ЗАДАЧ ===');
    console.log(`Total tasks in state: ${state.tasks.length}`);
    console.log(`Task nodes created: ${taskNodes.length}`);
    console.log('State tasks:', state.tasks);
    console.log('Task nodes:', taskNodes);
    console.log('All nodes count:', nodes.length);
    console.log('Node types:', nodes.map(n => n._type));
    console.log('Viewport:', { vx0, vx1, vy0, vy1 });
    console.log('DPR:', DPR);
    
    // Проверяем, почему задачи не отображаются
    taskNodes.forEach((n, i) => {
      const inViewport = inView(n.x, n.y, n.r + 20 * DPR);
      console.log(`Task ${i}: ${n.id}, pos: (${n.x}, ${n.y}), r: ${n.r}, inView: ${inViewport}`);
    });
  }
  
  taskNodes.forEach((n) => {
      const __skipCull3 = window.DEBUG_EDGE_TASKS === true;
      if (!__skipCull3 && !inView(n.x, n.y, n.r + 20 * DPR)) return;
      const t = state.tasks.find((x) => x.id === n.id);
      
      // Отладка отрисовки задач в Edge
      if (window.DEBUG_EDGE_TASKS) {
        console.log(`🎨 РИСУЕМ ЗАДАЧУ: ${n.id}, pos: (${n.x}, ${n.y}), r: ${n.r}, status: ${n.status}`);
      }
      
      // Task colors based on status
      const taskColors = {
        "done": "#6b7280",
        "today": "#ffd166", 
        "doing": "#60a5fa",
        "backlog": "#9ca3af"
      };
      const baseColor = taskColors[n.status] || taskColors["backlog"];
      
      // Draw task with style support
      if (projectVisualStyle === 'original') {
        // Enhanced task drawing with better visual appeal
        const isHovered = hoverNodeId === n.id;
        const isClicked = clickedNodeId === n.id;
        
        // Aging ring (if enabled)
        if (state.showAging) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, n.r + 3 * DPR, 0, Math.PI * 2);
          ctx.strokeStyle = colorByAging(n.aging);
          ctx.lineWidth = 2 * DPR;
          ctx.stroke();
        }
        
        // Main task circle with gradient
        const gradient = ctx.createRadialGradient(n.x - n.r/2, n.y - n.r/2, 0, n.x, n.y, n.r);
        gradient.addColorStop(0, baseColor + "FF");
        gradient.addColorStop(0.3, baseColor + "DD");
        gradient.addColorStop(0.7, baseColor + "AA");
        gradient.addColorStop(1, baseColor + "77");
        
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        
        // Glow effect
        if (state.showGlow && allowGlow) {
          ctx.shadowColor = baseColor;
          ctx.shadowBlur = 12 * DPR;
        } else {
          ctx.shadowBlur = 0;
        }
        
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.shadowBlur = 0;
        
        // Inner highlight for 3D effect
        const innerGradient = ctx.createRadialGradient(n.x - n.r/3, n.y - n.r/3, 0, n.x, n.y, n.r * 0.6);
        innerGradient.addColorStop(0, "#ffffff40");
        innerGradient.addColorStop(1, "#00000000");
        
        ctx.beginPath();
        ctx.fillStyle = innerGradient;
        ctx.arc(n.x, n.y, n.r * 0.6, 0, Math.PI * 2);
        ctx.fill();
        
        // Border with contrast color
        ctx.beginPath();
        ctx.strokeStyle = getContrastColor(baseColor);
        ctx.lineWidth = 1.5 * DPR;
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.stroke();
        
        // Outer glow for depth
        ctx.beginPath();
        ctx.strokeStyle = baseColor + "30";
        ctx.lineWidth = 3 * DPR;
        ctx.arc(n.x, n.y, n.r + 1 * DPR, 0, Math.PI * 2);
        ctx.stroke();
        
        // Status-specific styling
        if (n.status === "today") {
          // Yellow ring for "today" tasks
          ctx.beginPath();
          ctx.strokeStyle = "#f59e0b";
          ctx.lineWidth = 2 * DPR;
          ctx.arc(n.x, n.y, n.r + 4 * DPR, 0, Math.PI * 2);
          ctx.stroke();
        } else if (n.status === "doing") {
          // Pulsing effect for "doing" tasks
          const pulse = Math.sin(Date.now() * 0.003) * 0.1 + 1;
          ctx.beginPath();
          ctx.strokeStyle = baseColor + "80";
          ctx.lineWidth = 2 * DPR;
          ctx.arc(n.x, n.y, n.r + 2 * DPR * pulse, 0, Math.PI * 2);
          ctx.stroke();
        }
        
        // Hover effect
        if (isHovered) {
          ctx.beginPath();
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2 * DPR;
          ctx.arc(n.x, n.y, n.r + 6 * DPR, 0, Math.PI * 2);
          ctx.stroke();
        }
        
        // Click effect will be drawn after all other layers
        
      } else if (projectVisualStyle === 'neon') {
        drawNeonStyle(ctx, n.x, n.y, n.r, baseColor, 'task');
      } else if (projectVisualStyle === 'tech') {
        drawTechStyle(ctx, n.x, n.y, n.r, baseColor, 'task');
      } else if (projectVisualStyle === 'minimal') {
        drawMinimalStyle(ctx, n.x, n.y, n.r, baseColor, 'task');
      } else if (projectVisualStyle === 'holographic') {
        drawHolographicStyle(ctx, n.x, n.y, n.r, baseColor, 'task');
      } else if (projectVisualStyle === 'gradient') {
        drawGradientStyle(ctx, n.x, n.y, n.r, baseColor, 'task');
      } else if (projectVisualStyle === 'mixed') {
        drawMixedStyle(ctx, n.x, n.y, n.r, baseColor, 'task');
      } else {
        // Enhanced task rendering with advanced effects
        const isHovered = hoverNodeId === n.id;
        const isClicked = clickedNodeId === n.id;
        const time = performance.now() * 0.002;
        
        // Dynamic pulsing effect for active tasks
        const pulseIntensity = n.status === 'doing' ? 1 + Math.sin(time * 2) * 0.15 : 1;
        const pulseRadius = n.r * pulseIntensity;
        
        // Enhanced gradient with multiple color stops
        const gradient = ctx.createRadialGradient(n.x - n.r/2, n.y - n.r/2, 0, n.x, n.y, pulseRadius);
        gradient.addColorStop(0, baseColor + "FF");
        gradient.addColorStop(0.2, baseColor + "EE");
        gradient.addColorStop(0.4, baseColor + "CC");
        gradient.addColorStop(0.7, baseColor + "99");
        gradient.addColorStop(1, baseColor + "66");
        
        // Outer energy ring for active tasks
        if (n.status === 'doing' || n.status === 'today') {
          ctx.shadowColor = baseColor;
          ctx.shadowBlur = 8 * DPR * pulseIntensity;
          ctx.strokeStyle = baseColor + "60";
          ctx.lineWidth = 2 * DPR;
          ctx.beginPath();
          ctx.arc(n.x, n.y, pulseRadius + 4 * DPR, 0, Math.PI * 2);
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
        
        // Main task circle with enhanced gradient
        ctx.beginPath();
        ctx.arc(n.x, n.y, pulseRadius, 0, Math.PI * 2);
        
        if (state.showGlow && allowGlow) {
          ctx.shadowColor = baseColor;
          ctx.shadowBlur = 15 * DPR * pulseIntensity;
        } else {
          ctx.shadowBlur = 0;
        }
        
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.shadowBlur = 0;
        
        // Enhanced inner highlight with multiple layers
        const innerGradient = ctx.createRadialGradient(n.x - n.r/3, n.y - n.r/3, 0, n.x, n.y, n.r * 0.7);
        innerGradient.addColorStop(0, "#ffffff60");
        innerGradient.addColorStop(0.3, "#ffffff30");
        innerGradient.addColorStop(0.7, "#ffffff10");
        innerGradient.addColorStop(1, "#00000000");
        
        ctx.beginPath();
        ctx.fillStyle = innerGradient;
        ctx.arc(n.x, n.y, n.r * 0.7, 0, Math.PI * 2);
        ctx.fill();
        
        // Secondary inner highlight for more depth
        const innerGradient2 = ctx.createRadialGradient(n.x - n.r/4, n.y - n.r/4, 0, n.x, n.y, n.r * 0.4);
        innerGradient2.addColorStop(0, "#ffffff80");
        innerGradient2.addColorStop(1, "#00000000");
        
        ctx.beginPath();
        ctx.fillStyle = innerGradient2;
        ctx.arc(n.x, n.y, n.r * 0.4, 0, Math.PI * 2);
        ctx.fill();
        
        // Enhanced border with gradient
        const borderGradient = ctx.createLinearGradient(n.x - n.r, n.y, n.x + n.r, n.y);
        borderGradient.addColorStop(0, getContrastColor(baseColor) + "CC");
        borderGradient.addColorStop(0.5, getContrastColor(baseColor) + "FF");
        borderGradient.addColorStop(1, getContrastColor(baseColor) + "CC");
        
        ctx.beginPath();
        ctx.strokeStyle = borderGradient;
        ctx.lineWidth = 2 * DPR;
        ctx.arc(n.x, n.y, pulseRadius, 0, Math.PI * 2);
        ctx.stroke();
        
        // Outer glow with multiple rings
        ctx.beginPath();
        ctx.strokeStyle = baseColor + "40";
        ctx.lineWidth = 4 * DPR;
        ctx.arc(n.x, n.y, pulseRadius + 2 * DPR, 0, Math.PI * 2);
        ctx.stroke();
        
        ctx.beginPath();
        ctx.strokeStyle = baseColor + "20";
        ctx.lineWidth = 6 * DPR;
        ctx.arc(n.x, n.y, pulseRadius + 4 * DPR, 0, Math.PI * 2);
        ctx.stroke();
        
        // Status-specific effects
        if (n.status === 'today') {
          // Today tasks get a golden ring
          ctx.beginPath();
          ctx.strokeStyle = "#f59e0b";
          ctx.lineWidth = 2 * DPR;
          ctx.arc(n.x, n.y, pulseRadius + 6 * DPR, 0, Math.PI * 2);
          ctx.stroke();
        } else if (n.status === 'done') {
          // Done tasks get a subtle checkmark effect
          ctx.strokeStyle = "#10b981";
          ctx.lineWidth = 2 * DPR;
          ctx.beginPath();
          ctx.moveTo(n.x - n.r * 0.3, n.y);
          ctx.lineTo(n.x - n.r * 0.1, n.y + n.r * 0.2);
          ctx.lineTo(n.x + n.r * 0.3, n.y - n.r * 0.2);
          ctx.stroke();
        }
        
        // Status-specific styling
        if (n.status === "today") {
          ctx.beginPath();
          ctx.strokeStyle = "#f59e0b";
          ctx.lineWidth = 2 * DPR;
          ctx.arc(n.x, n.y, n.r + 4 * DPR, 0, Math.PI * 2);
          ctx.stroke();
        } else if (n.status === "doing") {
          const pulse = Math.sin(Date.now() * 0.003) * 0.1 + 1;
          ctx.beginPath();
          ctx.strokeStyle = baseColor + "80";
          ctx.lineWidth = 2 * DPR;
          ctx.arc(n.x, n.y, n.r + 2 * DPR * pulse, 0, Math.PI * 2);
          ctx.stroke();
        }
        
        // Hover effect
        if (isHovered) {
          ctx.beginPath();
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2 * DPR;
          ctx.arc(n.x, n.y, n.r + 6 * DPR, 0, Math.PI * 2);
          ctx.stroke();
        }
        
        // Click effect will be drawn after all other layers
      }
      
      // Search highlight
      if (state.searchResults && state.searchResults.tasks && state.searchResults.tasks.includes(n.id)) {
        ctx.beginPath();
        ctx.strokeStyle = "#ffd700";
        ctx.lineWidth = 2 * DPR;
        ctx.arc(n.x, n.y, n.r + 8 * DPR, 0, Math.PI * 2);
        ctx.stroke();
      }
      
      // Aging ring
      if (state.showAging) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 3 * DPR, 0, Math.PI * 2);
        ctx.strokeStyle = colorByAging(n.aging);
        ctx.lineWidth = 2 * DPR;
        ctx.stroke();
      }
      
      // Click effect (dynamic highlight) - drawn on top of everything
      const isClicked = clickedNodeId === n.id;
      if (isClicked && clickEffectTime > 0) {
        console.log("Task click effect:", n.id, clickEffectTime);
        const clickRadius = n.r + (clickEffectTime * 40 * DPR);
        const starRadius = n.r + (clickEffectTime * 60 * DPR);
        const clickAlpha = Math.max(0, clickEffectTime * 0.8);
        
        // Star effect - multiple lines radiating outward
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2 * DPR;
        for (let i = 0; i < 8; i++) {
          const angle = (i / 8) * Math.PI * 2;
          const startX = n.x + Math.cos(angle) * (n.r + 5 * DPR);
          const startY = n.y + Math.sin(angle) * (n.r + 5 * DPR);
          const endX = n.x + Math.cos(angle) * starRadius;
          const endY = n.y + Math.sin(angle) * starRadius;
          
          ctx.beginPath();
          ctx.moveTo(startX, startY);
          ctx.lineTo(endX, endY);
          ctx.stroke();
        }
        
        // Pulsing outer ring
        ctx.beginPath();
        ctx.strokeStyle = baseColor + Math.floor(clickAlpha * 255).toString(16).padStart(2, '0');
        ctx.lineWidth = 4 * DPR;
        ctx.arc(n.x, n.y, clickRadius, 0, Math.PI * 2);
        ctx.stroke();
        
        // Bright inner ring
        ctx.beginPath();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 3 * DPR;
        ctx.arc(n.x, n.y, n.r + 8 * DPR, 0, Math.PI * 2);
        ctx.stroke();
      }
      
      // Today highlight
      if (n.status === "today") {
        ctx.beginPath();
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = 1 * DPR;
        ctx.arc(n.x, n.y, n.r + 6 * DPR, 0, Math.PI * 2);
        ctx.stroke();
      }
      
      // Отладка завершения отрисовки задачи в Edge
      if (window.DEBUG_EDGE_TASKS) {
        console.log(`✅ ЗАДАЧА ОТРИСОВАНА: ${n.id}, color: ${baseColor}, style: ${projectVisualStyle}`);
      }
    });

  // Иконки чек-листа убраны - они не нужны

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

  // Рисуем идеи
  nodes
    .filter((n) => n._type === "idea")
    .forEach((n) => {
      if (!inView(n.x, n.y, n.r + 20 * DPR)) return;
      
      // Рисуем идею как полупрозрачный круг
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = (n.color || "#8b5cf6") + "80"; // 50% прозрачности
      ctx.fill();
      
      // Обводка
      ctx.beginPath();
      ctx.strokeStyle = n.color || "#8b5cf6";
      ctx.lineWidth = 2 * DPR;
      ctx.setLineDash([4 * DPR, 4 * DPR]);
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      
      // Название идеи
      ctx.fillStyle = "#e0e7ff";
      ctx.font = `${10 * DPR}px system-ui`;
      ctx.textAlign = "center";
      ctx.fillText(n.title, n.x, n.y - n.r - 8 * DPR);
    });

  // Заметки теперь рисуются в функции drawNotes() - удален дублирующий код

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
  
  // Reset drawing flag
  isDrawing = false;
  
  // Продолжаем анимацию эффекта клика
  if (clickEffectTime > 0) {
    requestDraw();
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
        : n._type === "idea"
        ? n.r + 15 * DPR
        : n._type === "note"
        ? n.r + 8 * DPR
        : n._type === "checklist"
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
        : n._type === "idea"
        ? n.r + 15 * DPR
        : n._type === "note"
        ? n.r + 8 * DPR
        : n._type === "checklist"
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
  
  // Любые действия только если ЛКМ реально зажата
  if (!(e.buttons & 1)) {
    // если кнопку «потеряли» (вышли из окна и т.п.) — корректно завершить
    onMouseUp(e);
    return;
  }

  if (mouse.phase === 'idle') return; // без нажатия — никаких движений

  const sx = e.clientX, sy = e.clientY;

  // PRESS: ждём превышения порога, чтобы решить, что именно делать
  if (mouse.phase === 'press') {
    const moved2 = distance2(mouse.startX, mouse.startY, sx, sy);
    console.log('🖱️ Mouse moved2:', moved2, 'threshold2:', mouse.threshold * mouse.threshold);
    
    if (moved2 >= mouse.threshold * mouse.threshold) {
      // превысили порог — выбираем режим
      const { x: wx, y: wy } = screenToWorld(mouse.startX, mouse.startY);

      if (mouse.target) {
        // стартуем drag объекта — фиксируем смещение хвата
        mouse.phase = 'drag-object';
        // предполагаем у объекта поля x,y (мировые координаты центра/якоря)
        mouse.dragOffsetX = wx - mouse.target.x;
        mouse.dragOffsetY = wy - mouse.target.y;
        setCursor('grabbing');
        console.log('🖱️ Phase: drag-object, offset:', mouse.dragOffsetX, mouse.dragOffsetY);
      } else {
        // стартуем панорамирование
        mouse.phase = 'pan';
        setCursor('grabbing');
        console.log('🖱️ Phase: pan');
      }
    }
    mouse.lastX = sx; mouse.lastY = sy;
    return;
  }

  // DRAG-OBJECT: двигаем объект в мировых координатах,
  // используя текущее положение курсора минус зафиксированный оффсет.
  if (mouse.phase === 'drag-object') {
    const { x: wx, y: wy } = screenToWorld(sx, sy);
    // перемещаем объект без «дрожи»
    mouse.target.x = wx - mouse.dragOffsetX;
    mouse.target.y = wy - mouse.dragOffsetY;
    mouse.lastX = sx; mouse.lastY = sy;
    requestDraw();
    return;
  }

  // PAN: двигаем камеру относительно последнего положения мыши.
  if (mouse.phase === 'pan') {
    const dxScreen = sx - mouse.lastX;
    const dyScreen = sy - mouse.lastY;
    if (dxScreen !== 0 || dyScreen !== 0) {
      const dpr = window.devicePixelRatio || 1;
      viewState.tx += (dxScreen * dpr) / viewState.scale;
      viewState.ty += (dyScreen * dpr) / viewState.scale;
      mouse.lastX = sx; mouse.lastY = sy;
      requestDraw();
      console.log('🖱️ Panning delta:', dxScreen, dyScreen);
    }
    return;
  }
  
  // Legacy panning (middle button)
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
  if (pendingDragNode && pendingDragNode.x !== undefined && pendingDragNode.y !== undefined) {
    const dx = e.clientX - pendingDragStart.x;
    const dy = e.clientY - pendingDragStart.y;
    const dist = Math.hypot(dx, dy);
    const threshold = 5; // px
    if (dist >= threshold) {
      // Cancel click timer and start drag
      cancelClickTimer();
      
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
      
      // Add visual feedback for drag start
      canvas.style.filter = "brightness(1.05)";
      canvas.style.transition = "filter 0.2s ease";
    }
  }
  if (draggedNode) {
    const pt = screenToWorld(e.offsetX, e.offsetY);
    draggedNode.x = pt.x - dragOffset.x;
    draggedNode.y = pt.y - dragOffset.y;
    
    // Enhanced drop target detection with better visual feedback
    dropTargetProjectId = null;
    dropTargetDomainId = null;
    const hitNode = hitExcluding(pt.x, pt.y, draggedNode.id);
    
    // More precise domain detection for tasks and projects
    let targetDomain = null;
    for (const domain of state.domains) {
      const dNode = nodes.find(n => n._type === 'domain' && n.id === domain.id);
      if (dNode) {
        const dx = pt.x - dNode.x;
        const dy = pt.y - dNode.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= dNode.r) {
          targetDomain = domain;
          break;
        }
      }
    }
    
    if (hitNode) {
      if (draggedNode._type === "task" && hitNode._type === "project") {
        dropTargetProjectId = hitNode.id;
        canvas.style.cursor = "copy"; // Visual feedback for valid drop
      } else if (targetDomain) {
        // Use precise domain detection instead of hitNode
        dropTargetDomainId = targetDomain.id;
        canvas.style.cursor = "copy"; // Visual feedback for valid drop
      } else {
        canvas.style.cursor = "not-allowed"; // Visual feedback for invalid drop
      }
    } else {
      // Check if we're over empty space (for independent tasks)
      if (draggedNode._type === "task") {
        canvas.style.cursor = "move"; // Visual feedback for independent placement
      } else {
        canvas.style.cursor = "grabbing"; // Default drag cursor
      }
    }
    
    requestDraw();
    return;
  }
  const pt = screenToWorld(e.offsetX, e.offsetY);
  const n = hit(pt.x, pt.y);
  if (!n) {
    hoverNodeId = null;
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
  } else {
    const d = state.domains.find((x) => x.id === n.id);
    const mood = n.mood || 'balance';
    const moodDescription = n.moodDescription || 'Баланс: стабильное состояние';
    tooltip.innerHTML = `🌌 Домен: <b>${d.title}</b><br/><span class="hint">${moodDescription}</span>`;
  }
  requestDraw();
}

function onMouseLeave() {
  pendingDragNode = null;
  if (draggedNode) {
    draggedNode = null;
    canvas.style.cursor = "";
    
    // Reset visual effects
    canvas.style.filter = "";
    canvas.style.transition = "";
  }
  dropTargetProjectId = null;
  dropTargetDomainId = null;
  drawMap();
}

function onMouseUp(e) {
  // Разрешаем вызывать повторно (если уже idle — просто выходим)
  if (mouse.phase === 'idle') return;

  const sx = e.clientX, sy = e.clientY;

  if (mouse.phase === 'press') {
    // Порог не превышен — это КЛИК
    const { x: wx, y: wy } = screenToWorld(sx, sy);
    const clicked = hit(wx, wy);
    // Селектим объект (или снимаем выделение)
    selectObject(clicked || null);
    setCursor('default');
    console.log('🖱️ Click processed');
  } else if (mouse.phase === 'drag-object') {
    // Завершили перетаскивание
    commitObjectPosition(mouse.target);
    setCursor('default');
    console.log('🖱️ Object drag completed');
  } else if (mouse.phase === 'pan') {
    // Завершили панорамирование
    setCursor('default');
    console.log('🖱️ Panning completed');
  }

  // Сброс состояния
  mouse.phase = 'idle';
  mouse.target = null;
  mouse.dragOffsetX = 0;
  mouse.dragOffsetY = 0;
  
  console.log('🖱️ Mouse state reset to idle');
}

function onMouseDown(e) {
  // Disabled: navigation uses pointer events; prevent legacy mouse drag path
    return;
  if (e.button !== 0) return;                 // только ЛКМ
  if (e.buttons !== 1) return;                // только ЛКМ зажата
  e.preventDefault();

  const sx = e.clientX, sy = e.clientY;
  mouse.startX = mouse.lastX = sx;
  mouse.startY = mouse.lastY = sy;

  const { x: wx, y: wy } = screenToWorld(e.offsetX, e.offsetY);
  mouse.target = hit(wx, wy);

  mouse.phase = 'press';
  setCursor(mouse.target ? 'grab' : 'grab');  // визуальная подсказка одинаковая на press
  
  console.log('🖱️ Mouse down, phase: press, target:', mouse.target ? `${mouse.target._type}:${mouse.target.id}` : 'none');
}
// Helper function to properly hide toast and clean up handlers
function hideToast() {
  const toast = document.getElementById("toast");
  if (toast) {
    // Clear all event handlers
    const buttons = toast.querySelectorAll("button");
    buttons.forEach(btn => {
      btn.onclick = null;
    });
    
    // Hide toast
    toast.className = "toast";
    toast.style.display = "none";
    toast.innerHTML = "";
    
    // Clear modal flag
    isModalOpen = false;
  }
}

// New pointer event handlers with robust navigation model
function onPointerDown(e) {
  try { e.preventDefault(); } catch(_) {}
  if (isModalOpen) return;
  if (e.button === 2) return; // context menu handled separately
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const worldPos = screenToWorld(x, y);
  const hitNode = hit(worldPos.x, worldPos.y);
  NAV.mode = 'pending';
  NAV.downCX = NAV.lastCX = e.clientX;
  NAV.downCY = NAV.lastCY = e.clientY;
  NAV.downTime = performance.now();
  NAV.pointerId = e.pointerId;
  NAV.hitNode = hitNode || null;
  NAV.dragOffset = hitNode ? { x: worldPos.x - hitNode.x, y: worldPos.y - hitNode.y } : { x: 0, y: 0 };
  try { canvas.setPointerCapture(e.pointerId); } catch(_) {}
  if (window.DEBUG_MOUSE) {
    console.log('[NAV] down pending; hit:', hitNode? hitNode._type+':'+hitNode.id : 'none');
  }
}

function onPointerMove(e) {
  try { e.preventDefault(); } catch(_) {}
  if (isModalOpen) return;
  
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const worldPos = screenToWorld(x, y);
  
  // Обработка наведения на чек-листы - ВСЕГДА вызываем
  handleChecklistHover(x, y, worldPos);
  
  if (NAV.mode === 'idle') return;
  const moved = Math.hypot(e.clientX - NAV.downCX, e.clientY - NAV.downCY);
  if (NAV.mode === 'pending') {
    if (moved > MOVE_SLOP) {
      // Start object drag ONLY with Alt pressed; otherwise pan
      if (NAV.hitNode && e.altKey) {
        // Проверяем блокировку перемещения
        if (!canMoveObject(NAV.hitNode)) {
          console.log('🚫 Объект заблокирован для перемещения:', NAV.hitNode._type, NAV.hitNode.id);
          showToast('Объект заблокирован для перемещения', 'warn');
          startPan(); // Переключаемся на панорамирование
          if (window.DEBUG_MOUSE) console.log('[NAV] blocked drag, switching to pan');
        } else {
          NAV.mode = 'drag';
          draggedNode = NAV.hitNode;
          dragOffset = { x: NAV.dragOffset.x, y: NAV.dragOffset.y };
          canvas.style.cursor = 'grabbing';
          if (window.DEBUG_MOUSE) console.log('[NAV] start drag (alt+move)');
        }
      } else {
        // По умолчанию - панорамирование (даже если есть объект под курсором)
        startPan();
        if (window.DEBUG_MOUSE) console.log('[NAV] start pan (default behavior)');
      }
    }
      return;
    }
  if (NAV.mode === 'pan') {
    updatePan(e);
    if (window.DEBUG_MOUSE) console.log('[NAV] pan move');
    return;
  }
  if (NAV.mode === 'drag' && draggedNode) {
    draggedNode.x = worldPos.x - dragOffset.x;
    draggedNode.y = worldPos.y - dragOffset.y;
    requestDraw();
    if (window.DEBUG_MOUSE) console.log('[NAV] drag move');
    return;
  }
}

// Простая система для чек-листов - курсор + быстрый просмотр
let currentHoveredChecklist = null;
let quickViewTimer = null;

function handleChecklistHover(screenX, screenY, worldPos) {
  if (!state.checklists || state.checklists.length === 0) {
    return;
  }

  // Ищем чек-лист под курсором
  let found = null;
  for (const checklist of state.checklists) {
    const distance = Math.hypot(worldPos.x - checklist.x, worldPos.y - checklist.y);
    if (distance <= checklist.r + 20) {
      found = checklist;
      break;
    }
  }
  
  // Если нашли чек-лист
  if (found) {
    canvas.style.cursor = 'pointer';
    
    // Если это новый чек-лист
    if (currentHoveredChecklist !== found) {
      // Очищаем предыдущий таймер
      if (quickViewTimer) {
        clearTimeout(quickViewTimer);
      }
      
      currentHoveredChecklist = found;
      
      // Показываем быстрый просмотр через 1 секунду
      quickViewTimer = setTimeout(() => {
        if (currentHoveredChecklist === found) {
          showQuickChecklistView(found, screenX, screenY);
        }
      }, 1000);
    }
  } else {
    // Если убрали курсор
    if (currentHoveredChecklist) {
      canvas.style.cursor = 'grab';
      currentHoveredChecklist = null;
      
      // Очищаем таймер
      if (quickViewTimer) {
        clearTimeout(quickViewTimer);
        quickViewTimer = null;
      }
      
      // Скрываем быстрый просмотр
      hideQuickChecklistView();
    }
  }
}

// Простой быстрый просмотр чек-листа
function showQuickChecklistView(checklist, screenX, screenY) {
  // Создаем простой div для быстрого просмотра
  let quickView = document.getElementById('quickChecklistView');
  if (!quickView) {
    quickView = document.createElement('div');
    quickView.id = 'quickChecklistView';
    quickView.style.cssText = `
      position: fixed;
      background: rgba(0, 0, 0, 0.9);
      color: white;
      padding: 12px;
      border-radius: 8px;
      font-size: 14px;
      max-width: 300px;
      z-index: 1000;
      pointer-events: none;
      font-family: system-ui, -apple-system, sans-serif;
    `;
    document.body.appendChild(quickView);
  }
  
  // Заполняем содержимое
  const progress = getChecklistProgress(checklist.id);
  const itemsText = checklist.items && checklist.items.length > 0 
    ? checklist.items.slice(0, 3).map(item => `${item.completed ? '✓' : '○'} ${item.text}`).join('\n')
    : 'Нет элементов';
  
  quickView.innerHTML = `
    <div style="font-weight: bold; margin-bottom: 8px;">${checklist.title}</div>
    <div style="color: #60a5fa; margin-bottom: 8px;">Прогресс: ${progress}%</div>
    <div style="white-space: pre-line; font-size: 12px;">${itemsText}</div>
    <div style="margin-top: 8px; font-size: 11px; color: #9ca3af;">Левый клик - редактировать</div>
  `;
  
  // Позиционируем рядом с курсором
  quickView.style.left = `${screenX + 20}px`;
  quickView.style.top = `${screenY - 10}px`;
  quickView.style.display = 'block';
}

function hideQuickChecklistView() {
  const quickView = document.getElementById('quickChecklistView');
  if (quickView) {
    quickView.style.display = 'none';
  }
}

// Полноценное окно чек-листа с вкладками
function showChecklistToggleView(checklist, screenX, screenY) {
  // Создаем полноценное окно
  let toggleView = document.getElementById('checklistToggleView');
  if (!toggleView) {
    toggleView = document.createElement('div');
    toggleView.id = 'checklistToggleView';
    toggleView.style.cssText = `
      position: fixed;
      background: rgba(15, 15, 15, 0.98);
      color: white;
      border-radius: 16px;
      font-size: 14px;
      width: 450px;
      max-height: 600px;
      z-index: 1001;
      font-family: system-ui, -apple-system, sans-serif;
      border: 2px solid #3b82f6;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(10px);
    `;
    document.body.appendChild(toggleView);
  }
  
  // Заполняем содержимое
  const progress = getChecklistProgress(checklist.id);
  const completedItems = checklist.items ? checklist.items.filter(item => item.completed) : [];
  const pendingItems = checklist.items ? checklist.items.filter(item => !item.completed) : [];
  
  toggleView.innerHTML = `
    <div style="padding: 20px;">
      <!-- Заголовок -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <div>
          <div style="font-weight: bold; font-size: 18px; margin-bottom: 4px;">${checklist.title}</div>
          <div style="color: #60a5fa; font-size: 13px;">Прогресс: ${progress}% (${completedItems.length}/${checklist.items?.length || 0})</div>
        </div>
        <button onclick="hideChecklistToggleView()" style="background: none; border: none; color: #9ca3af; cursor: pointer; font-size: 20px; padding: 4px;">×</button>
      </div>
      
      <!-- Вкладки -->
      <div style="display: flex; margin-bottom: 16px; border-bottom: 1px solid #374151;">
        <button id="tab-pending" onclick="switchChecklistTab('pending')" 
                style="flex: 1; background: #3b82f6; color: white; border: none; padding: 12px; cursor: pointer; font-size: 14px; border-radius: 8px 8px 0 0; font-weight: 500;">
          📋 Невыполненные (${pendingItems.length})
        </button>
        <button id="tab-completed" onclick="switchChecklistTab('completed')" 
                style="flex: 1; background: #374151; color: #9ca3af; border: none; padding: 12px; cursor: pointer; font-size: 14px; border-radius: 8px 8px 0 0; font-weight: 500;">
          ✅ Выполненные (${completedItems.length})
        </button>
      </div>
      
      <!-- Содержимое вкладок -->
      <div id="tab-content" style="max-height: 400px; overflow-y: auto;">
        ${renderChecklistTabContent('pending', pendingItems, checklist.id)}
      </div>
      
      <!-- Кнопки действий -->
      <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #374151; display: flex; gap: 12px;">
        <button onclick="window.showChecklistEditor(state.checklists.find(c => c.id === '${checklist.id}'))" 
                style="flex: 1; background: #3b82f6; color: white; border: none; padding: 12px; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 500;">
          ✏️ Редактировать
        </button>
        <button onclick="hideChecklistToggleView()" 
                style="flex: 1; background: #6b7280; color: white; border: none; padding: 12px; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 500;">
          Закрыть
        </button>
      </div>
    </div>
  `;
  
  // Позиционируем по центру экрана
  const centerX = (window.innerWidth - 450) / 2;
  const centerY = (window.innerHeight - 600) / 2;
  toggleView.style.left = `${Math.max(20, centerX)}px`;
  toggleView.style.top = `${Math.max(20, centerY)}px`;
  toggleView.style.display = 'block';
  
  // Сохраняем данные для переключения вкладок
  window.currentChecklistData = {
    checklist: checklist,
    pendingItems: pendingItems,
    completedItems: completedItems
  };
}

function hideChecklistToggleView() {
  const toggleView = document.getElementById('checklistToggleView');
  if (toggleView) {
    toggleView.style.display = 'none';
  }
  // Очищаем данные
  window.currentChecklistData = null;
}

// Рендеринг содержимого вкладки
function renderChecklistTabContent(tabType, items, checklistId) {
  if (!items || items.length === 0) {
    return `
      <div style="text-align: center; color: #9ca3af; font-style: italic; padding: 40px 20px;">
        ${tabType === 'pending' ? 'Нет невыполненных задач' : 'Нет выполненных задач'}
      </div>
    `;
  }
  
  return items.map(item => `
    <div style="display: flex; align-items: center; margin: 12px 0; padding: 12px; background: rgba(255,255,255,0.05); border-radius: 8px; transition: all 0.2s;" 
         onmouseover="this.style.background='rgba(255,255,255,0.1)'" 
         onmouseout="this.style.background='rgba(255,255,255,0.05)'">
      <input type="checkbox" ${item.completed ? 'checked' : ''} 
             style="margin-right: 12px; transform: scale(1.3); cursor: pointer;" 
             onchange="toggleChecklistItemFromView('${checklistId}', '${item.id}')">
      <span style="flex: 1; font-size: 15px; line-height: 1.4; ${item.completed ? 'text-decoration: line-through; opacity: 0.6; color: #9ca3af;' : ''}">${escapeChecklistHtml(item.text)}</span>
    </div>
  `).join('');
}

// Переключение вкладок
function switchChecklistTab(tabType) {
  if (!window.currentChecklistData) return;
  
  const { checklist, pendingItems, completedItems } = window.currentChecklistData;
  const tabContent = document.getElementById('tab-content');
  const tabPending = document.getElementById('tab-pending');
  const tabCompleted = document.getElementById('tab-completed');
  
  if (!tabContent || !tabPending || !tabCompleted) return;
  
  // Обновляем активную вкладку
  if (tabType === 'pending') {
    tabPending.style.background = '#3b82f6';
    tabPending.style.color = 'white';
    tabCompleted.style.background = '#374151';
    tabCompleted.style.color = '#9ca3af';
    tabContent.innerHTML = renderChecklistTabContent('pending', pendingItems, checklist.id);
  } else {
    tabPending.style.background = '#374151';
    tabPending.style.color = '#9ca3af';
    tabCompleted.style.background = '#3b82f6';
    tabCompleted.style.color = 'white';
    tabContent.innerHTML = renderChecklistTabContent('completed', completedItems, checklist.id);
  }
}

// Функция для переключения элементов из просмотра
function toggleChecklistItemFromView(checklistId, itemId) {
  const completed = toggleChecklistItem(checklistId, itemId);
  
  // Обновляем данные
  if (window.currentChecklistData) {
    const { checklist } = window.currentChecklistData;
    const item = checklist.items.find(i => i.id === itemId);
    if (item) {
      item.completed = completed;
    }
    
    // Пересчитываем списки
    window.currentChecklistData.pendingItems = checklist.items.filter(item => !item.completed);
    window.currentChecklistData.completedItems = checklist.items.filter(item => item.completed);
    
    // Обновляем заголовок с прогрессом
    const progress = getChecklistProgress(checklistId);
    const progressEl = document.querySelector('#checklistToggleView div[style*="color: #60a5fa"]');
    if (progressEl) {
      progressEl.textContent = `Прогресс: ${progress}% (${window.currentChecklistData.completedItems.length}/${checklist.items.length})`;
    }
    
    // Обновляем счетчики вкладок
    const tabPending = document.getElementById('tab-pending');
    const tabCompleted = document.getElementById('tab-completed');
    if (tabPending) {
      tabPending.textContent = `📋 Невыполненные (${window.currentChecklistData.pendingItems.length})`;
    }
    if (tabCompleted) {
      tabCompleted.textContent = `✅ Выполненные (${window.currentChecklistData.completedItems.length})`;
    }
    
    // Обновляем содержимое активной вкладки
    const tabContent = document.getElementById('tab-content');
    const activeTab = document.querySelector('#checklistToggleView button[style*="background: #3b82f6"]');
    if (tabContent && activeTab) {
      const isPendingActive = activeTab.id === 'tab-pending';
      const items = isPendingActive ? window.currentChecklistData.pendingItems : window.currentChecklistData.completedItems;
      tabContent.innerHTML = renderChecklistTabContent(isPendingActive ? 'pending' : 'completed', items, checklistId);
    }
  }
  
  // Сохраняем и обновляем карту
  try {
    saveState();
  } catch (_) {}
  if (window.drawMap) window.drawMap();
}

function onPointerUp(e) {
  try { e.preventDefault(); } catch(_) {}
  if (isModalOpen) return;
  try { canvas.releasePointerCapture(e.pointerId); } catch(_) {}
  const elapsed = performance.now() - NAV.downTime;
  const moved = Math.hypot(e.clientX - NAV.downCX, e.clientY - NAV.downCY);
  if (NAV.mode === 'drag' && draggedNode) {
    handleDrop();
    if (window.DEBUG_MOUSE) console.log('[NAV] end drag');
    suppressClickUntil = performance.now() + 260;
  } else if (NAV.mode === 'pan') {
    endPan();
    if (window.DEBUG_MOUSE) console.log('[NAV] end pan');
    suppressClickUntil = performance.now() + 260;
  } else if (NAV.mode === 'pending' && elapsed <= CLICK_MS && moved <= MOVE_SLOP) {
    triggerClickAt(e.clientX, e.clientY);
    if (window.DEBUG_MOUSE) console.log('[NAV] click');
  }
  NAV.mode = 'idle';
  NAV.pointerId = null;
  draggedNode = null;
}

function onPointerLeave(e) {
  // Handle pointer leave
  if (dndState === DnDState.DRAGGING) {
    // Continue dragging even if pointer leaves canvas
    return;
  }
  
  // Очищаем наведение на чек-листы
  if (state.checklists && state.checklists.length > 0) {
    for (const checklist of state.checklists) {
      if (checklist._hover) {
        checklist._hover = false;
        checklist._hoverTime = 0;
        
        if (checklist._hoverTimeout) {
          clearTimeout(checklist._hoverTimeout);
          checklist._hoverTimeout = null;
        }
      }
    }
    
    // Скрываем попап
    if (window.hideQuickChecklistView) {
      window.hideQuickChecklistView();
    }
    
    // Возвращаем обычный курсор
    canvas.style.cursor = 'grab';
  }
  
  onMouseLeave(e);
}

// Find drop target based on world coordinates
function findDropTarget(worldX, worldY) {
  // Check for domain targets (for projects)
  for (const domain of state.domains) {
    const domainNode = nodes.find(n => n._type === "domain" && n.id === domain.id);
    if (domainNode) {
      const dx = worldX - domainNode.x;
      const dy = worldY - domainNode.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= domainNode.r) {
        return { type: 'domain', id: domain.id, node: domainNode };
      }
    }
  }
  
  // Check for project targets (for tasks)
  for (const project of state.projects) {
    const projectNode = nodes.find(n => n._type === "project" && n.id === project.id);
    if (projectNode) {
      const dx = worldX - projectNode.x;
      const dy = worldY - projectNode.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= projectNode.r) {
        return { type: 'project', id: project.id, node: projectNode };
      }
    }
  }
  
  return null; // No target found
}

// Consolidated drop handler
function handleDrop() {
  if (!draggedNode) return;
  
  const rect = canvas.getBoundingClientRect();
  const x = lastMouseClient.offsetX || 0;
  const y = lastMouseClient.offsetY || 0;
  const worldPos = screenToWorld(x, y);
  
  console.log("Handling drop for:", draggedNode._type, draggedNode.id, "at world pos:", worldPos);
  
  // Find drop target
  const dropTarget = findDropTarget(worldPos.x, worldPos.y);
  
  if (draggedNode._type === "project") {
    handleProjectDrop(draggedNode, dropTarget);
  } else if (draggedNode._type === "task") {
    handleTaskDrop(draggedNode, dropTarget);
  } else if (draggedNode._type === "idea") {
    handleIdeaDrop(draggedNode, dropTarget);
  } else if (draggedNode._type === "note") {
    handleNoteDrop(draggedNode, dropTarget);
  }
}

// Simplified project drop handler
function handleProjectDrop(projectNode, dropTarget) {
  const project = state.projects.find(p => p.id === projectNode.id);
  if (!project) return;
  
  console.log("Project drop - target:", dropTarget, "current domain:", project.domainId);
  
  if (dropTarget && dropTarget.type === 'domain') {
    // Moving to domain
    if (project.domainId !== dropTarget.id) {
      showProjectMoveConfirmation(project, project.domainId, dropTarget.id);
    } else {
      // Already in this domain, just update position
      project.pos = { x: projectNode.x, y: projectNode.y };
      project.updatedAt = Date.now();
      saveState();
      showToast("Позиция проекта обновлена", "ok");
    }
  } else {
    // Moving to independent (outside any domain)
    if (project.domainId !== null) {
      showProjectExtractConfirmation(project, projectNode);
    } else {
      // Already independent, just update position
      project.pos = { x: projectNode.x, y: projectNode.y };
      project.updatedAt = Date.now();
      saveState();
      showToast("Позиция проекта обновлена", "ok");
    }
  }
}

// Simplified task drop handler
function handleTaskDrop(taskNode, dropTarget) {
  const task = state.tasks.find(t => t.id === taskNode.id);
  if (!task) return;
  
  console.log("Task drop - target:", dropTarget, "current project:", task.projectId);
  
  if (dropTarget && dropTarget.type === 'project') {
    // Moving to project
    if (task.projectId !== dropTarget.id) {
      showTaskMoveConfirmation(task, task.projectId, dropTarget.id);
    } else {
      // Already in this project, just update position
      task.pos = { x: taskNode.x, y: taskNode.y };
      task.updatedAt = Date.now();
      saveState();
      showToast("Позиция задачи обновлена", "ok");
    }
  } else {
    // Moving to independent (outside any project)
    if (task.projectId !== null) {
      showTaskDetachConfirmation(task);
    } else {
      // Already independent, just update position
      task.pos = { x: taskNode.x, y: taskNode.y };
      task.updatedAt = Date.now();
      saveState();
      showToast("Позиция задачи обновлена", "ok");
    }
  }
}

function handleIdeaDrop(ideaNode, dropTarget) {
  const idea = state.ideas.find(i => i.id === ideaNode.id);
  if (!idea) return;
  
  console.log("Idea drop - target:", dropTarget, "current domain:", idea.domainId);
  
  // Update position
  idea.x = ideaNode.x;
  idea.y = ideaNode.y;
  idea.updatedAt = Date.now();
  
  // Update domain if dropped on a domain
  if (dropTarget && dropTarget.type === 'domain') {
    idea.domainId = dropTarget.id;
  }
  
  saveState();
  showToast("Позиция идеи обновлена", "ok");
}

function handleNoteDrop(noteNode, dropTarget) {
  const note = state.notes.find(n => n.id === noteNode.id);
  if (!note) return;
  
  console.log("Note drop - target:", dropTarget, "current domain:", note.domainId);
  
  // Update position
  note.x = noteNode.x;
  note.y = noteNode.y;
  note.updatedAt = Date.now();
  
  // Update domain if dropped on a domain
  if (dropTarget && dropTarget.type === 'domain') {
    note.domainId = dropTarget.id;
  }
  
  saveState();
  showToast("Позиция заметки обновлена", "ok");
}

// Toast helper function
function showToast(message, type = "ok") {
  const toast = document.getElementById("toast");
  if (toast) {
    hideToast();
    toast.className = `toast ${type} show`;
    toast.innerHTML = message;
    isModalOpen = true;
    
    setTimeout(() => {
      hideToast();
    }, 2000);
  }
}

// Project move confirmation functions
function showProjectMoveConfirmation(project, fromDomainId, toDomainId) {
  const fromDomain = fromDomainId ? state.domains.find(d => d.id === fromDomainId)?.title : "независимый";
  const toDomain = state.domains.find(d => d.id === toDomainId)?.title;
  
  const toast = document.getElementById("toast");
  if (toast) {
    hideToast();
    toast.className = "toast attach show";
    toast.innerHTML = `Переместить проект "${project.title}" из домена "${fromDomain}" в домен "${toDomain}"? <button id="projectMoveOk">Переместить</button> <button id="projectMoveCancel">Отменить</button>`;
    
    // Center toast reliably
    toast.style.position = "fixed";
    toast.style.left = "50%";
    toast.style.top = "50%";
    toast.style.transform = "translate(-50%, -50%)";
    toast.style.right = "auto";
    
    isModalOpen = true;
    
    // Set up pending move
    pendingProjectMove = {
      projectId: project.id,
      fromDomainId: fromDomainId,
      toDomainId: toDomainId,
      pos: { x: draggedNode.x, y: draggedNode.y }
    };
    
    // Set up handlers
    setTimeout(() => {
      const ok = document.getElementById("projectMoveOk");
      const cancel = document.getElementById("projectMoveCancel");
      if (ok) {
        ok.onclick = () => {
          confirmProjectMove();
          hideToast();
        };
      }
      if (cancel) {
        cancel.onclick = () => {
          pendingProjectMove = null;
          hideToast();
        };
      }
    }, 20);
  }
}

function showProjectExtractConfirmation(project, projectNode) {
  const currentDomain = project.domainId ? state.domains.find(d => d.id === project.domainId)?.title : "независимый";
  
  const toast = document.getElementById("toast");
  if (toast) {
    hideToast();
    toast.className = "toast detach show";
    toast.innerHTML = `Сделать проект "${project.title}" независимым (извлечь из домена "${currentDomain}")? <button id="projectExtractOk">Извлечь</button> <button id="projectExtractCancel">Отменить</button>`;
    
    // Center toast reliably
    toast.style.position = "fixed";
    toast.style.left = "50%";
    toast.style.top = "50%";
    toast.style.transform = "translate(-50%, -50%)";
    toast.style.right = "auto";
    
    isModalOpen = true;
    
    // Set up pending extract
    pendingProjectMove = {
      projectId: project.id,
      fromDomainId: project.domainId,
      toDomainId: null,
      pos: { x: projectNode.x, y: projectNode.y }
    };
    
    // Set up handlers
    setTimeout(() => {
      const ok = document.getElementById("projectExtractOk");
      const cancel = document.getElementById("projectExtractCancel");
      if (ok) {
        ok.onclick = () => {
          confirmProjectMove();
          hideToast();
        };
      }
      if (cancel) {
        cancel.onclick = () => {
          pendingProjectMove = null;
          hideToast();
        };
      }
    }, 20);
  }
}

// Task move confirmation functions
function showTaskMoveConfirmation(task, fromProjectId, toProjectId) {
  const fromProject = fromProjectId ? state.projects.find(p => p.id === fromProjectId)?.title : "независимая";
  const toProject = state.projects.find(p => p.id === toProjectId)?.title;
  
  const toast = document.getElementById("toast");
  if (toast) {
    hideToast();
    toast.className = "toast attach show";
    toast.innerHTML = `Переместить задачу "${task.title}" из проекта "${fromProject}" в проект "${toProject}"? <button id="taskMoveOk">Переместить</button> <button id="taskMoveCancel">Отменить</button>`;
    isModalOpen = true;
    
    // Set up pending attach
    pendingAttach = {
      taskId: task.id,
      fromProjectId: fromProjectId,
      toProjectId: toProjectId,
      pos: { x: draggedNode.x, y: draggedNode.y }
    };
    
    // Set up handlers
    setTimeout(() => {
      const ok = document.getElementById("taskMoveOk");
      const cancel = document.getElementById("taskMoveCancel");
      if (ok) {
        ok.onclick = () => {
          confirmTaskMove();
          hideToast();
        };
      }
      if (cancel) {
        cancel.onclick = () => {
          pendingAttach = null;
          hideToast();
        };
      }
    }, 20);
  }
}

function showTaskDetachConfirmation(task) {
  const currentProject = task.projectId ? state.projects.find(p => p.id === task.projectId)?.title : "независимая";
  
  const toast = document.getElementById("toast");
  if (toast) {
    hideToast();
    toast.className = "toast detach show";
    toast.innerHTML = `Сделать задачу "${task.title}" независимой (отвязать от проекта "${currentProject}")? <button id="taskDetachOk">Отвязать</button> <button id="taskDetachCancel">Отменить</button>`;
    isModalOpen = true;
    
    // Set up pending detach
    pendingDetach = {
      taskId: task.id,
      fromProjectId: task.projectId,
      pos: { x: draggedNode.x, y: draggedNode.y }
    };
    
    // Set up handlers
    setTimeout(() => {
      const ok = document.getElementById("taskDetachOk");
      const cancel = document.getElementById("taskDetachCancel");
      if (ok) {
        ok.onclick = () => {
          confirmTaskDetach();
          hideToast();
        };
      }
      if (cancel) {
        cancel.onclick = () => {
          pendingDetach = null;
          hideToast();
        };
      }
    }, 20);
  }
}

// Confirmation action functions
function confirmTaskMove() {
  if (!pendingAttach) return;
  
  const task = state.tasks.find(t => t.id === pendingAttach.taskId);
  if (task) {
    task.projectId = pendingAttach.toProjectId;
    task.updatedAt = Date.now();
    
    if (pendingAttach.pos) {
      task.pos = pendingAttach.pos;
    }
    
    saveState();
    showToast("Задача перемещена", "ok");
  }
  
  pendingAttach = null;
}

function confirmTaskDetach() {
  if (!pendingDetach) return;
  
  const task = state.tasks.find(t => t.id === pendingDetach.taskId);
  if (task) {
    task.projectId = null;
    task.updatedAt = Date.now();
    
    if (pendingDetach.pos) {
      task.pos = pendingDetach.pos;
    }
    
    saveState();
    showToast("Задача отвязана", "ok");
  }
  
  pendingDetach = null;
}

// DISABLED: Legacy mouseup handler - CONFLICTS WITH NEW GPT-5 SYSTEM
/*
window.addEventListener("mouseup", (e) => {
  // Block canvas events when modal is open
  if (isModalOpen) {
    return;
  }
  
  // Clear any pending project move if user clicks elsewhere
  if (!draggedNode && pendingProjectMove) {
    pendingProjectMove = null;
    hideToast();
  }
  
  // Handle panning (when no drag started)
  if (!draggedNode && !pendingDragNode) {
    viewState.dragging = false;
    return;
  }
  
  // if drag never started, clear any pending drag
  if (!draggedNode && pendingDragNode) {
    pendingDragNode = null;
    viewState.dragging = false;
    return;
  }
  if (!draggedNode) return;
  let moved = false;
  // record before state for undo
  const before = {};
  if (draggedNode._type === "task") {
    const t = state.tasks.find((x) => x.id === draggedNode.id);
    if (t) {
      before.fromProjectId = t.projectId;
      before.fromPos = t._pos ? { x: t._pos.x, y: t._pos.y } : null;
    }
  }
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
      // update inspector so user sees confirm/cancel immediately
      try {
        const obj = state.tasks.find((t) => t.id === draggedNode.id);
        obj._type = "task";
        openInspectorFor(obj);
      } catch (e) {}
      // show attach toast with buttons
      const toast = document.getElementById("toast");
      if (toast) {
        toast.className = "toast attach show";
        toast.innerHTML = `Привязать задачу к проекту? <button id="attachOk">Привязать</button> <button id="attachCancel">Отменить</button>`;
        toast.style.display = "block";
        toast.style.opacity = "1";
        
        // Position toast near the dragged task
        // Use CSS class for positioning
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

  // For projects: if dropped over a domain, move project to that domain; if dropped outside, make independent
  if (draggedNode._type === "project") {
    const p = state.projects.find((x) => x.id === draggedNode.id);
    if (p) {
      console.log("Project move logic - dropTargetDomainId:", dropTargetDomainId, "p.domainId:", p.domainId);
      if (dropTargetDomainId) {
        const targetDomain = state.domains.find(d => d.id === dropTargetDomainId);
        if (targetDomain) {
          // Move project to domain (only if it's actually moving to a different domain)
          if (p.domainId !== targetDomain.id) {
            const currentDomain = p.domainId ? state.domains.find(d => d.id === p.domainId)?.title : "независимый";
            const newDomain = targetDomain.title;
            console.log("Project move - showing confirmation:", currentDomain, "->", newDomain);
            
            // Set up pending project move
            pendingProjectMove = {
              projectId: draggedNode.id,
              fromDomainId: p.domainId,
              toDomainId: targetDomain.id,
              pos: { x: draggedNode.x, y: draggedNode.y }
            };
            
            // Show toast with buttons
            const toast = document.getElementById("toast");
            console.log("Project move toast - toast element:", toast);
            if (toast) {
              // Clear any existing content and handlers
              console.log("About to clear existing toast...");
              hideToast();
              console.log("Toast cleared, now setting up new toast...");
              
              // Set up toast content
              toast.className = "toast attach show";
              toast.innerHTML = `Переместить проект "${p.title}" из домена "${currentDomain}" в домен "${newDomain}"? <button id="projectMoveOk">Переместить</button> <button id="projectMoveCancel">Отменить</button>`;
              
              // Set modal flag to block canvas events
              isModalOpen = true;
              
              // Use CSS class for positioning - no manual style overrides
              
              console.log("Project move toast - displayed:", toast.style.display, "opacity:", toast.style.opacity);
              console.log("Project move toast - className:", toast.className);
              console.log("Project move toast - computed style:", window.getComputedStyle(toast).display);
              
              // Set up handlers
              setTimeout(() => {
                const ok = document.getElementById("projectMoveOk");
                const cancel = document.getElementById("projectMoveCancel");
                if (ok) {
                  ok.onclick = () => {
                    confirmProjectMove();
                    hideToast();
            };
          }
          if (cancel) {
            cancel.onclick = () => {
                    pendingProjectMove = null;
                    hideToast();
            };
          }
        }, 20);
      }
          } else {
            // Project is already in this domain, just update position
            p.pos = { x: draggedNode.x, y: draggedNode.y };
            p.updatedAt = Date.now();
            saveState();
            
            const toast = document.getElementById("toast");
            if (toast) {
              toast.className = "toast ok show";
              toast.textContent = `Позиция проекта "${p.title}" в домене "${targetDomain.title}" обновлена`;
              toast.style.display = "block";
              toast.style.opacity = "1";
              
              // Position toast near the dragged project
              // Use CSS class for positioning
              
              setTimeout(() => {
                toast.style.transition = "opacity .3s linear";
                toast.style.opacity = "0";
                setTimeout(() => {
                  toast.className = "toast";
                    hideToast();
                  toast.style.transition = "";
                }, 320);
              }, 1400);
            }
            
            layoutMap();
            drawMap();
          }
        } else {
          // Extract project from domain (make independent) - when dropped outside any domain
          console.log("Project extract logic - p.domainId:", p.domainId, "dropTargetDomainId:", dropTargetDomainId);
          if (p.domainId !== null) {
            const currentDomain = state.domains.find(d => d.id === p.domainId)?.title;
            console.log("Project extract - showing confirmation for:", currentDomain);
            
            // Set up pending project extraction
            pendingProjectMove = {
              projectId: draggedNode.id,
              fromDomainId: p.domainId,
              toDomainId: null,
              pos: { x: draggedNode.x, y: draggedNode.y }
            };
            
            // Show toast with buttons
            const toast = document.getElementById("toast");
            console.log("Project extract toast - toast element:", toast);
            if (toast) {
              toast.className = "toast detach show";
              toast.innerHTML = `Извлечь проект "${p.title}" из домена "${currentDomain}" и сделать его независимым? <button id="projectExtractOk">Извлечь</button> <button id="projectExtractCancel">Отменить</button>`;
              toast.style.setProperty("display", "block", "important");
              toast.style.setProperty("opacity", "1", "important");
              toast.style.setProperty("z-index", "1000", "important");
              toast.style.setProperty("visibility", "visible", "important");
              console.log("Project extract toast - displayed:", toast.style.display, "opacity:", toast.style.opacity);
              
              // Position toast near the dragged project
              // Use CSS class for positioning
              
              // Fallback: if positioning failed, use center positioning
              setTimeout(() => {
                if (toast.style.left === '' || toast.style.top === '') {
                  toast.style.position = 'fixed';
                  toast.style.left = '50%';
                  toast.style.top = '50%';
                  toast.style.transform = 'translate(-50%, -50%)';
                  toast.style.right = 'auto';
                }
              }, 10);
              
              // Set up handlers
              setTimeout(() => {
                const ok = document.getElementById("projectExtractOk");
                const cancel = document.getElementById("projectExtractCancel");
                if (ok) {
                  ok.onclick = () => {
                    confirmProjectMove();
                  };
                }
                if (cancel) {
                  cancel.onclick = () => {
                    pendingProjectMove = null;
                    toast.className = "toast";
                    toast.className = "toast";
                    hideToast();
      };
    }
        }, 20);
      }
    }
  }
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
        t.domainId = dropTargetDomainId;
        t.updatedAt = Date.now();
        saveState();
        const toast = document.getElementById("toast");
        if (toast) {
          toast.className = "toast ok show";
          toast.textContent = "Задача прикреплена к домену";
          toast.style.display = "block";
          toast.style.opacity = "1";
          
          // Position toast near the dragged task
          // Use CSS class for positioning
          
          setTimeout(() => {
            toast.style.transition = "opacity .3s linear";
            toast.style.opacity = "0";
            setTimeout(() => {
              toast.className = "toast";
                    hideToast();
              toast.style.transition = "";
            }, 320);
          }, 1400);
        }
        layoutMap();
        drawMap();
      } else {
        // Для остальных случаев показываем модалку выбора
        openMoveTaskModal(t, dropTargetDomainId, draggedNode.x, draggedNode.y);
      }
    }
  }

  // If task dropped outside any domain and beyond its project circle, propose detach
  if (draggedNode._type === "task" && !dropTargetDomainId) {
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
          const toast = document.getElementById("toast");
          if (toast) {
            toast.className = "toast detach";
            toast.innerHTML = `Отвязать задачу от проекта? <button id="detachOk">Отвязать</button> <button id="detachCancel">Отмена</button>`;
            toast.style.display = "block";
            toast.style.opacity = "1";
            
            // Position toast near the dragged task
            // Use CSS class for positioning
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
                    toast.className = "toast";
                    toast.className = "toast";
                    hideToast();
                };
              }
            }, 10);
          }
        }
      }
    } else if (t && !t.projectId && !t.domainId) {
      // Task is already independent, just update position
      t.pos = { x: draggedNode.x, y: draggedNode.y };
      t.updatedAt = Date.now();
      saveState();
      
      const toast = document.getElementById("toast");
      if (toast) {
        toast.className = "toast ok show";
        toast.textContent = "Позиция задачи обновлена";
        toast.style.display = "block";
        toast.style.opacity = "1";
        
        // Position toast near the dragged task
        // Use CSS class for positioning
        
        setTimeout(() => {
          toast.style.transition = "opacity .3s linear";
          toast.style.opacity = "0";
          setTimeout(() => {
            toast.className = "toast";
                    hideToast();
            toast.style.transition = "";
          }, 320);
        }, 1400);
      }
      
      layoutMap();
      drawMap();
    }
  }


  // persist visual position back to state
  if (draggedNode._type === "task") {
    const t = state.tasks.find((x) => x.id === draggedNode.id);
    if (t) {
      // if there is a pendingAttach for this task, don't persist yet (wait for confirm)
      if (pendingAttach && pendingAttach.taskId === t.id) {
        // keep transient pending visualization; actual save occurs on confirmAttach
      } else {
        t.pos = { x: draggedNode.x, y: draggedNode.y };
        saveState();
      }
    }
  }
  if (draggedNode._type === "project") {
    const p = state.projects.find((x) => x.id === draggedNode.id);
    if (p) {
      // if there is a pendingProjectMove for this project, don't persist yet (wait for confirm)
      if (pendingProjectMove && pendingProjectMove.projectId === p.id) {
        // keep transient pending visualization; actual save occurs on confirmProjectMove
      } else {
      p.pos = { x: draggedNode.x, y: draggedNode.y };
        p.updatedAt = Date.now();
      saveState();
      }
      
      // Show feedback for independent project position update (only if no pending move)
      if (!p.domainId && !(pendingProjectMove && pendingProjectMove.projectId === p.id)) {
        const toast = document.getElementById("toast");
        if (toast) {
          toast.className = "toast ok show";
          toast.textContent = "Позиция независимого проекта обновлена";
          toast.style.display = "block";
          toast.style.opacity = "1";
          
          // Position toast near the dragged project
          // Use CSS class for positioning
          
          setTimeout(() => {
            toast.style.transition = "opacity .3s linear";
            toast.style.opacity = "0";
            setTimeout(() => {
              toast.className = "toast";
                    hideToast();
              toast.style.transition = "";
            }, 320);
          }, 1400);
        }
      }
    }
  }

  // record after state and push undo entry if relevant
  const after = {};
  if (draggedNode._type === "task") {
    const t = state.tasks.find((x) => x.id === draggedNode.id);
    if (t) {
      after.toProjectId = t.projectId;
      after.toPos = t.pos ? { x: t.pos.x, y: t.pos.y } : null;
    }
    if (
      before.fromProjectId !== after.toProjectId ||
      (before.fromPos &&
        after.toPos &&
        (before.fromPos.x !== after.toPos.x ||
          before.fromPos.y !== after.toPos.y)) ||
      (!before.fromPos && after.toPos)
    ) {
      undoStack.push({
        type: "task",
        id: draggedNode.id,
        fromProjectId: before.fromProjectId,
        toProjectId: after.toProjectId,
        fromPos: before.fromPos,
        toPos: after.toPos,
      });
      // cap undo stack
      if (undoStack.length > 50) undoStack.shift();
    }
  }
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
  
  // Reset visual effects
  canvas.style.filter = "";
  canvas.style.transition = "";
  
  layoutMap();
  drawMap();

  // Показываем toast при успешном переносе
  if (moved) {
    const toast = document.getElementById("toast");
    if (toast) {
      toast.className = "toast ok show";
      toast.textContent = "Задача перенесена";
      toast.style.display = "block";
      toast.style.opacity = "1";
      setTimeout(() => {
        toast.style.transition = "opacity .3s linear";
        toast.style.opacity = "0";
        setTimeout(() => {
              toast.className = "toast";
                    hideToast();
          toast.style.transition = "";
        }, 320);
      }, 1800);
    }
  }
  // toast for project move
  if (typeof projectMoved !== "undefined" && projectMoved) {
    const toast = document.getElementById("toast");
    if (toast) {
      toast.className = "toast ok show";
      toast.textContent = "Проект перенесён";
      toast.style.display = "block";
      toast.style.opacity = "1";
      setTimeout(() => {
        toast.style.transition = "opacity .3s linear";
        toast.style.opacity = "0";
        setTimeout(() => {
              toast.className = "toast";
                    hideToast();
          toast.style.transition = "";
        }, 320);
      }, 1800);
    }
  }
});
*/

// Export requestDraw function
export { requestDraw };

// expose undo function
export function undoLastMove() {
  const item = undoStack.pop();
  if (!item) return false;
  if (item.type === "task") {
    const t = state.tasks.find((x) => x.id === item.id);
    if (!t) return false;
    if (typeof item.fromProjectId !== "undefined")
      t.projectId = item.fromProjectId;
    if (item.fromPos) t.pos = { x: item.fromPos.x, y: item.fromPos.y };
    saveState();
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
  const t = state.tasks.find((x) => x.id === item.taskId);
  if (!t) {
    pendingAttach = null;
    return false;
  }
  t.projectId = item.toProjectId;
  // Устанавливаем domainId из проекта
  try {
    const project = state.projects.find(p => p.id === item.toProjectId);
    if (project) t.domainId = project.domainId;
  } catch (_) {}
  if (state.settings && state.settings.layoutMode === "auto") {
    try {
      delete t.pos;
    } catch (_) {}
  } else {
    t.pos = { x: item.pos.x, y: item.pos.y };
  }
  t.updatedAt = Date.now();
  saveState();
  // push undo entry
  undoStack.push({
    type: "task",
    id: t.id,
    fromProjectId: item.fromProjectId,
    toProjectId: item.toProjectId,
    fromPos: item.fromPos || null,
    toPos: item.pos,
  });
  if (undoStack.length > 50) undoStack.shift();
  pendingAttach = null;
  // hide toast
  const toast = document.getElementById("toast");
  if (toast) {
    toast.style.opacity = "0";
    setTimeout(() => {
              toast.className = "toast";
                    hideToast();
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
              toast.className = "toast";
                    hideToast();
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
    
    // Отвязываем от проекта
    t.projectId = null;
    
    if (insideDomain) {
      // Задача внутри домена — остается в домене
      t.domainId = insideDomain;
    } else {
      // Задача вне всех доменов — становится полностью независимой
      t.domainId = null;
    }
    
    if (state.settings && state.settings.layoutMode === "auto") {
      try { delete t.pos; } catch (_) {}
    } else {
      t.pos = { x: taskPos.x, y: taskPos.y };
    }
    
    t.updatedAt = Date.now();
    saveState();
    pendingDetach = null;
    const toast = document.getElementById("toast");
    if (toast) {
      toast.className = "toast ok show";
      toast.textContent = insideDomain ? "Отвязано от проекта" : "Задача стала независимой";
      setTimeout(() => { hideToast(); }, 1400);
    }
    layoutMap();
    drawMap();
    return true;
  } catch (e) {
    console.error("Error in confirmDetach:", e);
    pendingDetach = null;
    const toast = document.getElementById("toast");
    if (toast) {
      toast.className = "toast error show";
      toast.textContent = "Ошибка при отвязке";
      setTimeout(() => { hideToast(); }, 1400);
    }
    return false;
  }
}

// Confirm project move between domains (uses pendingProjectMove)
function confirmProjectMove() {
  try {
    console.log("confirmProjectMove called, pendingProjectMove:", pendingProjectMove);
    if (!pendingProjectMove) return false;
    const item = pendingProjectMove;
    const p = state.projects.find((x) => x.id === item.projectId);
    if (!p) {
      console.log("Project not found:", item.projectId);
      pendingProjectMove = null;
      return false;
    }
    
    console.log("Updating project domain from", p.domainId, "to", item.toDomainId);
    // Update project domain
    p.domainId = item.toDomainId;
    p.updatedAt = Date.now();
    
    // Update position if provided
    if (item.pos) {
      p.pos = { x: item.pos.x, y: item.pos.y };
    }
    
    saveState();
    pendingProjectMove = null;
    
    // Hide any existing toast first
    hideToast();
    
    // Update inspector and redraw
    if (p) {
      openInspectorFor(p);
    }
    layoutMap();
    drawMap();
    
    // Show success toast
    const toast = document.getElementById("toast");
    if (toast) {
      toast.className = "toast ok show";
      if (item.toDomainId === null) {
        toast.textContent = "Проект извлечен из домена";
      } else {
        const domain = state.domains.find(d => d.id === item.toDomainId);
        toast.textContent = `Проект перемещен в домен "${domain?.title || 'неизвестный'}"`;
      }
      toast.style.display = "block";
      toast.style.opacity = "1";
      setTimeout(() => {
        toast.style.transition = "opacity .3s linear";
        toast.style.opacity = "0";
        setTimeout(() => {
              toast.className = "toast";
                    hideToast();
          toast.style.transition = "";
        }, 320);
      }, 1400);
    }
    
    layoutMap();
    drawMap();
    return true;
  } catch (e) {
    console.error("Error in confirmProjectMove:", e);
    pendingProjectMove = null;
    const toast = document.getElementById("toast");
    if (toast) {
      toast.className = "toast error show";
      toast.textContent = "Ошибка при перемещении проекта";
      setTimeout(() => { hideToast(); }, 1400);
    }
    return false;
  }
}

export function getPendingAttach() {
  return pendingAttach;
}

// expose some API to the global so inspector can avoid circular import
window.mapApi = window.mapApi || {};
window.mapApi.getPendingAttach = getPendingAttach;
window.mapApi.confirmAttach = confirmAttach;
window.mapApi.cancelAttach = cancelAttach;
window.mapApi.confirmDetach = confirmDetach;
window.mapApi.drawMap = drawMap;
window.mapApi.layoutMap = layoutMap;
window.mapApi.initMap = initMap;
window.mapApi.fitAll = fitAll;
window.mapApi.fitActiveDomain = fitActiveDomain;
window.mapApi.fitActiveProject = fitActiveProject;
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
  drawMap();
}
window.mapApi.getScale = getScale;
window.mapApi.setZoom = setZoom;
window.mapApi.toggleFocusMode = toggleFocusMode;
window.mapApi.isFocusModeActive = isFocusModeActive;
window.mapApi.getFocusedDomainId = getFocusedDomainId;

// Pan mode functions
window.mapApi.setPanMode = () => {
  if (NAV.mode === 'pan') {
    NAV.mode = 'idle';
    canvas.style.cursor = '';
    showToast('Режим панорамирования отключен', 'info');
  } else {
    NAV.mode = 'pan';
    canvas.style.cursor = 'grab';
    showToast('Режим панорамирования включен (перетаскивайте карту)', 'info');
  }
};

// Toggle glow effects
window.mapApi.toggleGlow = () => {
  state.showGlow = !state.showGlow;
  drawMap();
  showToast(`Эффекты свечения ${state.showGlow ? 'включены' : 'отключены'}`, 'info');
};

// Toggle FPS display
window.mapApi.toggleFps = () => {
  setShowFps();
  showToast(`FPS ${showFps ? 'включен' : 'отключен'}`, 'info');
};

// Search functionality
let searchResults = [];
let currentSearchIndex = 0;
let searchHighlightTime = 0;

window.mapApi.searchObjects = (query) => {
  if (!query || query.trim().length < 2) {
    searchResults = [];
    currentSearchIndex = 0;
    drawMap();
    return [];
  }
  
  const searchTerm = query.toLowerCase().trim();
  searchResults = [];
  
  // Search in all objects
  [...state.domains, ...state.projects, ...state.tasks, ...state.ideas, ...state.notes].forEach(obj => {
    if (obj.title && obj.title.toLowerCase().includes(searchTerm)) {
      searchResults.push({
        id: obj.id,
        title: obj.title,
        type: obj.type || 'unknown',
        x: obj.x,
        y: obj.y
      });
    }
  });
  
  currentSearchIndex = 0;
  searchHighlightTime = performance.now();
  
  if (searchResults.length > 0) {
    showToast(`Найдено ${searchResults.length} объектов`, 'info');
    // Center on first result
    centerOnObject(searchResults[0]);
  } else {
    showToast('Объекты не найдены', 'warning');
  }
  
  drawMap();
  return searchResults;
};

window.mapApi.nextSearchResult = () => {
  if (searchResults.length === 0) return;
  
  currentSearchIndex = (currentSearchIndex + 1) % searchResults.length;
  centerOnObject(searchResults[currentSearchIndex]);
  showToast(`Результат ${currentSearchIndex + 1} из ${searchResults.length}: ${searchResults[currentSearchIndex].title}`, 'info');
};

window.mapApi.previousSearchResult = () => {
  if (searchResults.length === 0) return;
  
  currentSearchIndex = currentSearchIndex === 0 ? searchResults.length - 1 : currentSearchIndex - 1;
  centerOnObject(searchResults[currentSearchIndex]);
  showToast(`Результат ${currentSearchIndex + 1} из ${searchResults.length}: ${searchResults[currentSearchIndex].title}`, 'info');
};

function centerOnObject(obj) {
  if (!obj) return;
  
  const targetX = obj.x;
  const targetY = obj.y;
  
  // Animate to object
  const startTime = performance.now();
  const duration = 500;
  
  const startTx = viewState.tx;
  const startTy = viewState.ty;
  const startScale = viewState.scale;
  
  const targetScale = Math.min(1.5, Math.max(0.8, startScale));
  const targetTx = W/2 - targetX * targetScale;
  const targetTy = H/2 - targetY * targetScale;
  
  function animate() {
    const elapsed = performance.now() - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const easeProgress = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    
    viewState.tx = startTx + (targetTx - startTx) * easeProgress;
    viewState.ty = startTy + (targetTy - startTy) * easeProgress;
    viewState.scale = startScale + (targetScale - startScale) * easeProgress;
    
    drawMap();
    
    if (progress < 1) {
      requestAnimationFrame(animate);
    }
  }
  
  animate();
}

// Back-compat aliases for modules that call global functions directly
try {
  window.layoutMap = layoutMap;
  window.drawMap = drawMap;
  window.toggleFocusMode = toggleFocusMode;
  window.isFocusModeActive = isFocusModeActive;
  window.getFocusedDomainId = getFocusedDomainId;
  window.fitAll = fitAll;
  window.fitActiveDomain = fitActiveDomain;
  window.fitActiveProject = fitActiveProject;
  window.showChecklistToggleView = showChecklistToggleView;
  window.hideChecklistToggleView = hideChecklistToggleView;
  window.toggleChecklistItemFromView = toggleChecklistItemFromView;
  window.switchChecklistTab = switchChecklistTab;
  window.renderChecklistTabContent = renderChecklistTabContent;
} catch(_) {}

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
  // Не показываем модальное окно при инициализации
  if (title && title !== "Диалог" && title !== "") {
  modal.style.display = "flex";
  }
}

function openMoveTaskModal(task, targetDomainId, worldX, worldY) {
  const projs = state.projects.filter((p) => p.domainId === targetDomainId);
  const domTitle = state.domains.find((d) => d.id === targetDomainId)?.title || "";
  
  // Create a more compact toast-based interface instead of modal
  const toast = document.getElementById("toast");
  if (toast) {
  const options = [`<option value="__indep__">Оставить независимой</option>`]
    .concat(projs.map((p) => `<option value="${p.id}">${p.title}</option>`))
    .join("");
    
    toast.className = "toast attach show";
    toast.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px;min-width:280px;">
    <div>Перенести в домен "${domTitle}"?</div>
        <select id="selProject" style="padding:4px;border:1px solid var(--panel-2);background:var(--panel);color:var(--text);border-radius:4px;">${options}</select>
        <div style="display:flex;gap:8px;margin-top:8px;">
          <button id="moveTaskOk" style="flex:1;">Переместить</button>
          <button id="moveTaskCancel" style="flex:1;">Отменить</button>
        </div>
      </div>
    `;
    toast.style.display = "block";
    toast.style.opacity = "1";
    
    // Position toast near the dragged task
    if (worldX !== undefined && worldY !== undefined) {
      // Use CSS class for positioning
    }
    
    // Set up handlers
    setTimeout(() => {
      const ok = document.getElementById("moveTaskOk");
      const cancel = document.getElementById("moveTaskCancel");
      const sel = document.getElementById("selProject");
      
      if (ok) {
        ok.onclick = () => {
      const val = sel ? sel.value : "__indep__";
      if (val === "__indep__") {
        task.projectId = null;
        task.domainId = targetDomainId;
      } else {
        task.projectId = val;
          try {
              const project = state.projects.find(p => p.id === val);
              if (project) task.domainId = project.domainId;
          } catch (_) {}
            if (state.settings && state.settings.layoutMode === "auto") {
              try { delete task.pos; } catch (_) {}
        }
      }
      task.updatedAt = Date.now();
      saveState();
          
          // Show success toast
        toast.className = "toast ok show";
          toast.innerHTML = "Задача перемещена";
        toast.style.display = "block";
        toast.style.opacity = "1";
          
        setTimeout(() => {
            toast.style.transition = "opacity .3s linear";
          toast.style.opacity = "0";
          setTimeout(() => {
            toast.className = "toast";
                    hideToast();
            toast.style.transition = "";
          }, 320);
        }, 1400);
          
      layoutMap();
      drawMap();
        };
      }
      
      if (cancel) {
        cancel.onclick = () => {
              toast.className = "toast";
                    hideToast();
        };
      }
    }, 20);
  }
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
    layoutMap();
    drawMap();
    fitActiveDomain();
  }
}

function onContextMenu(e) {
  e.preventDefault(); // Prevent default browser context menu
  e.stopPropagation(); // Stop event bubbling
  
  const pt = screenToWorld(e.offsetX, e.offsetY);
  const n = hit(pt.x, pt.y);
  
  // If clicking on a checklist, open checklist window directly
  if (n && n._type === 'checklist') {
    const checklist = state.checklists.find(c => c.id === n.id);
    if (checklist && window.openChecklistWindow) {
      window.openChecklistWindow(checklist, e.clientX, e.clientY);
    }
    return;
  }
  
  // If clicking on an object, show object-specific menu
  if (n) {
    showObjectContextMenu(e.clientX, e.clientY, n);
  } else {
    // If clicking on empty space, show creation menu
    showContextMenu(e.clientX, e.clientY);
  }
}

function showObjectContextMenu(x, y, node) {
  const contextMenu = document.getElementById('contextMenu');
  if (!contextMenu) return;
  
  // Update menu content based on object type
  let menuContent = '';
  
  if (node._type === 'task') {
    menuContent = `
      <div class="context-menu-item" data-action="edit-task">
        <span class="icon">✏️</span>
        <span class="text">Редактировать задачу</span>
      </div>
      <div class="context-menu-item" data-action="delete-task">
        <span class="icon">🗑️</span>
        <span class="text">Удалить задачу</span>
      </div>
    `;
  } else if (node._type === 'project') {
    menuContent = `
      <div class="context-menu-item" data-action="edit-project">
        <span class="icon">✏️</span>
        <span class="text">Редактировать проект</span>
      </div>
      <div class="context-menu-item" data-action="delete-project">
        <span class="icon">🗑️</span>
        <span class="text">Удалить проект</span>
      </div>
    `;
  } else if (node._type === 'checklist') {
    // Для чек-листов не показываем контекстное меню - правый клик сразу открывает окно
    return;
  } else if (node._type === 'domain') {
    menuContent = `
      <div class="context-menu-item" data-action="edit-domain">
        <span class="icon">✏️</span>
        <span class="text">Редактировать домен</span>
      </div>
      <div class="context-menu-item" data-action="delete-domain">
        <span class="icon">🗑️</span>
        <span class="text">Удалить домен</span>
      </div>
    `;
  } else if (node._type === 'idea') {
    menuContent = `
      <div class="context-menu-item" data-action="edit-idea">
        <span class="icon">✏️</span>
        <span class="text">Редактировать идею</span>
      </div>
      <div class="context-menu-item" data-action="delete-idea">
        <span class="icon">🗑️</span>
        <span class="text">Удалить идею</span>
      </div>
    `;
  } else if (node._type === 'note') {
    menuContent = `
      <div class="context-menu-item" data-action="edit-note">
        <span class="icon">✏️</span>
        <span class="text">Редактировать заметку</span>
      </div>
      <div class="context-menu-item" data-action="delete-note">
        <span class="icon">🗑️</span>
        <span class="text">Удалить заметку</span>
      </div>
    `;
  } else if (node._type === 'checklist') {
    // Чек-листы теперь обрабатываются через правый клик на иконку
    return;
  }
  
  contextMenu.innerHTML = menuContent;
  contextMenuState.x = x;
  contextMenuState.y = y;
  contextMenuState.isVisible = true;
  contextMenuState.currentNode = node;
  
  contextMenu.style.left = x + 'px';
  contextMenu.style.top = y + 'px';
  contextMenu.style.display = 'block';
  
  // Add event listeners for object actions
  contextMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.context-menu-item');
    if (!item) return;
    
    const action = item.dataset.action;
    const node = contextMenuState.currentNode;
    
    switch (action) {
      case 'edit-task':
        showTaskEditor(node);
        break;
      case 'edit-project':
        showProjectEditor(node);
        break;
      case 'edit-domain':
        openInspectorFor(node);
        break;
      case 'edit-idea':
        showIdeaEditor(node);
        break;
      case 'edit-note':
        showNoteEditor(node);
        break;
      // Обработчики для чек-листов удалены - теперь используется прямой правый клик
      case 'delete-task':
        if (confirm(`Удалить задачу "${node.title}"?`)) {
          state.tasks = state.tasks.filter(t => t.id !== node.id);
          saveState();
          layoutMap();
          drawMap();
          updateWip();
        }
        break;
      case 'delete-project':
        if (confirm(`Удалить проект "${node.title}"?`)) {
          state.projects = state.projects.filter(p => p.id !== node.id);
          saveState();
          layoutMap();
          drawMap();
        }
        break;
      case 'delete-domain':
        if (confirm(`Удалить домен "${node.title}"?`)) {
          state.domains = state.domains.filter(d => d.id !== node.id);
          saveState();
          layoutMap();
          drawMap();
        }
        break;
      case 'delete-idea':
        if (confirm(`Удалить идею "${node.title}"?`)) {
          state.ideas = state.ideas.filter(i => i.id !== node.id);
          saveState();
          layoutMap();
          drawMap();
        }
        break;
      case 'delete-note':
        if (confirm(`Удалить заметку "${node.title}"?`)) {
          state.notes = state.notes.filter(n => n.id !== node.id);
          saveState();
          layoutMap();
          drawMap();
        }
        break;
    }
    
    hideContextMenu();
  });
}

// Old function - will be removed
function onContextMenuOld(e) {
  e.preventDefault(); // Prevent default browser context menu
  
  const pt = screenToWorld(e.offsetX, e.offsetY);
  const n = hit(pt.x, pt.y);
  
  if (!n) return;
  
  // Create context menu
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.cssText = `
    position: fixed;
    left: ${e.clientX}px;
    top: ${e.clientY}px;
    background: var(--panel-1);
    border: 1px solid var(--panel-2);
    border-radius: 6px;
    padding: 8px 0;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    z-index: 1000;
    min-width: 150px;
  `;
  
  // Add menu items based on object type
  if (n._type === 'task') {
    menu.innerHTML = `
      <div class="context-item" data-action="edit">✏️ Редактировать</div>
      <div class="context-item" data-action="delete">🗑️ Удалить</div>
    `;
  } else if (n._type === 'project') {
    menu.innerHTML = `
      <div class="context-item" data-action="edit">✏️ Редактировать</div>
      <div class="context-item" data-action="delete">🗑️ Удалить проект</div>
    `;
  } else if (n._type === 'domain') {
    menu.innerHTML = `
      <div class="context-item" data-action="edit">✏️ Редактировать</div>
      <div class="context-item" data-action="delete">🗑️ Удалить домен</div>
    `;
  }
  
  // Style menu items
  const style = document.createElement('style');
  style.textContent = `
    .context-item {
      padding: 8px 16px;
      cursor: pointer;
      color: var(--text-1);
      font-size: 14px;
    }
    .context-item:hover {
      background: var(--panel-2);
    }
  `;
  document.head.appendChild(style);
  
  document.body.appendChild(menu);
  
  // Handle menu item clicks
  menu.addEventListener('click', (e) => {
    const action = e.target.dataset.action;
    if (action === 'edit') {
      // Open inspector for editing
      if (window.openInspectorFor) {
        window.openInspectorFor(n);
      }
    } else if (action === 'delete') {
      // Trigger deletion based on type
      if (n._type === 'task') {
        if (confirm("Удалить задачу без возможности восстановления?")) {
          // Trigger cosmic explosion
          if (window.cosmicAnimations) {
            window.cosmicAnimations.animateTaskDeletion(n.x, n.y, n.status);
          }
          // Delete task
          state.tasks = state.tasks.filter((t) => t.id !== n.id);
          saveState();
          drawMap();
          if (window.renderToday) window.renderToday();
        }
      } else if (n._type === 'project') {
        if (confirm(`Удалить проект "${n.title}" и все его задачи?`)) {
          // Trigger cosmic explosion
          if (window.cosmicAnimations) {
            window.cosmicAnimations.animateTaskDeletion(n.x, n.y, 'project');
          }
          // Delete project and its tasks
          state.tasks = state.tasks.filter((t) => t.projectId !== n.id);
          state.projects = state.projects.filter((p) => p.id !== n.id);
          saveState();
          
          // Force layout and redraw
          if (window.layoutMap) window.layoutMap();
          drawMap();
          
          if (window.updateDomainsList) window.updateDomainsList();
          if (window.updateStatistics) window.updateStatistics();
          if (window.renderToday) window.renderToday();
          if (window.renderSidebar) window.renderSidebar();
        }
      } else if (n._type === 'domain') {
        if (confirm(`Удалить домен "${n.title}" и все его проекты и задачи?`)) {
          // Trigger cosmic explosion
          if (window.cosmicAnimations) {
            window.cosmicAnimations.animateDomainPulse(n.x, n.y, n.r, n.color);
          }
          // Delete domain and all its content
          const projIds = state.projects.filter((p) => p.domainId === n.id).map((p) => p.id);
          state.tasks = state.tasks.filter((t) => !projIds.includes(t.projectId));
          state.projects = state.projects.filter((p) => p.domainId !== n.id);
          state.domains = state.domains.filter((d) => d.id !== n.id);
          // Clear active domain to show entire project instead of focusing on remaining domain
          state.activeDomain = null;
          saveState();
          
          // Force layout and redraw
          if (window.layoutMap) window.layoutMap();
          drawMap();
          
          if (window.updateDomainsList) window.updateDomainsList();
          if (window.updateStatistics) window.updateStatistics();
          if (window.renderToday) window.renderToday();
          if (window.renderSidebar) window.renderSidebar();
        }
      }
    }
    
    // Remove menu
    try {
      if (menu.parentNode) {
        document.body.removeChild(menu);
      }
    } catch (e) {
      // Menu already removed
    }
    try {
      if (style.parentNode) {
        document.head.removeChild(style);
      }
    } catch (e) {
      // Style already removed
    }
  });
  
  // Remove menu when clicking outside
  const removeMenu = (e) => {
    if (!menu.contains(e.target)) {
      try {
        if (menu.parentNode) {
          document.body.removeChild(menu);
        }
      } catch (e) {
        // Menu already removed
      }
      try {
        if (style.parentNode) {
          document.head.removeChild(style);
        }
      } catch (e) {
        // Style already removed
      }
      document.removeEventListener('click', removeMenu);
    }
  };
  
  setTimeout(() => {
    document.addEventListener('click', removeMenu);
  }, 100);
}

function onClick(e) {
  // Ignore click generated right after a pan/drag
  try {
    if (performance.now() < suppressClickUntil) return;
  } catch (_) {}
  const pt = screenToWorld(e.offsetX, e.offsetY);
  const n = hit(pt.x, pt.y);
  if (!n) {
    // click on empty space: show all domains (но НЕ сбрасываем зум)
    state.activeDomain = null;
    layoutMap();
    drawMap();
    // Убрали fitAll() - теперь зум не сбрасывается при клике в пустое место
    return;
  }
  hoverNodeId = n.id;
  if (n._type === "task") {
    const obj = state.tasks.find((t) => t.id === n.id);
    obj._type = "task";
    openInspectorFor(obj);
  } else if (n._type === "project") {
    const obj = state.projects.find((p) => p.id === n.id);
    obj._type = "project";
    
    // Запускаем эффект клика
    clickedNodeId = n.id;
    clickEffectTime = 1.0;
    
    openInspectorFor(obj);
  } else if (n._type === 'idea') {
    // Левый клик по идее - открываем инспектор
    const idea = state.ideas.find(i => i.id === n.id);
    if (idea) {
      // Запускаем эффект клика
      clickedNodeId = n.id;
      clickEffectTime = 1.0;
      
      openInspectorFor({...idea, _type: 'idea'});
    }
    return;
  } else if (n._type === 'note') {
    // Левый клик по заметке - открываем инспектор
    const note = state.notes.find(note => note.id === n.id);
    if (note) {
      // Запускаем эффект клика
      clickedNodeId = n.id;
      clickEffectTime = 1.0;
      
      openInspectorFor({...note, _type: 'note'});
    }
    return;
            } else if (n._type === 'checklist') {
              // Левый клик по чек-листу - открываем полный редактор
              const checklist = state.checklists.find(c => c.id === n.id);
              if (checklist) {
                // Запускаем эффект клика
                clickedNodeId = n.id;
                clickEffectTime = 1.0;
                
                // Открываем полный редактор
                window.showChecklistEditor(checklist);
              }
              return;
            } else {
    const obj = state.domains.find((d) => d.id === n.id);
    obj._type = "domain";
    openInspectorFor(obj);
  }
}

// ===== COSMIC EFFECTS =====

function initStarField() {
  starField = [];
  const starCount = Math.floor((W * H) / 8000); // Density based on canvas size
  
  for (let i = 0; i < starCount; i++) {
    starField.push({
      x: Math.random() * W,
      y: Math.random() * H,
      size: Math.random() * 2 + 0.5,
      brightness: Math.random() * 0.8 + 0.2,
      twinkleSpeed: Math.random() * 0.02 + 0.01,
      twinklePhase: Math.random() * Math.PI * 2,
      color: Math.random() > 0.8 ? '#b3d9ff' : '#ffffff' // Some blue stars
    });
  }
}

function drawStarfield(ctx, width, height, viewState) {
  const now = performance.now();
  const time = now * 0.001;
  
  // Update star twinkling
  starField.forEach(star => {
    star.twinklePhase += star.twinkleSpeed;
    star.currentBrightness = star.brightness + Math.sin(star.twinklePhase) * 0.3;
  });
  
  // Draw stars with parallax effect
  const parallaxFactor = 1 / Math.max(0.1, viewState.scale);
  const offsetX = viewState.tx * 0.1;
  const offsetY = viewState.ty * 0.1;
  
  starField.forEach(star => {
    const x = (star.x + offsetX) * parallaxFactor;
    const y = (star.y + offsetY) * parallaxFactor;
    
    // Only draw stars in viewport
    if (x > -50 && x < width + 50 && y > -50 && y < height + 50) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, star.currentBrightness));
      
      // Draw star with glow effect
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, star.size * 3);
      gradient.addColorStop(0, star.color);
      gradient.addColorStop(0.5, star.color + '80');
      gradient.addColorStop(1, 'transparent');
      
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, star.size * 3, 0, Math.PI * 2);
      ctx.fill();
      
      // Draw bright core
      ctx.globalAlpha = 1;
      ctx.fillStyle = star.color;
      ctx.beginPath();
      ctx.arc(x, y, star.size, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.restore();
    }
  });
}

function drawPlanet(ctx, x, y, radius, color, type = 'planet') {
  ctx.save();
  
  if (type === 'planet') {
    // Create planet with gradient and texture
    const gradient = ctx.createRadialGradient(
      x - radius * 0.3, y - radius * 0.3, 0,
      x, y, radius
    );
    
    // Planet colors based on type
    const planetColors = {
      'task': ['#4a90e2', '#2c5aa0', '#1e3a5f'],
      'project': ['#7b68ee', '#5a4fcf', '#3d2f8f'],
      'domain': [color, color + 'cc', color + '66']
    };
    
    const colors = planetColors[type] || planetColors['task'];
    gradient.addColorStop(0, colors[0]);
    gradient.addColorStop(0.6, colors[1]);
    gradient.addColorStop(1, colors[2]);
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    
    // Add planet atmosphere/glow
    const glowGradient = ctx.createRadialGradient(x, y, 0, x, y, radius * 1.5);
    glowGradient.addColorStop(0, colors[0] + '40');
    glowGradient.addColorStop(0.7, colors[0] + '20');
    glowGradient.addColorStop(1, 'transparent');
    
    ctx.fillStyle = glowGradient;
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.5, 0, Math.PI * 2);
    ctx.fill();
    
    // Add static surface details (no more flickering!)
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = colors[2];
    
    // Use deterministic positions based on planet coordinates
    const seed = Math.floor(x * 1000 + y * 1000) % 1000;
    for (let i = 0; i < 3; i++) {
      // Create pseudo-random but stable positions
      const angle = (seed + i * 120) * 0.01;
      const distance = radius * (0.3 + (seed + i * 200) % 100 * 0.005);
      const detailX = x + Math.cos(angle) * distance;
      const detailY = y + Math.sin(angle) * distance;
      const detailR = radius * (0.08 + (seed + i * 300) % 50 * 0.002);
      
      ctx.beginPath();
      ctx.arc(detailX, detailY, detailR, 0, Math.PI * 2);
      ctx.fill();
    }
    
  } else if (type === 'nebula') {
    // Modern flat design for domains
    ctx.save();
    
    // Subtle shadow for depth
    ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 4;
    
    // Main domain circle with flat color
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    
    // Add subtle inner highlight
    ctx.shadowBlur = 0;
    const highlightGradient = ctx.createRadialGradient(x, y, 0, x, y, radius * 0.6);
    highlightGradient.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
    highlightGradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.1)');
    highlightGradient.addColorStop(1, 'transparent');
    
    ctx.fillStyle = highlightGradient;
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.6, 0, Math.PI * 2);
    ctx.fill();
    
    // Modern border
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, radius - 2, 0, Math.PI * 2);
    ctx.stroke();
    
    ctx.restore();
  }
  
  ctx.restore();
}

// Modern Flat Design for projects
function drawProjectModern(ctx, x, y, radius, color, seed = 0) {
  ctx.save();
  
  // Modern flat design with subtle shadows
  const shapeType = Math.floor(seed % 3);
  
  // Add subtle shadow for depth
  ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;
  
  if (shapeType === 0) {
    // Modern rounded rectangle
    const width = radius * 1.6;
    const height = radius * 1.2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x - width/2, y - height/2, width, height, radius * 0.3);
    ctx.fill();
  } else if (shapeType === 1) {
    // Modern circle with accent
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    
    // Add accent dot
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x + radius * 0.3, y - radius * 0.3, radius * 0.2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Modern hexagon
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (i * Math.PI) / 3;
      const px = x + Math.cos(angle) * radius;
      const py = y + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
  }
  
  ctx.restore();
}

// Simplified galaxy for better performance
function drawGalaxy(ctx, x, y, radius, color, seed = 0) {
  ctx.save();
  
  // Simple seed-based random function
  const rng = (n) => {
    const randomValue = Math.sin(n * 12.9898 + seed * 78.233) * 43758.5453;
    return randomValue - Math.floor(randomValue);
  };
  
  // Galaxy center (bright core) - simplified
  const coreGradient = ctx.createRadialGradient(x, y, 0, x, y, radius * 0.3);
  coreGradient.addColorStop(0, '#ffffff');
  coreGradient.addColorStop(0.5, color + 'cc');
  coreGradient.addColorStop(1, 'transparent');
  
  ctx.fillStyle = coreGradient;
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.3, 0, Math.PI * 2);
  ctx.fill();
  
  // Simplified spiral arms (2-3 arms max for performance)
  const armCount = 2 + Math.floor(rng(1) * 2); // 2-3 arms only
  const time = performance.now() * 0.0001; // Slower rotation
  
  for (let arm = 0; arm < armCount; arm++) {
    const armAngle = (arm / armCount) * Math.PI * 2 + time;
    const armLength = radius * 0.7;
    
    // Simplified spiral - just a curved line
    ctx.beginPath();
    ctx.strokeStyle = color + '60';
    ctx.lineWidth = radius * 0.08;
    ctx.lineCap = 'round';
    
    // Draw simple spiral with fewer points
    for (let i = 0; i < 8; i++) {
      const t = i / 7;
      const spiralRadius = t * armLength;
      const spiralAngle = armAngle + t * Math.PI;
      
      const px = x + Math.cos(spiralAngle) * spiralRadius;
      const py = y + Math.sin(spiralAngle) * spiralRadius;
      
      if (i === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();
  }
  
  // Simplified star clusters (fewer for performance)
  const clusterCount = 2 + Math.floor(rng(3) * 3); // 2-4 clusters only
  for (let i = 0; i < clusterCount; i++) {
    const clusterAngle = rng(i + 30) * Math.PI * 2;
    const clusterRadius = radius * (0.4 + rng(i + 40) * 0.4);
    const clusterX = x + Math.cos(clusterAngle) * clusterRadius;
    const clusterY = y + Math.sin(clusterAngle) * clusterRadius;
    const clusterSize = radius * 0.06;
    
    // Simple star cluster without glow
    ctx.fillStyle = color + 'aa';
    ctx.beginPath();
    ctx.arc(clusterX, clusterY, clusterSize, 0, Math.PI * 2);
    ctx.fill();
  }
  
  ctx.restore();
}

function drawTaskModern(ctx, x, y, radius, color, status) {
  ctx.save();
  
  // Modern flat design for tasks
  const statusColors = {
    'backlog': '#6b7280',    // Gray
    'today': '#f59e0b',      // Amber
    'wip': '#3b82f6',        // Blue
    'done': '#10b981'        // Green
  };
  
  const taskColor = statusColors[status] || color;
  
  // Subtle shadow for depth
  ctx.shadowColor = 'rgba(0, 0, 0, 0.1)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 2;
  
  // Main task circle
  ctx.fillStyle = taskColor;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  
  // Modern border
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, radius - 1, 0, Math.PI * 2);
  ctx.stroke();
  
  // Different shapes based on status
  if (status === 'done') {
    // Done tasks as solid circles with subtle glow
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.7, color + 'cc');
    gradient.addColorStop(1, color + '88');
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    
  } else if (status === 'today') {
    // Today tasks as bright stars with rays
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius * 1.5);
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.4, color + 'ee');
    gradient.addColorStop(0.8, color + 'aa');
    gradient.addColorStop(1, color + '66');
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.5, 0, Math.PI * 2);
    ctx.fill();
    
    // Add star rays with better visibility
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const startX = x + Math.cos(angle) * radius * 0.6;
      const startY = y + Math.sin(angle) * radius * 0.6;
      const endX = x + Math.cos(angle) * radius * 1.8;
      const endY = y + Math.sin(angle) * radius * 1.8;
      
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();
    }
    
  } else if (status === 'doing') {
    // Doing tasks as gentle pulsing stars with solid core
    const time = performance.now() * 0.001; // Замедлили в 3 раза
    const pulse = 1 + Math.sin(time) * 0.08; // Уменьшили амплитуду
    const pulseRadius = radius * pulse;
    
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, pulseRadius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.6, color + 'dd');
    gradient.addColorStop(1, color + '99');
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, pulseRadius, 0, Math.PI * 2);
    ctx.fill();
    
  } else {
    // Backlog tasks as solid asteroids
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.8, color + 'ee');
    gradient.addColorStop(1, color + 'aa');
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    
    // Add some surface details with better contrast
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = color + 'cc';
    for (let i = 0; i < 2; i++) {
      const detailX = x + (Math.random() - 0.5) * radius * 0.6;
      const detailY = y + (Math.random() - 0.5) * radius * 0.6;
      const detailR = radius * 0.2;
      
      ctx.beginPath();
      ctx.arc(detailX, detailY, detailR, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  
  // Solid core for all tasks
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.5, 0, Math.PI * 2);
  ctx.fill();
  
  // Add small white highlight
  ctx.fillStyle = '#ffffff';
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.arc(x - radius * 0.2, y - radius * 0.2, radius * 0.15, 0, Math.PI * 2);
  ctx.fill();
  
  ctx.restore();
}

// Функции рендеринга новых космических объектов
function drawIdeas() {
  if (!state.ideas || state.ideas.length === 0) return;
  if (W <= 0 || H <= 0) return;
  
  // Получаем функцию inView из контекста drawMap
  const inv = 1 / Math.max(0.0001, viewState.scale);
  const pad = 120 * inv;
  const vx0 = -viewState.tx * inv - pad;
  const vy0 = -viewState.ty * inv - pad;
  const vx1 = (W - viewState.tx) * inv + pad;
  const vy1 = (H - viewState.ty) * inv + pad;
  const inView = (x, y, r = 0) =>
    x + r > vx0 && x - r < vx1 && y + r > vy0 && y - r < vy1;
  
  state.ideas.forEach(idea => {
    if (!inView(idea.x, idea.y, idea.r + 20 * DPR)) return;
    
    const x = idea.x * DPR;
    const y = idea.y * DPR;
    const r = idea.r * DPR;
    
    // Очень медленная и плавная анимация пульсации
    const time = performance.now() * 0.0005; // Замедлено в 6 раз
    const pulse = 1 + Math.sin(time + idea.x * 0.01) * 0.08; // Очень слабая пульсация
    const pulseRadius = r * pulse;
    
    // Рисуем идею - упрощенный и надежный дизайн
    ctx.save();
    
    const baseColor = idea.color || '#8b5cf6';
    const alpha = Math.max(0.6, idea.opacity || 0.8);
    
    // Основной круг с градиентом
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, pulseRadius);
    gradient.addColorStop(0, baseColor + 'ff');
    gradient.addColorStop(0.5, baseColor + 'aa');
    gradient.addColorStop(1, baseColor + '66');
    
    ctx.globalAlpha = alpha;
    ctx.fillStyle = gradient;
    ctx.shadowColor = baseColor;
    ctx.shadowBlur = 15 * DPR;
    
    ctx.beginPath();
    ctx.arc(x, y, pulseRadius, 0, Math.PI * 2);
    ctx.fill();
    
    // Внутренний круг
    ctx.globalAlpha = alpha * 0.8;
    ctx.fillStyle = baseColor + 'cc';
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(x, y, pulseRadius * 0.7, 0, Math.PI * 2);
    ctx.fill();
    
    // Иконка
    ctx.globalAlpha = 1.0;
    ctx.fillStyle = '#ffffff';
    ctx.font = `${pulseRadius * 0.8}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💡', x, y);
    
    ctx.restore();
  });
}

function drawNotes() {
  if (!state.notes) {
    state.notes = [];
  }
  
  // Добавляем тестовую заметку если нет заметок
  if (state.notes.length === 0) {
    state.notes.push({
      id: 'test-note',
      title: 'Тестовая заметка',
      content: 'Тест',
      x: 0,
      y: 0,
      r: 20,
      color: '#6c757d',
      opacity: 1.0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  }
  
  if (W <= 0 || H <= 0) return;
  
  // Получаем функцию inView из контекста drawMap
  const inv = 1 / Math.max(0.0001, viewState.scale);
  const pad = 120 * inv;
  const vx0 = -viewState.tx * inv - pad;
  const vy0 = -viewState.ty * inv - pad;
  const vx1 = (W - viewState.tx) * inv + pad;
  const vy1 = (H - viewState.ty) * inv + pad;
  const inView = (x, y, r = 0) =>
    x + r > vx0 && x - r < vx1 && y + r > vy0 && y - r < vy1;
  
  state.notes.forEach((note, index) => {
    if (!inView(note.x, note.y, note.r + 20 * DPR)) {
      return;
    }
    
    const x = note.x * DPR;
    const y = note.y * DPR;
    const r = note.r * DPR;
    
    // Очень медленная и плавная анимация вращения
    const time = performance.now() * 0.0003; // Замедлено в 10 раз
    const rotation = time + note.x * 0.005; // Медленное вращение
    const pulse = 1 + Math.sin(time + note.y * 0.01) * 0.05; // Очень слабая пульсация
    const pulseRadius = r * pulse;
    
    // Рисуем заметку - современный дизайн с эффектами
    ctx.save();
    
    const baseColor = note.color || '#6c757d';
    const alpha = Math.max(0.9, note.opacity || 1.0);
    
    // Создаем форму заметки (современный прямоугольник с закругленными углами)
    const width = pulseRadius * 2.2;
    const height = pulseRadius * 1.6;
    const cornerRadius = pulseRadius * 0.3;
    
    // Улучшенная тень с размытием
    ctx.globalAlpha = alpha * 0.4;
    ctx.fillStyle = '#000000';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 12 * DPR;
    ctx.shadowOffsetX = 4 * DPR;
    ctx.shadowOffsetY = 4 * DPR;
    
    // Рисуем тень
    ctx.beginPath();
    drawRoundedRect(ctx, x - width/2 + 3, y - height/2 + 3, width, height, cornerRadius);
    ctx.fill();
    
    // Основная форма заметки
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.globalAlpha = alpha;
    
    // Современный градиент с акцентным цветом
    const gradient = ctx.createLinearGradient(x - width/2, y - height/2, x + width/2, y + height/2);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.1, '#f8f9fa');
    gradient.addColorStop(0.3, baseColor + '15');
    gradient.addColorStop(0.7, baseColor + '10');
    gradient.addColorStop(0.9, '#e9ecef');
    gradient.addColorStop(1, '#dee2e6');
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    drawRoundedRect(ctx, x - width/2, y - height/2, width, height, cornerRadius);
    ctx.fill();
    
    // Акцентная полоса сверху
    ctx.fillStyle = baseColor + '80';
    ctx.beginPath();
    drawRoundedRect(ctx, x - width/2, y - height/2, width, pulseRadius * 0.15, cornerRadius, cornerRadius, 0, 0);
    ctx.fill();
    
    // Улучшенная обводка с градиентом
    const borderGradient = ctx.createLinearGradient(x - width/2, y, x + width/2, y);
    borderGradient.addColorStop(0, baseColor + '60');
    borderGradient.addColorStop(0.5, baseColor + 'CC');
    borderGradient.addColorStop(1, baseColor + '60');
    
    ctx.strokeStyle = borderGradient;
    ctx.lineWidth = 2.5 * DPR;
    ctx.beginPath();
    drawRoundedRect(ctx, x - width/2, y - height/2, width, height, cornerRadius);
    ctx.stroke();
    
    // Декоративные линии на бумаге
    ctx.globalAlpha = alpha * 0.4;
    ctx.strokeStyle = baseColor + '30';
    ctx.lineWidth = 1 * DPR;
    for (let i = 1; i < 3; i++) {
      const lineY = y - height/2 + (height * i / 4);
      ctx.beginPath();
      ctx.moveTo(x - width/2 + 8 * DPR, lineY);
      ctx.lineTo(x + width/2 - 8 * DPR, lineY);
      ctx.stroke();
    }
    
    // Иконка заметки
    ctx.globalAlpha = 1.0;
    ctx.fillStyle = baseColor;
    ctx.font = `${pulseRadius * 0.6}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('📝', x, y);
    
    // Маленький уголок загнутый
    ctx.globalAlpha = alpha * 0.6;
    ctx.fillStyle = baseColor + '66';
    ctx.beginPath();
    ctx.moveTo(x + width/2 - 8 * DPR, y - height/2 + 8 * DPR);
    ctx.lineTo(x + width/2 - 2 * DPR, y - height/2 + 2 * DPR);
    ctx.lineTo(x + width/2 - 2 * DPR, y - height/2 + 8 * DPR);
    ctx.closePath();
    ctx.fill();
    
    ctx.restore();
  });
}

// Функции обработки кликов по новым объектам
function handleIdeaClick(idea) {
  // Показываем модальное окно для редактирования идеи
  showIdeaEditor(idea);
}

function handleNoteClick(note) {
  // Показываем модальное окно для редактирования заметки
  showNoteEditor(note);
}

function showIdeaEditor(idea) {
  // Используем существующее модальное окно
  const modal = document.getElementById('modal');
  if (!modal) return;
  
  modal.innerHTML = `
    <div class="box idea-editor">
      <div class="title">🌌 Редактировать идею</div>
      <div class="body">
        <div class="form-group">
          <label>Название идеи:</label>
          <input type="text" id="ideaTitle" value="${idea.title}" placeholder="Введите название идеи" class="form-input">
        </div>
        <div class="form-group">
          <label>Описание:</label>
          <textarea id="ideaContent" placeholder="Опишите вашу идею подробнее..." class="form-textarea">${idea.content}</textarea>
        </div>
        <div class="form-group">
          <label>Цвет:</label>
          <div class="color-picker">
            <input type="color" id="ideaColor" value="${idea.color}" class="color-input">
            <div class="color-presets">
              <div class="color-preset" data-color="#ff6b6b" style="background: #ff6b6b;"></div>
              <div class="color-preset" data-color="#4ecdc4" style="background: #4ecdc4;"></div>
              <div class="color-preset" data-color="#45b7d1" style="background: #45b7d1;"></div>
              <div class="color-preset" data-color="#96ceb4" style="background: #96ceb4;"></div>
              <div class="color-preset" data-color="#feca57" style="background: #feca57;"></div>
              <div class="color-preset" data-color="#ff9ff3" style="background: #ff9ff3;"></div>
            </div>
          </div>
        </div>
        <div class="form-group">
          <label>Размер:</label>
          <input type="range" id="ideaSize" min="20" max="60" value="${idea.r}" class="form-range">
          <span class="size-value">${idea.r}px</span>
        </div>
        <div class="form-group">
          <label>Прозрачность:</label>
          <input type="range" id="ideaOpacity" min="0.1" max="1" step="0.1" value="${idea.opacity}" class="form-range">
          <span class="opacity-value">${Math.round(idea.opacity * 100)}%</span>
        </div>
      </div>
      <div class="buttons">
        <button class="btn" onclick="closeModal()">Отмена</button>
        <button class="btn primary" onclick="saveIdea('${idea.id}')">💾 Сохранить</button>
        <button class="btn danger" onclick="deleteIdea('${idea.id}')">🗑️ Удалить</button>
      </div>
    </div>
    <div class="backdrop"></div>
  `;
  modal.style.display = 'flex';
  
  // Добавляем обработчики для цветовых пресетов
  modal.querySelectorAll('.color-preset').forEach(preset => {
    preset.addEventListener('click', () => {
      const color = preset.dataset.color;
      modal.querySelector('#ideaColor').value = color;
    });
  });
  
  // Добавляем обработчики для слайдеров с дебаунсингом
  let sizeTimeout, opacityTimeout;
  
  modal.querySelector('#ideaSize').addEventListener('input', (e) => {
    modal.querySelector('.size-value').textContent = e.target.value + 'px';
    
    // Дебаунсинг для обновления размера
    clearTimeout(sizeTimeout);
    sizeTimeout = setTimeout(() => {
      idea.r = parseInt(e.target.value);
      requestDraw();
    }, 100);
  });
  
  modal.querySelector('#ideaOpacity').addEventListener('input', (e) => {
    modal.querySelector('.opacity-value').textContent = Math.round(e.target.value * 100) + '%';
    
    // Дебаунсинг для обновления прозрачности
    clearTimeout(opacityTimeout);
    opacityTimeout = setTimeout(() => {
      idea.opacity = parseFloat(e.target.value);
      requestDraw();
    }, 100);
  });
}

function showNoteEditor(note) {
  // Используем существующее модальное окно
  const modal = document.getElementById('modal');
  if (!modal) return;
  
  modal.innerHTML = `
    <div class="box note-editor">
      <div class="title">🪨 Редактировать заметку</div>
      <div class="body">
        <div class="form-group">
          <label>Название заметки:</label>
          <input type="text" id="noteTitle" value="${note.title}" placeholder="Введите название заметки" class="form-input">
        </div>
        <div class="form-group">
          <label>Содержание:</label>
          <textarea id="noteContent" placeholder="Опишите содержимое заметки..." class="form-textarea">${note.content}</textarea>
        </div>
        <div class="form-group">
          <label>Цвет:</label>
          <div class="color-picker">
            <input type="color" id="noteColor" value="${note.color}" class="color-input">
            <div class="color-presets">
              <div class="color-preset" data-color="#8b7355" style="background: #8b7355;"></div>
              <div class="color-preset" data-color="#a0a0a0" style="background: #a0a0a0;"></div>
              <div class="color-preset" data-color="#6c757d" style="background: #6c757d;"></div>
              <div class="color-preset" data-color="#495057" style="background: #495057;"></div>
              <div class="color-preset" data-color="#343a40" style="background: #343a40;"></div>
              <div class="color-preset" data-color="#212529" style="background: #212529;"></div>
            </div>
          </div>
        </div>
        <div class="form-group">
          <label>Размер:</label>
          <input type="range" id="noteSize" min="5" max="20" value="${note.r}" class="form-range">
          <span class="size-value">${note.r}px</span>
        </div>
        <div class="form-group">
          <label>Прозрачность:</label>
          <input type="range" id="noteOpacity" min="0.3" max="1" step="0.1" value="${note.opacity}" class="form-range">
          <span class="opacity-value">${Math.round(note.opacity * 100)}%</span>
        </div>
      </div>
      <div class="buttons">
        <button class="btn" onclick="closeModal()">Отмена</button>
        <button class="btn primary" onclick="saveNote('${note.id}')">💾 Сохранить</button>
        <button class="btn danger" onclick="deleteNote('${note.id}')">🗑️ Удалить</button>
      </div>
    </div>
    <div class="backdrop"></div>
  `;
  modal.style.display = 'flex';
  
  // Добавляем обработчики для цветовых пресетов
  modal.querySelectorAll('.color-preset').forEach(preset => {
    preset.addEventListener('click', () => {
      const color = preset.dataset.color;
      modal.querySelector('#noteColor').value = color;
    });
  });
  
  // Добавляем обработчики для слайдеров с дебаунсингом
  let sizeTimeout, opacityTimeout;
  
  modal.querySelector('#noteSize').addEventListener('input', (e) => {
    modal.querySelector('.size-value').textContent = e.target.value + 'px';
    
    // Дебаунсинг для обновления размера
    clearTimeout(sizeTimeout);
    sizeTimeout = setTimeout(() => {
      note.r = parseInt(e.target.value);
      requestDraw();
    }, 100);
  });
  
  modal.querySelector('#noteOpacity').addEventListener('input', (e) => {
    modal.querySelector('.opacity-value').textContent = Math.round(e.target.value * 100) + '%';
    
    // Дебаунсинг для обновления прозрачности
    clearTimeout(opacityTimeout);
    opacityTimeout = setTimeout(() => {
      note.opacity = parseFloat(e.target.value);
      requestDraw();
    }, 100);
  });
}

function drawChecklists() {
  if (!state.checklists) {
    state.checklists = [];
  }
  
  
  if (W <= 0 || H <= 0) return;
  
  // Получаем функцию inView из контекста drawMap
  const inv = 1 / Math.max(0.0001, viewState.scale);
  const pad = 120 * inv;
  const vx0 = -viewState.tx * inv - pad;
  const vy0 = -viewState.ty * inv - pad;
  const vx1 = (W - viewState.tx) * inv + pad;
  const vy1 = (H - viewState.ty) * inv + pad;
  const inView = (x, y, r = 0) =>
    x + r > vx0 && x - r < vx1 && y + r > vy0 && y - r < vy1;
  
  state.checklists.forEach((checklist, index) => {
    if (!inView(checklist.x, checklist.y, checklist.r + 20 * DPR)) {
      return;
    }
    
    const x = checklist.x * DPR;
    const y = checklist.y * DPR;
    const r = checklist.r * DPR;
    
    // Анимация пульсации
    const time = performance.now() * 0.002;
    const pulse = 1 + Math.sin(time + checklist.x * 0.01) * 0.1;
    const pulseRadius = r * pulse;
    
    // Рисуем чек-лист - современный дизайн с прогресс-баром
    ctx.save();
    
    const baseColor = checklist.color || '#3b82f6';
    const alpha = Math.max(0.9, checklist.opacity || 1.0);
    
    // Создаем форму чек-листа (прямоугольник с закругленными углами)
    const width = pulseRadius * 2.5;
    const height = pulseRadius * 1.8;
    const cornerRadius = pulseRadius * 0.3;
    
    // Тень
    ctx.globalAlpha = alpha * 0.4;
    ctx.fillStyle = '#000000';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 12 * DPR;
    ctx.shadowOffsetX = 4 * DPR;
    ctx.shadowOffsetY = 4 * DPR;
    
    // Рисуем тень
    ctx.beginPath();
    drawRoundedRect(ctx, x - width/2 + 3, y - height/2 + 3, width, height, cornerRadius);
    ctx.fill();
    
    // Основная форма чек-листа
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.globalAlpha = alpha;
    
    // Градиент фона
    const gradient = ctx.createLinearGradient(x - width/2, y - height/2, x + width/2, y + height/2);
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(0.1, '#f8f9fa');
    gradient.addColorStop(0.3, baseColor + '20');
    gradient.addColorStop(0.7, baseColor + '15');
    gradient.addColorStop(0.9, '#e9ecef');
    gradient.addColorStop(1, '#dee2e6');
    
    ctx.fillStyle = gradient;
    ctx.beginPath();
    drawRoundedRect(ctx, x - width/2, y - height/2, width, height, cornerRadius);
    ctx.fill();
    
    // Акцентная полоса сверху
    ctx.fillStyle = baseColor + '80';
    ctx.beginPath();
    drawRoundedRect(ctx, x - width/2, y - height/2, width, pulseRadius * 0.15, cornerRadius, cornerRadius, 0, 0);
    ctx.fill();
    
    // Обводка
    const borderGradient = ctx.createLinearGradient(x - width/2, y, x + width/2, y);
    borderGradient.addColorStop(0, baseColor + '60');
    borderGradient.addColorStop(0.5, baseColor + 'CC');
    borderGradient.addColorStop(1, baseColor + '60');
    
    ctx.strokeStyle = borderGradient;
    ctx.lineWidth = 2.5 * DPR;
    ctx.beginPath();
    drawRoundedRect(ctx, x - width/2, y - height/2, width, height, cornerRadius);
    ctx.stroke();
    
    // Прогресс-бар
    const progress = getChecklistProgress(checklist.id);
    if (progress > 0) {
      const progressBarWidth = width * 0.8;
      const progressBarHeight = 4 * DPR;
      const progressBarX = x - progressBarWidth / 2;
      const progressBarY = y + height/2 - 12 * DPR;
      
      // Фон прогресс-бара
      ctx.fillStyle = baseColor + '30';
      ctx.beginPath();
      drawRoundedRect(ctx, progressBarX, progressBarY, progressBarWidth, progressBarHeight, progressBarHeight/2);
      ctx.fill();
      
      // Заполнение прогресс-бара
      const fillWidth = (progressBarWidth * progress) / 100;
      if (fillWidth > 0) {
        const progressGradient = ctx.createLinearGradient(progressBarX, progressBarY, progressBarX + fillWidth, progressBarY);
        progressGradient.addColorStop(0, baseColor);
        progressGradient.addColorStop(1, baseColor + 'CC');
        
        ctx.fillStyle = progressGradient;
        ctx.beginPath();
        drawRoundedRect(ctx, progressBarX, progressBarY, fillWidth, progressBarHeight, progressBarHeight/2);
        ctx.fill();
      }
      
      // Текст прогресса
      ctx.fillStyle = baseColor;
      ctx.font = `${8 * DPR}px system-ui`;
      ctx.textAlign = "center";
      ctx.fillText(`${progress}%`, x, progressBarY - 4 * DPR);
    }
    
    // Иконка чек-листа
    ctx.fillStyle = baseColor;
    ctx.font = `${12 * DPR}px system-ui`;
    ctx.textAlign = "center";
    ctx.fillText('✓', x, y - 2 * DPR);
    
    // Название чек-листа с лучшим позиционированием
    ctx.fillStyle = baseColor;
    ctx.font = `bold ${11 * DPR}px system-ui`;
    ctx.textAlign = "center";
    
    // Ограничиваем длину названия
    const maxTitleLength = 12;
    const displayTitle = checklist.title.length > maxTitleLength 
      ? checklist.title.substring(0, maxTitleLength) + '...' 
      : checklist.title;
    
    ctx.fillText(displayTitle, x, y - height/2 - 12 * DPR);
    
    // Отображение элементов списка (первые 3 элемента)
    if (checklist.items && checklist.items.length > 0) {
      const maxItems = Math.min(3, checklist.items.length);
      const itemHeight = 9 * DPR;
      const startY = y - height/2 + 25 * DPR;
      
      ctx.font = `${8 * DPR}px system-ui`;
      ctx.textAlign = "left";
      
      for (let i = 0; i < maxItems; i++) {
        const item = checklist.items[i];
        const itemY = startY + i * itemHeight;
        const checkboxX = x - width/2 + 10 * DPR;
        const textX = checkboxX + 14 * DPR;
        
        // Чекбокс с лучшим стилем
        ctx.fillStyle = item.completed ? baseColor : '#666666';
        ctx.font = `${10 * DPR}px system-ui`;
        ctx.fillText(item.completed ? '☑' : '☐', checkboxX, itemY);
        
        // Текст элемента с лучшим стилем
        ctx.fillStyle = item.completed ? '#888888' : '#222222';
        ctx.font = `${7 * DPR}px system-ui`;
        const text = item.text.length > 12 ? item.text.substring(0, 12) + '...' : item.text;
        ctx.fillText(text, textX, itemY);
      }
      
      // Показать количество элементов, если их больше 3
      if (checklist.items.length > 3) {
        ctx.fillStyle = baseColor;
        ctx.font = `bold ${7 * DPR}px system-ui`;
        ctx.textAlign = "center";
        ctx.fillText(`+${checklist.items.length - 3} еще`, x, startY + maxItems * itemHeight + 6 * DPR);
      }
    }
    
    // Добавляем интерактивность для всплывающего окна
    checklist._hover = false;
    checklist._hoverTime = 0;
    checklist._hoverTimeout = null;
    
    ctx.restore();
  });
}
