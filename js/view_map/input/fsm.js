// @ts-check
// view_map/input/fsm.js
// Non-breaking scaffold for future input FSM extraction

/**
 * Finite state machine for input handling.
 * This is a placeholder to be integrated gradually.
 */
const PHASE_IDLE = 'idle';
const PHASE_PRESS = 'press';
const PHASE_DRAG_OBJECT = 'drag-object';
const PHASE_PAN = 'pan';
const RESUME_ALT_DISTANCE = 16;

// Drag context for ghost preview (no state mutations during drag)
export const dragCtx = { 
  active: false, 
  id: null, 
  ghostX: 0, 
  ghostY: 0,
  startX: 0,
  startY: 0
};

function isAltOnly(e) {
  return e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey;
}

/**
 * @param {{
 *  canvas:HTMLCanvasElement,
 *  camera:{screenToWorld:(sx:number,sy:number)=>{x:number,y:number},translate:(dx:number,dy:number)=>void},
 *  hit:(wx:number, wy:number)=>any,
 *  onClick?:(pt:{x:number,y:number}, evt:PointerEvent)=>void,
 *  onDrag?:(target:any, wx:number, wy:number, evt:PointerEvent)=>void,
 *  onDragStart?:(target:any, offsetX:number, offsetY:number, evt:PointerEvent)=>boolean|void,
 *  onDragEnd?:(target:any, evt:PointerEvent)=>void,
 *  onPanStart?:(evt:PointerEvent)=>void,
 *  onPanMove?:(dx:number, dy:number, evt:PointerEvent)=>void,
 *  onPanEnd?:(evt:PointerEvent)=>void,
 *  onHover?:(evt:PointerEvent)=>void
 * }} deps
 */
