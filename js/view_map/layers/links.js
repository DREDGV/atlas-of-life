// @ts-check
// view_map/layers/links.js
// Link rendering layer

/**
 * @typedef {Object} SceneNode
 * @property {string} id
 * @property {string} type
 * @property {number} x
 * @property {number} y
 * @property {number} r
 * @property {Object} data
 * @property {boolean} visible
 * @property {number} zIndex
 */

/**
 * @typedef {Object} Camera
 * @property {(sx:number,sy:number)=>{x:number,y:number}} screenToWorld
 * @property {(wx:number,wy:number)=>{x:number,y:number}} worldToScreen
 */

/**
 * Create link rendering layer
 * @returns {RenderLayer}
 */
export function createLinkLayer() {
  return {
    name: 'link',
    enabled: true,
    render: (ctx, nodes, camera) => {
      for (const node of nodes) {
        if (!node.visible) continue;
        
        const link = node.data;
        const screenPos = camera.worldToScreen(node.x, node.y);
        
        // Link line (if has source and target)
        if (link.sourceId && link.targetId) {
          // This would need access to source/target positions
          // For now, just draw a simple line
          ctx.strokeStyle = link.color || '#CCCCCC';
          ctx.lineWidth = 1;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.moveTo(screenPos.x - 20, screenPos.y);
          ctx.lineTo(screenPos.x + 20, screenPos.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }
  };
}
