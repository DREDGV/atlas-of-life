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
      const DPR = window.devicePixelRatio || 1;
      
      for (const node of nodes) {
        if (!node.visible) continue;
        
        const project = node.data;
        const screenPos = camera.worldToScreen(node.x, node.y);
        
        // Draw planet with gentle pulsing animation
        const time = performance.now() * 0.0008; // Очень медленная анимация
        const pulse = 1 + Math.sin(time) * 0.05; // Очень слабая пульсация
        const pulseRadius = node.r * pulse;
        
        // Use project ID as seed for unique shape and project color
        const seed = project.id ? project.id.split('').reduce((a, b) => a + b.charCodeAt(0), 0) : 0;
        const projectColor = project.color || "#7b68ee";
        
        // Original project rendering (M-02: Project Orbit)
        ctx.beginPath();
        ctx.fillStyle = projectColor;
        ctx.arc(screenPos.x, screenPos.y, pulseRadius, 0, Math.PI * 2);
        ctx.fill();
        
        // Thin border
        ctx.beginPath();
        ctx.strokeStyle = projectColor; // Simplified contrast color
        ctx.lineWidth = 1 * DPR;
        ctx.arc(screenPos.x, screenPos.y, pulseRadius, 0, Math.PI * 2);
        ctx.stroke();
        
        // Project title
        ctx.fillStyle = "#cde1ff";
        ctx.font = `${12 * DPR}px system-ui`;
        ctx.textAlign = "center";
        ctx.fillText(project.title, screenPos.x, screenPos.y - (node.r + 28 * DPR));
        
        // Визуальные индикаторы блокировок для проектов
        if (project.locks) {
          // Иконка замка для блокировки перемещения
          if (project.locks.move) {
            ctx.fillStyle = "#ff6b6b";
            ctx.font = `${10 * DPR}px system-ui`;
            ctx.textAlign = "center";
            ctx.fillText("🔒", screenPos.x + node.r - 6 * DPR, screenPos.y - node.r + 6 * DPR);
          }
        }
      }
    }
  };
}
