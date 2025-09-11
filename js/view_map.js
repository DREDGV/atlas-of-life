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
import { saveState } from "./storage.js";
import { logEvent } from "./utils/analytics.js";

let canvas,
  tooltip,
  ctx,
  W = 0,
  H = 0,
  DPR = 1;
let nodes = [],
  edges = [];
let hoverNodeId = null;
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
try { window.setProjectVisualStyle = setProjectVisualStyle; } catch (_) {}

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
  initStarField();
  
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
    initStarField();
    try { fitAll(); } catch(_) {}
  });
  canvas.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mouseup", () => (viewState.dragging = false));
  canvas.addEventListener("mouseleave", onMouseLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("click", onClick);
  canvas.addEventListener("dblclick", onDblClick);
  canvas.addEventListener("contextmenu", onContextMenu);
  layoutMap();
  drawMap();
  // Автоматически подгоняем вид под все объекты при инициализации
  setTimeout(() => {
    try { fitAll(); } catch(_) {}
  }, 100);
  
  // Start cosmic animation loop
  startCosmicAnimationLoop();
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
  // Prevent recursive layout calls
  if (isLayouting) {
    return;
  }
  isLayouting = true;
  
  nodes = [];
  edges = [];
  const domains = state.activeDomain
    ? state.domains.filter((d) => d.id === state.activeDomain)
    : state.domains.slice();
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
    nodes.push({
      _type: "domain",
      id: d.id,
      title: d.title,
      x,
      y,
      r: domainRadius,
      color,
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

  // Cosmic starfield with twinkling stars
  drawStarfield(ctx, W, H, viewState);
  
  // Render cosmic effects (particles, animations)
  if (window.cosmicAnimations) {
    window.cosmicAnimations.render();
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
      if (!inView(n.x, n.y, n.r + 30 * DPR)) return;
      
      // Draw nebula with style support
      if (projectVisualStyle === 'original') {
        // Original domain drawing from v0.2.7.5
      const grad = ctx.createRadialGradient(n.x, n.y, n.r * 0.3, n.x, n.y, n.r);
      grad.addColorStop(0, n.color + "33");
      grad.addColorStop(1, "#0000");
      ctx.beginPath();
      ctx.fillStyle = grad;
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fill();
        ctx.beginPath();
        ctx.strokeStyle = n.color;
        ctx.lineWidth = 1.2 * DPR;
        ctx.setLineDash([4 * DPR, 4 * DPR]);
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (projectVisualStyle === 'neon') {
        drawNeonStyle(ctx, n.x, n.y, n.r, n.color, 'domain');
      } else if (projectVisualStyle === 'tech') {
        drawTechStyle(ctx, n.x, n.y, n.r, n.color, 'domain');
      } else if (projectVisualStyle === 'minimal') {
        drawMinimalStyle(ctx, n.x, n.y, n.r, n.color, 'domain');
      } else if (projectVisualStyle === 'holographic') {
        drawHolographicStyle(ctx, n.x, n.y, n.r, n.color, 'domain');
      } else if (projectVisualStyle === 'gradient') {
        drawGradientStyle(ctx, n.x, n.y, n.r, n.color, 'domain');
      } else if (projectVisualStyle === 'mixed') {
        drawMixedStyle(ctx, n.x, n.y, n.r, n.color, 'domain');
      } else {
        drawPlanet(ctx, n.x, n.y, n.r, n.color, 'nebula');
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
    });

  // projects as planets
  nodes
    .filter((n) => n._type === "project")
    .forEach((n) => {
      if (!inView(n.x, n.y, n.r + 30 * DPR)) return;
      
      // Draw planet with gentle pulsing animation
      const time = performance.now() * 0.0008; // Очень медленная анимация
      const pulse = 1 + Math.sin(time) * 0.05; // Очень слабая пульсация
      const pulseRadius = n.r * pulse;
      
      // Use project ID as seed for unique shape and project color
      const seed = n.id ? n.id.split('').reduce((a, b) => a + b.charCodeAt(0), 0) : 0;
      const projectColor = n.color || "#7b68ee";
      
      // Choose visualization style based on settings
      if (projectVisualStyle === 'original') {
        // Original project drawing from v0.2.7.5
        ctx.beginPath();
        ctx.strokeStyle = "#1d2b4a";
        ctx.lineWidth = 1 * DPR;
        ctx.arc(n.x, n.y, pulseRadius + 18 * DPR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.fillStyle = "#8ab4ff";
        ctx.arc(n.x, n.y, 6 * DPR, 0, Math.PI * 2);
        ctx.fill();
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
        drawGalaxy(ctx, n.x, n.y, pulseRadius, projectColor, seed);
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
        const projectColor = draggedNode.color || "#7b68ee";
        
        // Choose visualization style based on settings
        if (projectVisualStyle === 'original') {
          // Original project drawing from v0.2.7.5
          ctx.beginPath();
          ctx.strokeStyle = "#1d2b4a";
          ctx.lineWidth = 1 * DPR;
          ctx.arc(draggedNode.x, draggedNode.y, draggedNode.r + 18 * DPR, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.fillStyle = "#8ab4ff";
          ctx.arc(draggedNode.x, draggedNode.y, 6 * DPR, 0, Math.PI * 2);
          ctx.fill();
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
  nodes
    .filter((n) => n._type === "task")
    .forEach((n) => {
      if (!inView(n.x, n.y, n.r + 20 * DPR)) return;
      const t = state.tasks.find((x) => x.id === n.id);
      
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
        // Original task drawing from v0.2.7.5
      if (state.showAging) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r + 3 * DPR, 0, Math.PI * 2);
        ctx.strokeStyle = colorByAging(n.aging);
        ctx.lineWidth = 2 * DPR;
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
      ctx.fill();
      ctx.shadowBlur = 0;
        if (n.status === "today") {
          ctx.beginPath();
          ctx.strokeStyle = "#f59e0b";
          ctx.lineWidth = 1 * DPR;
          ctx.arc(n.x, n.y, n.r + 6 * DPR, 0, Math.PI * 2);
          ctx.stroke();
        }
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
        drawTaskModern(ctx, n.x, n.y, n.r, baseColor, n.status);
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
      
      // Today highlight
      if (n.status === "today") {
        ctx.beginPath();
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = 1 * DPR;
        ctx.arc(n.x, n.y, n.r + 6 * DPR, 0, Math.PI * 2);
        ctx.stroke();
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
    tooltip.innerHTML = `🌌 Домен: <b>${d.title}</b>`;
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

function onMouseDown(e) {
  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    viewState.dragging = true;
    viewState.lastX = e.clientX;
    viewState.lastY = e.clientY;
    return;
  }
  // DnD: захват задачи или проекта
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
        toast.className = "toast attach";
        toast.innerHTML = `Привязать задачу к проекту? <button id="attachOk">Привязать</button> <button id="attachCancel">Отменить</button>`;
        toast.style.display = "block";
        toast.style.opacity = "1";
        
        // Position toast near the dragged task
        positionToastNearAction(draggedNode.x, draggedNode.y, toast);
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
              toast.className = "toast attach";
              toast.innerHTML = `Переместить проект "${p.title}" из домена "${currentDomain}" в домен "${newDomain}"? <button id="projectMoveOk">Переместить</button> <button id="projectMoveCancel">Отменить</button>`;
              toast.style.display = "block !important";
              toast.style.opacity = "1 !important";
              toast.style.zIndex = "1000 !important";
              toast.style.visibility = "visible !important";
              console.log("Project move toast - displayed:", toast.style.display, "opacity:", toast.style.opacity);
              
              // Position toast near the dragged project
              positionToastNearAction(draggedNode.x, draggedNode.y, toast);
              
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
                const ok = document.getElementById("projectMoveOk");
                const cancel = document.getElementById("projectMoveCancel");
                if (ok) {
                  ok.onclick = () => {
                    confirmProjectMove();
                  };
                }
                if (cancel) {
                  cancel.onclick = () => {
                    pendingProjectMove = null;
                    toast.style.display = "none";
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
              toast.className = "toast ok";
              toast.textContent = `Позиция проекта "${p.title}" в домене "${targetDomain.title}" обновлена`;
              toast.style.display = "block";
              toast.style.opacity = "1";
              
              // Position toast near the dragged project
              positionToastNearAction(draggedNode.x, draggedNode.y, toast);
              
              setTimeout(() => {
                toast.style.transition = "opacity .3s linear";
                toast.style.opacity = "0";
                setTimeout(() => {
                  toast.style.display = "none";
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
              toast.className = "toast detach";
              toast.innerHTML = `Извлечь проект "${p.title}" из домена "${currentDomain}" и сделать его независимым? <button id="projectExtractOk">Извлечь</button> <button id="projectExtractCancel">Отменить</button>`;
              toast.style.display = "block !important";
              toast.style.opacity = "1 !important";
              toast.style.zIndex = "1000 !important";
              toast.style.visibility = "visible !important";
              console.log("Project extract toast - displayed:", toast.style.display, "opacity:", toast.style.opacity);
              
              // Position toast near the dragged project
              positionToastNearAction(draggedNode.x, draggedNode.y, toast);
              
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
                    toast.style.display = "none";
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
          toast.className = "toast ok";
          toast.textContent = "Задача прикреплена к домену";
          toast.style.display = "block";
          toast.style.opacity = "1";
          
          // Position toast near the dragged task
          positionToastNearAction(draggedNode.x, draggedNode.y, toast);
          
          setTimeout(() => {
            toast.style.transition = "opacity .3s linear";
            toast.style.opacity = "0";
            setTimeout(() => {
              toast.style.display = "none";
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
            positionToastNearAction(draggedNode.x, draggedNode.y, toast);
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
        toast.className = "toast ok";
        toast.textContent = "Позиция задачи обновлена";
        toast.style.display = "block";
        toast.style.opacity = "1";
        
        // Position toast near the dragged task
        positionToastNearAction(draggedNode.x, draggedNode.y, toast);
        
        setTimeout(() => {
          toast.style.transition = "opacity .3s linear";
          toast.style.opacity = "0";
          setTimeout(() => {
            toast.style.display = "none";
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
          toast.className = "toast ok";
          toast.textContent = "Позиция независимого проекта обновлена";
          toast.style.display = "block";
          toast.style.opacity = "1";
          
          // Position toast near the dragged project
          positionToastNearAction(draggedNode.x, draggedNode.y, toast);
          
          setTimeout(() => {
            toast.style.transition = "opacity .3s linear";
            toast.style.opacity = "0";
            setTimeout(() => {
              toast.style.display = "none";
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
    
    // Show success toast
    const toast = document.getElementById("toast");
    if (toast) {
      toast.className = "toast ok";
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
          toast.style.display = "none";
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
      toast.className = "toast error";
      toast.textContent = "Ошибка при перемещении проекта";
      setTimeout(() => { toast.style.display = "none"; }, 1400);
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

function openMoveTaskModal(task, targetDomainId, worldX, worldY) {
  const projs = state.projects.filter((p) => p.domainId === targetDomainId);
  const domTitle = state.domains.find((d) => d.id === targetDomainId)?.title || "";
  
  // Create a more compact toast-based interface instead of modal
  const toast = document.getElementById("toast");
  if (toast) {
  const options = [`<option value="__indep__">Оставить независимой</option>`]
    .concat(projs.map((p) => `<option value="${p.id}">${p.title}</option>`))
    .join("");
    
    toast.className = "toast attach";
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
      positionToastNearAction(worldX, worldY, toast);
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
        toast.className = "toast ok";
          toast.innerHTML = "Задача перемещена";
        toast.style.display = "block";
        toast.style.opacity = "1";
          
        setTimeout(() => {
            toast.style.transition = "opacity .3s linear";
          toast.style.opacity = "0";
          setTimeout(() => {
            toast.style.display = "none";
            toast.style.transition = "";
          }, 320);
        }, 1400);
          
      layoutMap();
      drawMap();
        };
      }
      
      if (cancel) {
        cancel.onclick = () => {
          toast.style.display = "none";
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
  const pt = screenToWorld(e.offsetX, e.offsetY);
  const n = hit(pt.x, pt.y);
  if (!n) {
    // click on empty space: show all domains
    state.activeDomain = null;
    layoutMap();
    drawMap();
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
    openInspectorFor(obj);
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
