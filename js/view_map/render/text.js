// view_map/render/text.js
// Pure text helpers (initial scaffold)

/** Fit text to width by measured ellipsis. */
export function fitText(ctx, text, maxWidth) {
  if (!text) return '';
  let t = text;
  while (ctx.measureText(t).width > maxWidth && t.length > 1) {
    t = t.slice(0, -1);
  }
  return t.length < text.length ? t + '…' : t;
}


