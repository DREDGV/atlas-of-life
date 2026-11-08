// Shared visible boundary / pointer geometry. Projects have flat rooflines;
// domains have gently irregular shores. Both contain their original inner disk.
export function territoryRadius(node, angle) {
  return node.r * (1.07 + .045 * Math.sin(3 * angle + .4) + .025 * Math.cos(5 * angle));
}
export function projectRadius(node, dpr = 1) { return (node.r + 18 * dpr) / Math.cos(Math.PI / 6); }
export function projectPoints(node, dpr = 1, inset = 0) {
  const radius=projectRadius(node,dpr)-inset;
  return Array.from({length:6},(_,i)=>({x:node.x+Math.cos(i*Math.PI/3)*radius,y:node.y+Math.sin(i*Math.PI/3)*radius}));
}
export function containsTerritory(node,x,y,dpr=1){
  if(node._type==='domain')return Math.hypot(x-node.x,y-node.y)<=territoryRadius(node,Math.atan2(y-node.y,x-node.x));
  if(node._type==='project'){
    const points=projectPoints(node,dpr);
    return points.every((p,i)=>{const q=points[(i+1)%points.length];return (q.x-p.x)*(y-p.y)-(q.y-p.y)*(x-p.x)>=-0.001;});
  }
  return Math.hypot(x-node.x,y-node.y)<=node.r;
}
