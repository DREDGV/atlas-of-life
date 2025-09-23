// @ts-check
// view_map/input/fsm.js
// Non-breaking scaffold for future input FSM extraction

/**
 * Finite state machine for input handling.
 * This is a placeholder to be integrated gradually.
 */
/**
 * @param {{canvas:HTMLCanvasElement,camera:any,state:any}} param0
 */
export function createFSM({ canvas, camera, state }) {
  const mouse = {
    phase: 'idle',
    startX: 0, startY: 0,
    lastX: 0, lastY: 0,
    threshold: 10,
    target: null,
    offX: 0, offY: 0
  };

  function onMouseDown(e) {
    if (e.button !== 0) return;
    mouse.startX = e.clientX; mouse.startY = e.clientY;
    mouse.lastX = e.clientX; mouse.lastY = e.clientY;
    mouse.phase = 'press';
  }

  function onMouseMove(e) {
    if (mouse.phase === 'idle') return;
    const dx = e.clientX - mouse.startX;
    const dy = e.clientY - mouse.startY;
    if (mouse.phase === 'press' && (Math.abs(dx) + Math.abs(dy)) >= mouse.threshold) {
      // For now treat as pan; detailed logic will be added later
      mouse.phase = 'pan';
    }
    if (mouse.phase === 'pan') {
      camera.translate(mouse.lastX - e.clientX, mouse.lastY - e.clientY);
    }
    mouse.lastX = e.clientX; mouse.lastY = e.clientY;
  }

  function onMouseUp() {
    mouse.phase = 'idle';
  }

  return { onMouseDown, onMouseMove, onMouseUp };
}


