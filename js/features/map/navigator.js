import { updateTask, setProjectNextAction } from '../../core/commands.js';
import { localDay } from '../today/model.js';
import { requestSyncNow } from '../../sync/runtime.js';
import { expandedCompletedProjects, setMapQuery } from '../../ui/map-session.js';
import { domainPages, projectPage } from './spatial-layout.js';
import { openDayRow } from './map-day-view.js';
import { formatDay } from '../../ui/status-language.js';
import { showStudioPanel } from '../../ui/studio-panels.js';
import { bindMapCreate } from './create-form.js';

let lastSignature = '';
export function renderMapNavigator({ state, selected, type, nodes, camera, width, height, dpr, open, fit, overview, pan, resume, openResume }) {
  const host=document.getElementById('atlasNavigator');
  if(!host)return;
  const task=type==='task'?state.tasks.find(t=>t.id===selected):null;
  const project=state.projects.find(p=>p.id===(task?.projectId||(type==='project'?selected:null)));
  const domain=state.domains.find(d=>d.id===(project?.domainId||task?.domainId||(type==='domain'?selected:null)));
  const entity=task||project||domain;
  const pages=domain ? [...new Set(state.projects.filter(p=>p.domainId===domain.id).map(projectPage))].sort((a,b)=>a-b) : [];
  const page=domainPages.get(domain?.id)||0;
  const day = localDay();
  const suggestion = task && nodes.find(node => node.id === task.id && node._type === 'task')?.suggestion;
  const signature=JSON.stringify([type,entity,domain?.title,project?.title,project?.nextActionId,project?.lifecycle,state.domains.length,pages,page,day,suggestion,resume]);
  const make=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;};
  if(signature!==lastSignature||!host.childElementCount){
    lastSignature=signature;
    const focus=host.contains(document.activeElement)?document.activeElement.dataset.action:null;
    host.replaceChildren();
    const path=make('nav',undefined,'atlas-path');path.setAttribute('aria-label','Путь на карте');
    const button=(label,action,key)=>{const b=make('button',label);b.type='button';b.dataset.action=key||label;b.onclick=action;return b;};
    path.append(button('Атлас',overview,'overview'));
    if(domain){path.append(make('span','/'),button(domain.title,()=>{open(domain,'domain');fit(domain.id,'domain');},'domain'));}
    else if (task) path.append(make('span', ' / Без сферы'));
    if(project){path.append(make('span','/'),button(project.title,()=>{open(project,'project');fit(project.id,'project');},'project'));}
    host.append(path);
    const row=make('div',undefined,'atlas-selection');
    if (!resume) {
      const title = make('div', entity?.title || 'Вся жизнь в поле зрения', 'atlas-selection-title');
      title.classList.toggle('is-task', Boolean(task));
      row.append(title);
    }
    if (suggestion) row.append(make('span', suggestion.reason, 'atlas-day-reason'));
    const actions=make('div',undefined,'atlas-actions');
    const status=make('span','','atlas-action-status');status.setAttribute('role','status');
    const act=(label,run,key)=>actions.append(button(label,()=>{
      try{run();requestSyncNow();}
      catch(error){const s=document.querySelector('.atlas-action-status');if(s)s.textContent=error.message;}
    },key));
    const addCreate = (label, key, createType, destination, context) => {
      const trigger = button(label, null, key);
      bindMapCreate(trigger, { row, type:createType, destination, path:context, onCreate:(created, kind) => {
        open(created, kind);
        fit(created.id, kind);
        host.querySelector('[data-action=fit]')?.focus({ preventScroll:true });
      } });
      actions.append(trigger);
    };
    const addInspectorActions = choices => {
      const menu = make('details', undefined, 'atlas-object-tools');
      const toggle = make('summary', 'Действия');
      toggle.dataset.action = 'manage';
      menu.onkeydown = event => {
        if (event.key !== 'Escape' || !menu.open) return;
        event.preventDefault();
        menu.open = false;
        toggle.focus();
      };
      menu.onfocusout = event => {
        if (!menu.contains(event.relatedTarget)) menu.open = false;
      };
      const options = make('div', undefined, 'atlas-object-options');
      for (const [label, selector, confirmAction] of choices) {
        options.append(button(label, () => {
          menu.open = false;
          const inspector = document.getElementById('inspector');
          if (inspector.dataset.objectId !== String(entity.id) || inspector.dataset.objectType !== type) open(entity, type);
          showStudioPanel('details', { focus: false });
          const target = inspector.querySelector(selector);
          if (!target) return;
          const disclosure = target.closest('details');
          if (disclosure) disclosure.open = true;
          target.focus();
          if (confirmAction) target.click();
        }));
      }
      menu.append(toggle, options);
      actions.append(menu);
    };
    if(entity)act('Приблизить',()=>fit(entity.id,type),'fit');
    if(domain && pages.length>1){
      const change=delta=>{const index=pages.indexOf(page);setMapQuery('');const search=document.getElementById('mapSearch');if(search)search.value='';domainPages.set(domain.id,pages[(index+delta+pages.length)%pages.length]);lastSignature='';window.mapApi?.refresh?.({layout:true});open(domain,'domain');fit(domain.id,'domain');};
      actions.append(button('← Проекты',()=>change(-1),'previous-page'),make('span',`Страница ${pages.indexOf(page)+1} из ${pages.length}`),button('Проекты →',()=>change(1),'next-page'));
    }
    if(task){
      if (project && (project.lifecycle || 'active') === 'active' && !project.nextActionId && task.status !== 'done') {
        act('Сделать следующим шагом', () => {
          if (state.projects.find(item => item.id === project.id)?.nextActionId) throw new Error('У проекта уже выбран следующий шаг.');
          setProjectNextAction(project.id, task.id);
          window.mapApi?.refresh?.({ layout: true });
          document.querySelector('.atlas-action-status').textContent = 'Следующий шаг выбран';
        }, 'next-step');
      }
      act(task.status==='done'?'Вернуть в работу':'✓ Завершить',()=>{
        updateTask(task.id,{status:task.status==='done'?'backlog':'done'});
        open(state.tasks.find(t=>t.id===task.id),'task');
      },'complete');
      const planLabel = task.plannedDay ? 'Перенести на сегодня (' + (formatDay(task.plannedDay, day) || task.plannedDay) + ')' : 'На сегодня';
      if (task.status !== 'done' && task.plannedDay === day) {
        actions.append(button('Открыть в «Сегодня»', () => openDayRow(task.id), 'open-today'));
      }
      if(task.status!=='done'&&task.plannedDay!==day)act(planLabel,()=>{
        updateTask(task.id,{plannedDay:localDay()});open(state.tasks.find(t=>t.id===task.id),'task');
      },'today');
      const planAction = actions.querySelector('[data-action="today"], [data-action="open-today"]');
      if (planAction) actions.prepend(planAction);
      if(task.sourceKnowledgeId)act('↗ Материал-источник',()=>{
        const material=state.knowledge.find(k=>k.id===task.sourceKnowledgeId);
        if(material){
          open(material,'knowledge');
          showStudioPanel('details');
        }
      },'source');
      addInspectorActions([
        ['Править задачу', '#taskEditTitle'],
        ['Перенести задачу', '#taskPlaceDomain'],
        ['Удалить задачу…', '#delTask', true],
      ]);
    }else if(project){
      if(project.lifecycle==='completed')act(expandedCompletedProjects.has(project.id)?'Свернуть задачи':'Показать задачи',()=>{
        if(expandedCompletedProjects.has(project.id))expandedCompletedProjects.delete(project.id);else expandedCompletedProjects.add(project.id);
        lastSignature='';window.mapApi?.refresh?.({layout:true});
      },'expand');
      if (project.lifecycle !== 'completed') addCreate('+ Задача', 'create', 'task', { projectId:project.id }, [domain?.title, project.title]);
      addInspectorActions([
        ['Переименовать проект', '#projectEditTitle'],
        ['Перенести проект', '[name="projectDestination"]'],
      ]);
    }else if(domain){
      addCreate('+ Проект', 'create', 'project', { domainId:domain.id }, [domain.title]);
      addCreate('+ Задача', 'create-task', 'task', { domainId:domain.id }, [domain.title, 'Без проекта']);
    }else if(resume){
      const action = button('Продолжить работу', () => openResume(resume), 'resume');
      const caption = make('span', (resume.kind === 'task' ? 'Задача · ' : 'Разбор · ') + resume.title, 'atlas-resume-target');
      caption.id = 'atlasResumeTarget';
      action.setAttribute('aria-describedby', caption.id);
      actions.classList.add('atlas-resume');
      actions.append(action, caption);
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
