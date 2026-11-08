export const PROJECTS_PER_PAGE=18;
export const DOMAIN_RADIUS=900;
export const PROJECT_RADIUS=105;
export const domainPages=new Map(); // ephemeral navigation only
export let revealedTaskId=null;
export function revealTask(id){revealedTaskId=id;}
export function gridAddress(slot){
  if(!slot)return {x:0,y:0};
  const ring=Math.ceil((Math.sqrt(slot+1)-1)/2),side=2*ring;
  let distance=(2*ring+1)**2-1-slot,x,y;
  if(distance<side){x=ring-distance;y=-ring;}
  else if(distance<2*side){x=-ring;y=-ring+distance-side;}
  else if(distance<3*side){x=-ring+distance-2*side;y=ring;}
  else{x=ring;y=ring-(distance-3*side);}
  return {x:x*2200,y:y*2200};
}
export function childAddress(slot){
  if(slot===0)return {x:0,y:0};
  const coords=[{q:0,r:0}];
  for(let ring=1;coords.length<=slot;ring++){
    let q=-ring,r=ring;
    const dirs=[[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];
    for(const [dq,dr] of dirs)for(let n=0;n<ring;n++){coords.push({q,r});q+=dq;r+=dr;}
  }
  const {q,r}=coords[slot];return {x:330*(q+r/2),y:330*Math.sqrt(3)/2*r};
}
export const projectPage = p => Math.floor((p.mapSlot||0)/PROJECTS_PER_PAGE);
export function revealProjectPage(project){domainPages.set(project.domainId,projectPage(project));}
