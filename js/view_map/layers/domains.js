// @ts-check
// view_map/layers/domains.js
// Domain rendering layer

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
 * Create domain rendering layer
 * @returns {RenderLayer}
 */
export function createDomainLayer() {
  return {
    name: 'domain',
    enabled: true,
    render: (ctx, nodes, camera) => {
      for (const node of nodes) {
        if (!node.visible) continue;
        
        const domain = node.data;
        const screenPos = camera.worldToScreen(node.x, node.y);
        
        // Domain circle
        ctx.fillStyle = domain.color || '#4A90E2';
        ctx.beginPath();
        ctx.arc(screenPos.x, screenPos.y, node.r, 0, Math.PI * 2);
        ctx.fill();
        
        // Domain border
        ctx.strokeStyle = '#2C5AA0';
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // Domain label
        if (domain.name) {
          ctx.fillStyle = '#FFFFFF';
          ctx.font = '12px Arial';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(domain.name, screenPos.x, screenPos.y);
        }
      }
    }
  };
}
