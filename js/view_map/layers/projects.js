// @ts-check
// view_map/layers/projects.js
// Project rendering layer

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
 * Create project rendering layer
 * @returns {RenderLayer}
 */
export function createProjectLayer() {
  return {
    name: 'project',
    enabled: true,
    render: (ctx, nodes, camera) => {
      for (const node of nodes) {
        if (!node.visible) continue;
        
        const project = node.data;
        const screenPos = camera.worldToScreen(node.x, node.y);
        
        // Project rectangle
        const width = 80;
        const height = 40;
        const x = screenPos.x - width / 2;
        const y = screenPos.y - height / 2;
        
        ctx.fillStyle = project.color || '#7ED321';
        ctx.fillRect(x, y, width, height);
        
        // Project border
        ctx.strokeStyle = '#5BA317';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, width, height);
        
        // Project label
        if (project.name) {
          ctx.fillStyle = '#FFFFFF';
          ctx.font = '11px Arial';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(project.name, screenPos.x, screenPos.y);
        }
      }
    }
  };
}