export function createFSM({ canvas, camera, hit, onClick, onDrag, onDragStart, onDragEnd, onPanStart, onPanMove, onPanEnd, onHover }) {
  // RAF batching for pointermove
  let __dragRaf = 0, __lastEvt = null;
  
  const state = {
    phase: PHASE_IDLE,
    pointerId: /** @type {number|null} */ (null),
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    threshold: 10,
    target: null,
    dragOffsetX: 0,
    dragOffsetY: 0,
    altOnly: false,
    pendingResume: false,
  };

  function reset() {
    state.phase = PHASE_IDLE;
    state.pointerId = null;
    state.target = null;
    state.dragOffsetX = 0;
    state.dragOffsetY = 0;
    state.altOnly = false;
    state.pendingResume = false;
  }

  /** @param {PointerEvent} e */
  function pointerDown(e) {
    if (e.button !== 0) return; // only primary pointer
    state.altOnly = isAltOnly(e);
    state.phase = PHASE_PRESS;
    state.pointerId = e.pointerId;
    state.startX = state.lastX = e.clientX;
    state.startY = state.lastY = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    const rect = canvas.getBoundingClientRect();
    const hitPt = camera.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    const hitResult = hit(hitPt.x, hitPt.y);
    state.target = hitResult;
    if (hitResult && typeof hitResult === 'object' && 'x' in hitResult && 'y' in hitResult) {
      state.dragOffsetX = hitPt.x - hitResult.x;
      state.dragOffsetY = hitPt.y - hitResult.y;
      
      // Initialize drag context for ghost preview
      dragCtx.active = false;
      dragCtx.id = hitResult.id;
      dragCtx.ghostX = hitResult.x;
      dragCtx.ghostY = hitResult.y;
      dragCtx.startX = hitResult.x;
      dragCtx.startY = hitResult.y;
    }
    onHover?.(e);
  }

  /** @param {PointerEvent} e */
  function pointerMoveBatched(e) {
    __lastEvt = e;
    if (!__dragRaf) {
      __dragRaf = requestAnimationFrame(() => {
        __dragRaf = 0;
        const evt = __lastEvt; __lastEvt = null;
        // ВАЖНО: существующая логика перемещения
        pointerMoveCore(evt);
      });
    }
  }

  /** @param {PointerEvent} e */
  function pointerMoveCore(e) {
    onHover?.(e);
    if (state.phase === PHASE_IDLE) return;
    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;
    const distSq = dx * dx + dy * dy;
    const movedFar = distSq >= state.threshold * state.threshold;
    const altNow = isAltOnly(e);
    if (state.phase === PHASE_PRESS && state.target && !state.altOnly && altNow && distSq >= RESUME_ALT_DISTANCE) {
      state.altOnly = true;
      state.pendingResume = true;
    }
    const startDrag = state.target && state.altOnly && movedFar;
    if (state.phase === PHASE_PRESS) {
      if (startDrag) {
        state.phase = PHASE_DRAG_OBJECT;
        const allowed = onDragStart?.(state.target, state.dragOffsetX, state.dragOffsetY, e);
        if (allowed === false) {
          state.phase = PHASE_PAN;
          state.target = null;
          onPanStart?.(e);
        }
      } else if (movedFar) {
        state.phase = PHASE_PAN;
        state.target = null;
        onPanStart?.(e);
      }
    }
    if (state.phase === PHASE_PRESS && state.pendingResume && state.target && altNow && (dx !== 0 || dy !== 0)) {
      state.phase = PHASE_DRAG_OBJECT;
      state.pendingResume = false;
      const rect = canvas.getBoundingClientRect();
      const pt = camera.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      const worldX = pt.x - state.dragOffsetX;
      const worldY = pt.y - state.dragOffsetY;
      onDrag?.(state.target, worldX, worldY, e);
      state.lastX = e.clientX;
      state.lastY = e.clientY;
      return;
    }

    if (state.phase === PHASE_PAN) {
      const moveX = e.clientX - state.lastX;
      const moveY = e.clientY - state.lastY;
      if (moveX !== 0 || moveY !== 0) {
        if (onPanMove) onPanMove(moveX, moveY, e);
        else camera.translate(moveX, moveY);
      }
    } else if (state.phase === PHASE_DRAG_OBJECT && state.target) {
      const rect = canvas.getBoundingClientRect();
      const pt = camera.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      const worldX = pt.x - state.dragOffsetX;
      const worldY = pt.y - state.dragOffsetY;
      
      // Update drag context for ghost preview (NO state mutations)
      dragCtx.active = true;
      dragCtx.ghostX = worldX;
      dragCtx.ghostY = worldY;
      
      onDrag?.(state.target, worldX, worldY, e);
    }
    state.lastX = e.clientX;
    state.lastY = e.clientY;
  }

  /** @param {PointerEvent} e */
  function pointerUp(e) {
    if (state.pointerId !== null && e.pointerId !== state.pointerId) return;
    if (state.phase === PHASE_PRESS) {
      const rect = canvas.getBoundingClientRect();
      const pt = camera.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      onClick?.(pt, e);
    } else if (state.phase === PHASE_DRAG_OBJECT && state.target) {
      onDragEnd?.(state.target, e);
    } else if (state.phase === PHASE_PAN) {
      onPanEnd?.(e);
    }
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    
    // Commit drag changes to state (single commit on pointerup)
    if (dragCtx.active && dragCtx.id) {
      // This will be handled by the main view_map.js handleDragEnd
      // which will call state update functions
    }
    
    // Reset drag context
    dragCtx.active = false;
    dragCtx.id = null;
    
    reset();
  }

  /** @param {PointerEvent} e */
  function pointerCancel(e) {
    if (state.pointerId !== null && e.pointerId !== state.pointerId) return;
    if (state.phase === PHASE_DRAG_OBJECT && state.target) {
      onDragEnd?.(state.target, e);
    } else if (state.phase === PHASE_PAN) {
      onPanEnd?.(e);
    }
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    state.pointerId = null;
    state.phase = PHASE_IDLE;
  }

  /** @param {PointerEvent} e */
  function pointerLeave(e) {
    onHover?.(e);
  }

  return {
    pointerDown,
    pointerMove: pointerMoveBatched,
    pointerUp,
    pointerCancel,
    pointerLeave,
  };
}



