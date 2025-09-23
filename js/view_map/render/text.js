// @ts-check
// view_map/render/text.js
// Pure text helpers (initial scaffold)

// Simple cached measurements + helpers used in legacy code
const cache = new Map();

/** @param {CanvasRenderingContext2D} ctx */
export function measureTextCached(ctx, text){
  const key = ctx.font + '|' + text;
  let w = cache.get(key);
  if (w == null){ w = ctx.measureText(String(text)).width; cache.set(key, w); }
  return w;
}

export function ellipsize(ctx, text, maxWidth){
  text = String(text);
  if (measureTextCached(ctx, text) <= maxWidth) return text;
  const ell='…', ellW=measureTextCached(ctx, ell);
  let lo=0, hi=text.length;
  while (lo<hi){
    const mid=(lo+hi+1)>>1;
    const w=measureTextCached(ctx, text.slice(0,mid)) + ellW;
    if (w<=maxWidth) lo=mid; else hi=mid-1;
  }
  return text.slice(0,lo)+ell;
}

export function wrapText(ctx, text, maxWidth){
  const words=String(text).split(/\s+/); const lines=[]; let line='';
  for (const w of words){
    const test=line? line+' '+w : w;
    if (measureTextCached(ctx,test) <= maxWidth) line=test;
    else { if (line) lines.push(line); line=w; }
  }
  if (line) lines.push(line);
  return lines;
}


