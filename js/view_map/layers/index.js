// @ts-check
// view_map/layers/index.js
// Rendering layers for different object types

import { createDomainLayer } from './domains.js';
import { createProjectLayer } from './projects.js';
import { createTaskLayer } from './tasks.js';
import { createLinkLayer } from './links.js';

/**
 * @typedef {Object} RenderLayer
 * @property {string} name
 * @property {(ctx: CanvasRenderingContext2D, nodes: SceneNode[], camera: Camera) => void} render
 * @property {boolean} enabled
 */

/**
 * Create all rendering layers
 * @returns {RenderLayer[]}
 */
export function createRenderLayers() {
  return [
    createDomainLayer(),
    createProjectLayer(),
    createTaskLayer(),
    createLinkLayer()
  ];
}

/**
 * Render all layers
 * @param {CanvasRenderingContext2D} ctx
 * @param {SceneNode[]} nodes
 * @param {Camera} camera
 * @param {RenderLayer[]} layers
 */
export function renderLayers(ctx, nodes, camera, layers) {
  // Group nodes by type for efficient rendering
  const nodesByType = new Map();
  for (const node of nodes) {
    if (!nodesByType.has(node.type)) {
      nodesByType.set(node.type, []);
    }
    nodesByType.get(node.type).push(node);
  }

  // Render each layer
  for (const layer of layers) {
    if (!layer.enabled) continue;
    
    const typeNodes = nodesByType.get(layer.name) || [];
    if (typeNodes.length > 0) {
      layer.render(ctx, typeNodes, camera);
    }
  }
}
