import assert from 'node:assert/strict';
import { containsTerritory, projectPoints, projectRadius, territoryRadius } from '../js/features/map/geometry.js';
const p={id:'p',_type:'project',x:20,y:40,r:80};
for(const dpr of [1,2]){
  assert(containsTerritory(p,p.x,p.y,dpr));
  for(const point of projectPoints(p,dpr))assert(containsTerritory(p,point.x,point.y,dpr),'every drawn vertex is clickable');
  assert(!containsTerritory(p,p.x+projectRadius(p,dpr)+2,p.y,dpr));
  for(let i=0;i<72;i++){
    const a=i*Math.PI/36;
    assert(containsTerritory(p,p.x+Math.cos(a)*p.r,p.y+Math.sin(a)*p.r,dpr),'task disk stays inside project');
  }
}
const d={...p,_type:'domain'};
for(let i=0;i<72;i++){
  const a=i*Math.PI/36, r=territoryRadius(d,a);
  assert(r>=d.r-1e-8);
  assert(containsTerritory(d,d.x+Math.cos(a)*(r-.1),d.y+Math.sin(a)*(r-.1)));
  assert(!containsTerritory(d,d.x+Math.cos(a)*(r+.1),d.y+Math.sin(a)*(r+.1)));
}
console.log('PASS scene geometry: drawn boundaries match hit regions; project contains tasks at both DPRs');
