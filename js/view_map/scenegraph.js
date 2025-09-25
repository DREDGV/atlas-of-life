// @ts-check
// view_map/scenegraph.js
// Scenegraph for efficient hit-testing and rendering layers

/**
 * @typedef {Object} SceneNode
 * @property {string} id
 * @property {string} type - 'domain' | 'project' | 'task' | 'link'
 * @property {number} x
 * @property {number} y
 * @property {number} r - radius
 * @property {Object} data - original object data
 * @property {boolean} visible
 * @property {number} zIndex - rendering order
 */

/**
 * @typedef {Object} Scenegraph
 * @property {Map<string, SceneNode>} nodes
 * @property {Map<string, SceneNode[]>} byType
 * @property {boolean} dirty
 * @property {() => void} rebuild
 * @property {(id: string) => SceneNode | null} getNode
 * @property {(type: string) => SceneNode[]} getByType
 * @property {(x: number, y: number, radius?: number) => SceneNode[]} hitTest
 * @property {(viewport: {x: number, y: number, scale: number, width: number, height: number}) => SceneNode[]} getVisible
 */

/**
 * Create a scenegraph for efficient hit-testing and rendering
 * @param {Object} eventManager - Event manager with getAllObjects method
 * @returns {Scenegraph}
 */
export function createScenegraph(eventManager) {
  const nodes = new Map();
  const byType = new Map();
  let dirty = true;

  /**
   * Rebuild the scenegraph from current state
   */
  function rebuild() {
    nodes.clear();
    byType.clear();
    
    const objects = eventManager.getAllObjects();
    
    for (const obj of objects) {
      const node = {
        id: obj.id,
        type: obj.type || 'task',
        x: obj.x || 0,
        y: obj.y || 0,
        r: obj.r || 12,
        data: obj,
        visible: true,
        zIndex: getZIndex(obj.type)
      };
      
      nodes.set(obj.id, node);
      
      if (!byType.has(node.type)) {
        byType.set(node.type, []);
      }
      byType.get(node.type).push(node);
    }
    
    // Sort by zIndex for rendering order
    for (const [type, typeNodes] of byType) {
      typeNodes.sort((a, b) => a.zIndex - b.zIndex);
    }
    
    dirty = false;
  }

  /**
   * Get z-index for rendering order
   * @param {string} type
   * @returns {number}
   */
  function getZIndex(type) {
    switch (type) {
      case 'domain': return 1;
      case 'project': return 2;
      case 'task': return 3;
      case 'link': return 4;
      default: return 5;
    }
  }

  /**
   * Get node by ID
   * @param {string} id
   * @returns {SceneNode | null}
   */
  function getNode(id) {
    if (dirty) rebuild();
    return nodes.get(id) || null;
  }

  /**
   * Get all nodes of a specific type
   * @param {string} type
   * @returns {SceneNode[]}
   */
  function getByType(type) {
    if (dirty) rebuild();
    return byType.get(type) || [];
  }

  /**
   * Hit test at world coordinates
   * @param {number} x
   * @param {number} y
   * @param {number} radius - search radius (default: 12)
   * @returns {SceneNode[]}
   */
  function hitTest(x, y, radius = 12) {
    if (dirty) rebuild();
    
    const results = [];
    const radiusSq = radius * radius;
    
    for (const node of nodes.values()) {
      if (!node.visible) continue;
      
      const dx = node.x - x;
      const dy = node.y - y;
      const distSq = dx * dx + dy * dy;
      
      if (distSq <= radiusSq) {
        results.push(node);
      }
    }
    
    // Sort by distance (closest first)
    results.sort((a, b) => {
      const distA = Math.sqrt((a.x - x) ** 2 + (a.y - y) ** 2);
      const distB = Math.sqrt((b.x - x) ** 2 + (b.y - y) ** 2);
      return distA - distB;
    });
    
    return results;
  }

  /**
   * Get visible nodes in viewport
   * @param {Object} viewport
   * @param {number} viewport.x
   * @param {number} viewport.y
   * @param {number} viewport.scale
   * @param {number} viewport.width
   * @param {number} viewport.height
   * @returns {SceneNode[]}
   */
  function getVisible(viewport) {
    if (dirty) rebuild();
    
    const { x, y, scale, width, height } = viewport;
    const margin = 50; // Extra margin for objects partially visible
    
    const visible = [];
    for (const node of nodes.values()) {
      if (!node.visible) continue;
      
      // Convert world coords to screen coords
      const screenX = (node.x - x) * scale;
      const screenY = (node.y - y) * scale;
      
      // Check if node is in viewport (with margin)
      if (screenX >= -margin && screenX <= width + margin &&
          screenY >= -margin && screenY <= height + margin) {
        visible.push(node);
      }
    }
    
    // Sort by zIndex for rendering
    visible.sort((a, b) => a.zIndex - b.zIndex);
    
    return visible;
  }

  /**
   * Mark scenegraph as dirty (needs rebuild)
   */
  function markDirty() {
    dirty = true;
  }

  return {
    nodes,
    byType,
    dirty,
    rebuild,
    getNode,
    getByType,
    hitTest,
    getVisible,
    markDirty
  };
}
