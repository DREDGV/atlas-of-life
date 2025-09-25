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
      const DPR = window.devicePixelRatio || 1;
      
      for (const node of nodes) {
        if (!node.visible) continue;
        
        const domain = node.data;
        const screenPos = camera.worldToScreen(node.x, node.y);
        
        // Используем mood цвет вместо обычного цвета домена
        const domainColor = domain.moodColor || domain.color;
        
        // Draw nebula with mood-based effects
        const grad = ctx.createRadialGradient(screenPos.x, screenPos.y, node.r * 0.3, screenPos.x, screenPos.y, node.r);
        grad.addColorStop(0, domainColor + "33");
        grad.addColorStop(1, "#0000");
        ctx.beginPath();
        ctx.fillStyle = grad;
        ctx.arc(screenPos.x, screenPos.y, node.r, 0, Math.PI * 2);
        ctx.fill();
        
        // Mood-based border effects
        ctx.beginPath();
        ctx.strokeStyle = domainColor;
        ctx.lineWidth = 1.2 * DPR;
        
        // Different dash patterns based on mood
        if (domain.mood === 'crisis') {
          ctx.setLineDash([2 * DPR, 2 * DPR]); // Fast blinking for crisis
        } else if (domain.mood === 'pressure') {
          ctx.setLineDash([4 * DPR, 2 * DPR]); // Uneven pattern for pressure
        } else if (domain.mood === 'growth') {
          ctx.setLineDash([6 * DPR, 2 * DPR]); // Growing pattern for growth
        } else {
          ctx.setLineDash([4 * DPR, 4 * DPR]); // Steady pattern for balance
        }
        
        ctx.arc(screenPos.x, screenPos.y, node.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Add mood indicator ring
        if (domain.mood !== 'balance') {
          ctx.beginPath();
          ctx.strokeStyle = domainColor + "80";
          ctx.lineWidth = 3 * DPR;
          ctx.arc(screenPos.x, screenPos.y, node.r + 8 * DPR, 0, Math.PI * 2);
          ctx.stroke();
        }
        
        // Domain title
        ctx.fillStyle = "#cfe8ff";
        ctx.font = `${14 * DPR}px system-ui`;
        ctx.textAlign = "center";
        ctx.fillText(domain.title, screenPos.x, screenPos.y - node.r - 8 * DPR);
        
        // Визуальные индикаторы блокировок
        if (domain.locks) {
          // Иконка замка для блокировки перемещения
          if (domain.locks.move) {
            ctx.fillStyle = "#ff6b6b";
            ctx.font = `${12 * DPR}px system-ui`;
            ctx.textAlign = "center";
            ctx.fillText("🔒", screenPos.x + node.r - 8 * DPR, screenPos.y - node.r + 8 * DPR);
          }
        }
      }
    }
  };
}
