// @ts-check
// view_map/camera.js
// Non-breaking scaffold for future camera extraction

/**
 * Create a camera abstraction wired to external view state (tx, ty, scale).
 * Coordinates API accepts CSS pixel inputs for screen space; DPR handled internally.
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
 * @param {{tx:number,ty:number,scale:number}} view
 * @returns {Camera}
 */
export function createCamera(canvas, view) {
  const cam = {
    x: 0,
    y: 0,
    scale: () => view.scale,
    minScale: 0.5,
    maxScale: 2.2,
  };

  cam.screenToWorld = (sx, sy) => {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const cx = sx * dpr;
    const cy = sy * dpr;
    const inv = 1 / view.scale;
    return { x: (cx - view.tx) * inv, y: (cy - view.ty) * inv };
  };

  cam.worldToScreen = (wx, wy) => {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const cx = wx * view.scale + view.tx;
    const cy = wy * view.scale + view.ty;
    return { x: cx / dpr, y: cy / dpr };
  };

  cam.translate = (dxScreen, dyScreen) => {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    view.tx += dxScreen * dpr;
    view.ty += dyScreen * dpr;
  };

  cam.zoomAt = (factor, sx, sy) => {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const cx = sx * dpr;
    const cy = sy * dpr;
    const old = view.scale;
    const next = Math.min(cam.maxScale, Math.max(cam.minScale, old * factor));
    const invOld = 1 / old;
    const wx = (cx - view.tx) * invOld;
    const wy = (cy - view.ty) * invOld;
    view.scale = next;
    view.tx = cx - wx * next;
    view.ty = cy - wy * next;
  };

  cam.centerOn = (obj) => {
    if (!obj) return;
    const W = canvas?.width || 0;
    const H = canvas?.height || 0;
    view.tx = W * 0.5 - (obj.x || 0) * view.scale;
    view.ty = H * 0.5 - (obj.y || 0) * view.scale;
  };

  return cam;
}


