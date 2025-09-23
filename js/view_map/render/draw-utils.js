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


