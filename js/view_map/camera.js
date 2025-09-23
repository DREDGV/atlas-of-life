// @ts-check
// view_map/camera.js
// Non-breaking scaffold for future camera extraction

/**
 * Create a simple camera abstraction.
 * This is a placeholder to be wired gradually without changing behavior.
 */
/**
 * @typedef {Object} Camera
 * @property {number} x
 * @property {number} y
 * @property {number} scale
 * @property {number} minScale
 * @property {number} maxScale
 * @property {(sx:number,sy:number)=>{x:number,y:number}} screenToWorld
 * @property {(wx:number,wy:number)=>{x:number,y:number}} worldToScreen
 * @property {(dx:number,dy:number)=>void} translate
 * @property {(factor:number,sx:number,sy:number)=>void} zoomAt
 * @property {(obj:{x?:number,y?:number})=>void} centerOn
 */

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {Camera}
 */
export function createCamera(canvas) {
  const cam = {
    x: 0,
    y: 0,
    scale: 1,
    minScale: 0.4,
    maxScale: 2
  };

  cam.screenToWorld = (sx, sy) => ({ x: sx / cam.scale + cam.x, y: sy / cam.scale + cam.y });
  cam.worldToScreen = (wx, wy) => ({ x: (wx - cam.x) * cam.scale, y: (wy - cam.y) * cam.scale });
  cam.translate = (dx, dy) => { cam.x += dx / cam.scale; cam.y += dy / cam.scale; };
  cam.zoomAt = (factor, sx, sy) => {
    // Keep point under cursor stable (scaffold only)
    const before = cam.screenToWorld(sx, sy);
    cam.scale = Math.min(cam.maxScale, Math.max(cam.minScale, cam.scale * factor));
    const after = cam.screenToWorld(sx, sy);
    cam.x += before.x - after.x;
    cam.y += before.y - after.y;
  };
  cam.centerOn = (obj) => {
    if (!obj) return;
    cam.x = (obj.x || 0) - (canvas?.width || 0) / (2 * cam.scale);
    cam.y = (obj.y || 0) - (canvas?.height || 0) / (2 * cam.scale);
  };
  return cam;
}


