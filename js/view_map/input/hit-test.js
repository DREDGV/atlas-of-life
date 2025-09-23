// view_map/input/hit-test.js
// Scaffold for hit-testing helpers. Real logic will be migrated step-by-step.

/**
 * Placeholder hit-test that can be enhanced later.
 * @param {{x:number,y:number,r?:number}} obj
 * @param {{x:number,y:number}} pt
 */
export function circleHit(obj, pt) {
  const dx = (obj.x || 0) - pt.x;
  const dy = (obj.y || 0) - pt.y;
  const r = obj.r || 12;
  return dx * dx + dy * dy <= r * r;
}


