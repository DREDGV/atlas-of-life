// Persistent addresses, not viewport coordinates. Never renumber surviving entities.
export const validMapSlot = value => Number.isSafeInteger(value) && value >= 0;
export function nextMapSlot(entities) {
  return Math.max(-1,...entities.map(e => validMapSlot(e.mapSlot) ? e.mapSlot : -1))+1;
}
export function withSpatialAddresses(data) {
  const assign = items => {
    const used=new Set();let next=nextMapSlot(items);
    return items.map(item=>{let slot=item.mapSlot;if(!validMapSlot(slot)||used.has(slot))slot=next++;used.add(slot);return {...item,mapSlot:slot};});
  };
  const domains=assign(data.domains);
  const projects=[];
  const groups=new Map();
  for(const p of data.projects){if(!groups.has(p.domainId))groups.set(p.domainId,[]);groups.get(p.domainId).push(p);}
  const indexed=new Map([...groups.values()].flatMap(assign).map(p=>[p.id,p]));
  for(const p of data.projects)projects.push(indexed.get(p.id));
  return {...data,domains,projects};
}
