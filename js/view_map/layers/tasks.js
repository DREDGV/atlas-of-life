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
      const DPR = window.devicePixelRatio || 1;
      
      for (const node of nodes) {
        if (!node.visible) continue;
        
        const task = node.data;
        const screenPos = camera.worldToScreen(node.x, node.y);
        
        // Task colors based on status
        const taskColors = {
          "done": "#6b7280",
          "today": "#ffd166", 
          "doing": "#60a5fa",
          "backlog": "#9ca3af"
        };
        const baseColor = taskColors[task.status] || taskColors["backlog"];
        
        // Dynamic pulsing effect for active tasks
        const time = performance.now() * 0.002;
        const pulseIntensity = task.status === 'doing' ? 1 + Math.sin(time * 2) * 0.15 : 1;
        const pulseRadius = node.r * pulseIntensity;
        
        // Enhanced gradient with multiple color stops
        const gradient = ctx.createRadialGradient(screenPos.x - node.r/2, screenPos.y - node.r/2, 0, screenPos.x, screenPos.y, pulseRadius);
        gradient.addColorStop(0, baseColor + "FF");
        gradient.addColorStop(0.2, baseColor + "EE");
        gradient.addColorStop(0.4, baseColor + "CC");
        gradient.addColorStop(0.7, baseColor + "99");
        gradient.addColorStop(1, baseColor + "66");
        
        // Outer energy ring for active tasks
        if (task.status === 'doing' || task.status === 'today') {
          ctx.shadowColor = baseColor;
          ctx.shadowBlur = 8 * DPR * pulseIntensity;
          ctx.strokeStyle = baseColor + "60";
          ctx.lineWidth = 2 * DPR;
          ctx.beginPath();
          ctx.arc(screenPos.x, screenPos.y, pulseRadius + 4 * DPR, 0, Math.PI * 2);
          ctx.stroke();
          ctx.shadowBlur = 0;
        }
        
        // Main task circle
        ctx.beginPath();
        ctx.fillStyle = gradient;
        ctx.arc(screenPos.x, screenPos.y, pulseRadius, 0, Math.PI * 2);
        ctx.fill();
        
        // Inner highlight for 3D effect
        const innerGradient = ctx.createRadialGradient(screenPos.x - node.r/3, screenPos.y - node.r/3, 0, screenPos.x, screenPos.y, node.r * 0.6);
        innerGradient.addColorStop(0, "#ffffff40");
        innerGradient.addColorStop(1, "#00000000");
        
        ctx.beginPath();
        ctx.fillStyle = innerGradient;
        ctx.arc(screenPos.x, screenPos.y, node.r * 0.6, 0, Math.PI * 2);
        ctx.fill();
        
        // Border with contrast color
        ctx.beginPath();
        ctx.strokeStyle = baseColor; // Simplified contrast color
        ctx.lineWidth = 1.5 * DPR;
        ctx.arc(screenPos.x, screenPos.y, pulseRadius, 0, Math.PI * 2);
        ctx.stroke();
        
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
