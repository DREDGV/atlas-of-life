import { updateTask, createTask, createProject } from '../../core/commands.js';
import { localDay } from '../today/model.js';
import { requestSyncNow } from '../../sync/runtime.js';
import { expandedCompletedProjects, setMapQuery } from '../../ui/map-session.js';
import { domainPages, projectPage } from './spatial-layout.js';

let lastSignature = '';
export function renderMapNavigator({ state, selected, type, nodes, camera, width, height, dpr, open, fit, overview, pan }) {
  const host=document.getElementById('atlasNavigator');
  if(!host)return;
  const task=type==='task'?state.tasks.find(t=>t.id===selected):null;
  const project=state.projects.find(p=>p.id===(task?.projectId||(type==='project'?selected:null)));
  const domain=state.domains.find(d=>d.id===(project?.domainId||task?.domainId||(type==='domain'?selected:null)));
  const entity=task||project||domain;
  const pages=domain ? [...new Set(state.projects.filter(p=>p.domainId===domain.id).map(projectPage))].sort((a,b)=>a-b) : [];
  const page=domainPages.get(domain?.id)||0;
  const signature=JSON.stringify([type,entity,domain?.title,project?.title,state.domains.length,pages,page]);
  const make=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;};
  if(signature!==lastSignature||!host.childElementCount){
    lastSignature=signature;
    const focus=host.contains(document.activeElement)?document.activeElement.dataset.action:null;
    host.replaceChildren();
    const path=make('nav',undefined,'atlas-path');path.setAttribute('aria-label','Путь на карте');
    const button=(label,action,key)=>{const b=make('button',label);b.type='button';b.dataset.action=key||label;b.onclick=action;return b;};
    path.append(button('Атлас',overview,'overview'));
    if(domain){path.append(make('span','/'),button(domain.title,()=>{open(domain,'domain');fit(domain.id,'domain');},'domain'));}
    if(project){path.append(make('span','/'),button(project.title,()=>{open(project,'project');fit(project.id,'project');},'project'));}
    host.append(path);
    const row=make('div',undefined,'atlas-selection');
    row.append(make('div',entity?.title||'Вся жизнь в поле зрения','atlas-selection-title'));
    const actions=make('div',undefined,'atlas-actions');
    const status=make('span','','atlas-action-status');status.setAttribute('role','status');
    const act=(label,run,key)=>actions.append(button(label,()=>{
      try{run();requestSyncNow();}
      catch(error){const s=document.querySelector('.atlas-action-status');if(s)s.textContent=error.message;}
    },key));
    if(entity)act('Приблизить',()=>fit(entity.id,type),'fit');
    if(domain && pages.length>1){
      const change=delta=>{const index=pages.indexOf(page);setMapQuery('');const search=document.getElementById('mapSearch');if(search)search.value='';domainPages.set(domain.id,pages[(index+delta+pages.length)%pages.length]);lastSignature='';window.mapApi?.refresh?.({layout:true});open(domain,'domain');fit(domain.id,'domain');};
      actions.append(button('← Проекты',()=>change(-1),'previous-page'),make('span',`Страница ${pages.indexOf(page)+1} из ${pages.length}`),button('Проекты →',()=>change(1),'next-page'));
    }
    if(task){
      act(task.status==='done'?'Вернуть в работу':'✓ Завершить',()=>{
        updateTask(task.id,{status:task.status==='done'?'backlog':'done'});
        open(state.tasks.find(t=>t.id===task.id),'task');
      },'complete');
      if(task.status!=='done'&&task.plannedDay!==localDay())act('На сегодня',()=>{
        updateTask(task.id,{plannedDay:localDay()});open(state.tasks.find(t=>t.id===task.id),'task');
      },'today');
      if(task.sourceKnowledgeId)act('↗ Материал-источник',()=>{
        const material=state.knowledge.find(k=>k.id===task.sourceKnowledgeId);
        if(material)open(material,'knowledge');
      },'source');
    }else if(project){
      if(project.lifecycle==='completed')act(expandedCompletedProjects.has(project.id)?'Свернуть задачи':'Показать задачи',()=>{
        if(expandedCompletedProjects.has(project.id))expandedCompletedProjects.delete(project.id);else expandedCompletedProjects.add(project.id);
        lastSignature='';window.mapApi?.refresh?.({layout:true});
      },'expand');
      if(project.lifecycle!=='completed')act('+ Задача',()=>{const title=prompt('Новая задача проекта:');if(title?.trim()){const t=createTask({title,projectId:project.id});open(t,'task');fit(t.id,'task');}},'create');
    }else if(domain){
      act('+ Проект',()=>{const title=prompt('Название проекта:');if(title?.trim()){const p=createProject({title,domainId:domain.id});open(p,'project');fit(p.id,'project');}},'create');
    }else{
      actions.append(make('span','Выберите объект · колесо — масштаб · Alt + drag — перемещение','atlas-help'));
    }
    row.append(actions);host.append(row,status);
    if(focus)host.querySelector(`[data-action="${focus}"]`)?.focus();
  }
  const mini=document.getElementById('atlasMinimap');
  if(!mini)return;
  const areas=nodes.filter(n=>n._type==='domain');
  mini.parentElement.hidden=!areas.length;
  if(!areas.length)return;
  const minX=Math.min(...nodes.map(n=>n.x-n.r))-30*dpr;
  const minY=Math.min(...nodes.map(n=>n.y-n.r))-30*dpr;
  const maxX=Math.max(...nodes.map(n=>n.x+n.r))+30*dpr;
  const maxY=Math.max(...nodes.map(n=>n.y+n.r))+30*dpr;
  const scale=Math.min(144/(maxX-minX),80/(maxY-minY));
  const dx=(160-(maxX-minX)*scale)/2-minX*scale,dy=(96-(maxY-minY)*scale)/2-minY*scale;
  const ctx=mini.getContext('2d');ctx.clearRect(0,0,160,96);
  areas.forEach(n=>{ctx.beginPath();ctx.arc(n.x*scale+dx,n.y*scale+dy,n.r*scale,0,Math.PI*2);ctx.fillStyle=n.color+'66';ctx.fill();ctx.strokeStyle=n.color;ctx.lineWidth=1;ctx.stroke();});
  ctx.strokeStyle=document.documentElement.dataset.theme==='light'?'#184b6e':'#e6edf3';ctx.lineWidth=1.4;
  const x0=Math.max(2,-camera.tx/camera.scale*scale+dx),y0=Math.max(2,-camera.ty/camera.scale*scale+dy);
  const x1=Math.min(158,(width-camera.tx)/camera.scale*scale+dx),y1=Math.min(94,(height-camera.ty)/camera.scale*scale+dy);
  if(x1>x0&&y1>y0)ctx.strokeRect(x0,y0,x1-x0,y1-y0);
  mini.onclick=e=>{const r=mini.getBoundingClientRect();pan(((e.clientX-r.x)*160/r.width-dx)/scale,((e.clientY-r.y)*96/r.height-dy)/scale);};
  mini.onkeydown=e=>{
    if(e.key==='Home'){e.preventDefault();overview();return;}
    const steps={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
    if(steps[e.key]){e.preventDefault();const [x,y]=steps[e.key];pan((width/2-camera.tx)/camera.scale+x*width/camera.scale*.2,(height/2-camera.ty)/camera.scale+y*height/camera.scale*.2);}
  };
}
