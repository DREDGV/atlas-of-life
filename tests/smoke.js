// Minimal smoke test: mount legacy map and ensure canvas updates
import { initMap, layoutMap, drawMap } from '../js/view_map.js';

const canvas = document.getElementById('canvas');
const tooltip = document.getElementById('tooltip');

initMap(canvas, tooltip);

requestAnimationFrame(() => {
  layoutMap();
  drawMap();
  requestAnimationFrame(() => {
    const ctx = canvas.getContext('2d');
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const nonZero = pixels.some((v) => v !== 0);
    console.log('[SMOKE]', nonZero ? 'Canvas has content' : 'Canvas empty');
  });
});


