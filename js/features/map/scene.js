import { territoryRadius, projectPoints } from './geometry.js';
import { plural, statusLabel } from '../../ui/status-language.js';
// Rendering only. Geometry and hit targets come from the map, facts from Core state.
export function drawAtlasScene(ctx, scene) {
  const { nodes, facts, camera, dpr, light, selected, hovered, keyboard, emphasis,
    knowledgeCounts, edges, showLinks, targetDomain, targetProject, pendingAttach, dragged } = scene;
  const px = value => value * dpr / camera.scale;
  const ink = light ? '#18324c' : '#e6edf3';
  const muted = light ? '#53677e' : '#9eb2cb';
  const panel = light ? '#ffffff' : '#142033';
  const accent = light ? '#1766ab' : '#68d7ed';
  const warning = light ? '#855400' : '#f2c94c';
  const red = light ? '#b42323' : '#f87171';
  const green = light ? '#087b5b' : '#60d8ae';
  const index = new Map(nodes.map(n => [n.id, n]));
  const tasks = nodes.filter(n => n._type === 'task');
  const selectedNode = index.get(selected);
  const fit = (text, width) => {
    let result = String(text || '');
    if (ctx.measureText(result).width <= width) return result;
    while (result.length && ctx.measureText(result + '…').width > width) result = result.slice(0,-1);
    return result + '…';
  };
  const text = (value, x, y, size = 12, color = ink, width = 220, weight = 500) => {
    ctx.font = `${weight} ${px(size)}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.fillStyle = color;
    ctx.fillText(fit(value, px(width)), x, y);
  };
  const line = (a,b,color,dashed = false) => {
    ctx.beginPath(); ctx.setLineDash(dashed ? [px(4),px(5)] : []);
    ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y);
    ctx.strokeStyle = color; ctx.lineWidth = px(1.2); ctx.stroke(); ctx.setLineDash([]);
  };
  const circle = (n,r,fill,stroke,width=1) => {
    ctx.beginPath();ctx.arc(n.x,n.y,r,0,Math.PI*2);
    if(fill){ctx.fillStyle=fill;ctx.fill();}
    if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=px(width);ctx.stroke();}
  };
  const contour = (n, expansion = 1) => {
    ctx.beginPath();
    for (let i=0;i<=96;i++) {
      const angle=i*Math.PI/48;
      // Always outside the containing circle: no child spills over the shore.
      const radius=territoryRadius(n,angle)*expansion;
      const x=n.x+Math.cos(angle)*radius,y=n.y+Math.sin(angle)*radius;
      if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
    }
    ctx.closePath();
  };
  // Terraced terrain gives containment a visual identity; there is no productivity score.
  for (const n of nodes.filter(n=>n._type==='domain')) {
    const chosen = selected === n.id || targetDomain === n.id;
    const gradient=ctx.createRadialGradient(n.x-n.r*.3,n.y-n.r*.5,0,n.x,n.y,n.r*1.2);
    gradient.addColorStop(0,n.color+(light?'20':'28'));
    gradient.addColorStop(1,light?'#ffffffc9':'#101c2bed');
    contour(n);ctx.fillStyle=gradient;ctx.fill();
    ctx.strokeStyle=chosen?accent:n.color+(light?'80':'70');ctx.lineWidth=px(chosen?2:1);ctx.stroke();
    contour(n,1.04);ctx.strokeStyle=n.color+'20';ctx.lineWidth=px(1);ctx.stroke();
    const stats=facts.get(`domain:${n.id}`);
    text(n.title,n.x,n.y-n.r-px(24),17,ink,240,650);
    if(stats) {
      const color=stats.primary.kind==='overdue'?red:['load','stale'].includes(stats.primary.kind)?warning:muted;
      text(stats.primary.label,n.x,n.y-n.r-px(7),11,color,210);
      const y=n.y+n.r+px(23);
      if(camera.scale>=.85)text(`${n.projectCount} ${plural(n.projectCount,'проект','проекта','проектов')} · ${stats.open} открыто · ${stats.done} готово`,n.x,y,11,muted,250);
      const w=Math.min(n.r,px(64));
      if(camera.scale>=.85){
        ctx.fillStyle=light?'#c9d5df':'#2b3e52';ctx.fillRect(n.x-w,y+px(9),w*2,px(3));
        ctx.fillStyle=green;ctx.fillRect(n.x-w,y+px(9),w*2*stats.doneRatio,px(3));
        ctx.fillStyle=red;ctx.fillRect(n.x-w+w*2*stats.doneRatio,y+px(9),w*2*stats.overdueRatio,px(3));
      }
      if(!n.projectCount&&!stats.total) {
        text('Пока без обязательств',n.x,n.y,12,muted,180);
        if(camera.scale>=.85)text('Выберите, чтобы добавить проект',n.x,n.y+px(20),10,muted,210);
      }
    }
  }
  // Relationships appear in the selected context rather than as a permanent web.
  if(showLinks && selectedNode) {
    for(const e of edges) if(e.a.id===selected||e.b.id===selected) line(e.a,e.b,accent+'66',true);
  }
  for(const n of nodes.filter(n=>n._type==='project'||n._type==='unassigned')) {
    const isProject=n._type==='project';
    const domain=index.get(n.parent||n.domainId);
    const color=domain?.color||accent;
    const active=selected===n.id||hovered===n.id||targetProject===n.id;
    const radius=n.r+(isProject?18*dpr:0);
    if(isProject){
      const path=(inset=0)=>{ctx.beginPath();projectPoints(n,dpr,inset).forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();};
      path();ctx.fillStyle=panel;ctx.fill();ctx.strokeStyle=active?accent:(light?'#9bb4ca':'#425a73');ctx.lineWidth=px(active?2:1);ctx.stroke();
      path(px(5));ctx.strokeStyle=color+'40';ctx.lineWidth=px(1);ctx.stroke();
    }else{
      ctx.setLineDash([px(3),px(5)]);circle(n,radius,null,color+'70');ctx.setLineDash([]);
    }
    const headerY=n.y-radius-px(9);
    text(isProject?n.title:'Без проекта',n.x,headerY,isProject?13:11,ink,Math.max(100,Math.min(220,radius*2*camera.scale/dpr)),650);
    if(isProject) {
      // The diamond remains the project's handle. It is distinct from task states.
      ctx.save();ctx.translate(n.x,n.y);ctx.rotate(Math.PI/4);
      ctx.fillStyle=color;ctx.fillRect(-px(4),-px(4),px(8),px(8));ctx.restore();
    }
    const count=knowledgeCounts[`${n._type}:${n.id}`]||0;
    const stat=facts.get(`${n._type}:${n.id}`);
    const caption=count?`▱ ${count} ${plural(count,'материал','материала','материалов')}` : stat ? `${stat.open} открыто / ${stat.done} готово` : n.hidden?`+${n.hidden} задач`:'';
    if(caption)text(caption,n.x,n.y+radius+px(17),10,muted,180);
    if(selectedNode?._type==='task'&&selectedNode.groupId===n.id)line(n,selectedNode,color+'99');
  }
  // Direct materials on a domain are not lost behind its project totals.
  for(const n of nodes.filter(n=>n._type==='domain')) {
    const count=knowledgeCounts[`domain:${n.id}`]||0;
    if(count)text(`▱ ${count} ${plural(count,'материал','материала','материалов')} в сфере`,n.x,n.y+n.r+px(51),10,muted,230);
  }
  const labels=[];
  const ordered=[...tasks].sort((a,b)=>(a.id===selected?-2:a.id===hovered?-1:0)-(b.id===selected?-2:b.id===hovered?-1:0));
  for(const n of ordered) {
    const active=n.id===selected||n.id===hovered||n.id===keyboard;
    const dim=emphasis(n)<.5;
    const statusColor=n.due==='overdue'&&n.status!=='done'?red:n.status==='done'?green:n.status==='doing'?accent:n.status==='today'||n.focus?warning:muted;
    const r=n.r;
    ctx.globalAlpha=dim ? .18 : n.status==='done' ? .65 : 1;
    if(scene.showGlow&&active){ctx.shadowColor=accent;ctx.shadowBlur=8*dpr;}
    // A solid but quiet object, with a legible symbol; glow no longer encodes status.
    circle(n,r,panel,statusColor,active?2.5:1.8);
    ctx.shadowBlur=0;
    circle(n,r*.72,statusColor+(light?'15':'25'),null);
    if(active)circle(n,r+px(5),null,accent,1.2);
    if(scene.showAging&&n.ageDays>=30&&n.status!=='done') {
      ctx.beginPath();ctx.arc(n.x,n.y,r+px(4),-Math.PI*.8,-Math.PI*.25);
      ctx.strokeStyle=warning;ctx.lineWidth=px(2);ctx.stroke();
    }
    const size=Math.min(r*.5,px(6));
    ctx.strokeStyle=statusColor;ctx.fillStyle=statusColor;ctx.lineWidth=px(1.8);ctx.lineCap='round';
    ctx.beginPath();
    if(n.status==='done') {
      ctx.moveTo(n.x-size,n.y);ctx.lineTo(n.x-size*.2,n.y+size*.7);ctx.lineTo(n.x+size,n.y-size*.7);ctx.stroke();
    } else if(n.status==='doing') {
      ctx.moveTo(n.x-size*.6,n.y-size);ctx.lineTo(n.x+size,n.y);ctx.lineTo(n.x-size*.6,n.y+size);ctx.closePath();ctx.fill();
    } else if(n.due==='overdue') {
      ctx.moveTo(n.x,n.y-size);ctx.lineTo(n.x,n.y+size*.3);ctx.stroke();circle({x:n.x,y:n.y+size},px(1),statusColor,null);
    } else if(n.focus||n.status==='today') {
      ctx.moveTo(n.x,n.y-size);ctx.lineTo(n.x+size,n.y);ctx.lineTo(n.x,n.y+size);ctx.lineTo(n.x-size,n.y);ctx.closePath();ctx.fill();
    } else circle(n,Math.max(px(2),r*.15),statusColor,null);
    if(n.focus){text('Ф',n.x+r+px(5),n.y-r,9,accent,20,700);}
    ctx.globalAlpha=1;
    if(dim)continue;
    const near=tasks.filter(t=>t.id!==n.id).reduce((distance,t)=>Math.min(distance,Math.hypot(t.x-n.x,t.y-n.y)),Infinity)*camera.scale/dpr;
    const budget=active?180:Math.min(150,near*.88);
    if(!active&&(camera.scale<.65||budget<48))continue;
    ctx.font=`${active?600:500} ${px(active?13:11)}px "Segoe UI", system-ui`;
    const title=fit(n.title,px(budget));
    const width=ctx.measureText(title).width;
    const y=n.y+r+px(17),x=n.x;
    const box={x:x-width/2-px(5),y:y-px(12),w:width+px(10),h:px(18)};
    if(!active&&labels.some(b=>box.x<b.x+b.w&&box.x+box.w>b.x&&box.y<b.y+b.h&&box.y+box.h>b.y))continue;
    labels.push(box);
    ctx.fillStyle=panel;ctx.beginPath();ctx.roundRect(box.x,box.y,box.w,box.h,px(4));ctx.fill();
    ctx.fillStyle=active?ink:muted;ctx.textAlign='center';ctx.fillText(title,x,y);
    if(active){
      const details=[n.due==='overdue'&&n.status!=='done'?'Срок прошёл':statusLabel(n.status),n.estimateMin?`${n.estimateMin} мин`:null].filter(Boolean).join(' · ');
      text(details,x,y+px(18),11,n.due==='overdue'&&n.status!=='done'?red:muted,180);
    }
  }
  const connection=pendingAttach?{task:pendingAttach.taskId,project:pendingAttach.toProjectId}:dragged&&targetProject?{task:dragged.id,project:targetProject}:null;
  if(connection&&index.has(connection.task)&&index.has(connection.project))line(index.get(connection.task),index.get(connection.project),warning,true);
  ctx.lineCap='butt';ctx.globalAlpha=1;
}
