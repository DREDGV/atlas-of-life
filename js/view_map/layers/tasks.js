// @ts-check
// view_map/layers/tasks.js
// Task rendering layer

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
 * Create task rendering layer
 * @returns {RenderLayer}
 */
export function createTaskLayer() {
  return {
    name: 'task',
    enabled: true,
    render: (ctx, nodes, camera) => {
      for (const node of nodes) {
        if (!node.visible) continue;
        
        const task = node.data;
        const screenPos = camera.worldToScreen(node.x, node.y);
        
        // Task circle
        ctx.fillStyle = task.color || '#F5A623';
        ctx.beginPath();
        ctx.arc(screenPos.x, screenPos.y, node.r, 0, Math.PI * 2);
        ctx.fill();
        
        // Task border
        ctx.strokeStyle = '#D68910';
        ctx.lineWidth = 1;
        ctx.stroke();
        
        // Task label
        if (task.name) {
          ctx.fillStyle = '#FFFFFF';
          ctx.font = '10px Arial';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(task.name, screenPos.x, screenPos.y);
        }
        
        // Priority indicator
        if (task.priority) {
          const priorityColors = {
            p1: '#FF0000',
            p2: '#FF8000',
            p3: '#FFFF00',
            p4: '#00FF00'
          };
          
          ctx.fillStyle = priorityColors[task.priority] || '#FFFFFF';
          ctx.beginPath();
          ctx.arc(screenPos.x + node.r - 4, screenPos.y - node.r + 4, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  };
}
