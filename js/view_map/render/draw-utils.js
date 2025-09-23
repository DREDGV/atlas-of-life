// @ts-check
// view_map/render/draw-utils.js
// Pure draw helpers (initial scaffold). Real functions will be migrated safely.

/** Clamp a number between min and max. */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Linear interpolation. */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Draw a circle stroke. */
export function strokeCircle(ctx, x, y, r, color = '#fff', width = 1) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Stroke a line */
export function strokeLine(ctx, x1, y1, x2, y2) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

/** Fill a circle */
export function fillCircle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Squared distance */
export function dist2(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return dx * dx + dy * dy;
}

/** Create rounded-rect path */
export function roundedRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min((r ?? 0), Math.abs(w) / 2, Math.abs(h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Colors */
export const rgba = (r, g, b, a = 1) => `rgba(${r|0},${g|0},${b|0},${+a})`;
export const withAlpha = (color, a = 1) => color.replace(/rgba?\([^)]*\)/, m => {
  const nums = m.match(/[\d.]+/g)?.map(Number) || [0, 0, 0, 1];
  const [r, g, b] = nums;
  return `rgba(${r|0},${g|0},${b|0},${+a})`;
});

/** Geometry helpers */
export const isPointInCircle = (px, py, cx, cy, r) => dist2(px, py, cx, cy) <= r * r;

/** Draw a simple arrow (screen-space) */
export function drawArrow(ctx, x1, y1, x2, y2, head = 8) {
  strokeLine(ctx, x1, y1, x2, y2);
  const a = Math.atan2(y2 - y1, x2 - x1);
  const x3 = x2 - head * Math.cos(a - Math.PI / 6);
  const y3 = y2 - head * Math.sin(a - Math.PI / 6);
  const x4 = x2 - head * Math.cos(a + Math.PI / 6);
  const y4 = y2 - head * Math.sin(a + Math.PI / 6);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.lineTo(x4, y4);
  ctx.closePath();
  ctx.fill();
}


