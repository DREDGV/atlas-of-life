// js/storage.js
import { state } from './state.js';

const KEY = 'atlas_v2_data';

export function loadState(){
  try{
    const raw = localStorage.getItem(KEY);
    if(!raw) return false;
    const data = JSON.parse(raw);
    if(!data || !data.domains || !data.projects || !data.tasks) return false;
    state.domains = data.domains;
    state.projects = data.projects;
    state.tasks = data.tasks;
    if(typeof data.maxEdges === 'number') state.maxEdges = data.maxEdges;
    if(typeof data.showLinks === 'boolean') state.showLinks = data.showLinks;
    if(typeof data.showAging === 'boolean') state.showAging = data.showAging;
    if(typeof data.showGlow === 'boolean') state.showGlow = data.showGlow;
    if(typeof data.view === 'string') state.view = data.view;
    // settings (v0.2.6)
    if(data.settings && typeof data.settings.layoutMode==='string'){
      state.settings = { layoutMode: data.settings.layoutMode==='manual'?'manual':'auto' };
    }else{
      state.settings = { layoutMode:'auto' };
    }
    // migration: ensure independent tasks (projectId null/undefined) have domainId
    const firstDom = state.domains[0]?.id || null;
    state.tasks.forEach(t=>{
      if(t && (t.projectId===null || typeof t.projectId==='undefined')){
        if(!t.domainId) t.domainId = state.activeDomain || firstDom;
      }
    });
    return true;
  }catch(e){
    console.warn('loadState error', e);
    return false;
  }
}

export function saveState(){
  try{
    const data = {
      schema:1,
      exportedAt: Date.now(),
      domains: state.domains,
      projects: state.projects,
      tasks: state.tasks,
      maxEdges: state.maxEdges,
      showLinks: !!state.showLinks,
      showAging: !!state.showAging,
      showGlow: !!state.showGlow,
      view: state.view,
      settings: state.settings || { layoutMode:'auto' }
    };
    localStorage.setItem(KEY, JSON.stringify(data));
  }catch(e){
    console.warn('saveState error', e);
  }
}

export function exportJson(){
  const data = {
    schema:1,
    exportedAt: new Date().toISOString(),
    domains: state.domains,
    projects: state.projects,
    tasks: state.tasks,
    maxEdges: state.maxEdges,
    showLinks: !!state.showLinks,
    showAging: !!state.showAging,
    showGlow: !!state.showGlow,
    view: state.view,
    settings: state.settings || { layoutMode:'auto' }
  };
  const str = JSON.stringify(data, null, 2);
  const blob = new Blob([str], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'atlas_export.json';
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

export function importJson(file){
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      try{
        const data = JSON.parse(reader.result);
        if(!data.domains || !data.projects || !data.tasks) throw new Error('Нет ключевых разделов: domains/projects/tasks');
        const domIds = new Set(data.domains.map(d=>d.id));
        const prjIds = new Set(data.projects.map(p=>p.id));
        for(const p of data.projects){ if(!domIds.has(p.domainId)) throw new Error(`Проект ${p.title||p.id}: неизвестный domainId ${p.domainId}`); }
        for(const t of data.tasks){ if(!prjIds.has(t.projectId)) throw new Error(`Задача ${t.title||t.id}: неизвестный projectId ${t.projectId}`); }
        state.domains = data.domains;
        state.projects = data.projects;
        state.tasks = data.tasks;
        state.maxEdges = typeof data.maxEdges==='number' ? data.maxEdges : 300;
        if(typeof data.showLinks==='boolean') state.showLinks = data.showLinks; else state.showLinks = true;
        if(typeof data.showAging==='boolean') state.showAging = data.showAging; else state.showAging = true;
        if(typeof data.showGlow==='boolean') state.showGlow = data.showGlow; else state.showGlow = true;
        if(typeof data.view==='string') state.view = data.view; else state.view = 'map';
        saveState();
        resolve(true);
      }catch(e){ reject(e); }
    };
    reader.readAsText(file);
  });
}

// tolerant importer for v0.2.6+: allows projectId:null and missing projectId (old dumps),
// adds settings.layoutMode and migrates independent tasks with domainId
export function importJsonV26(file){
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      try{
        const data = JSON.parse(reader.result);
        if(!data.domains || !data.projects || !data.tasks) throw new Error('Неверный формат: нужны domains/projects/tasks');
        const domIds = new Set(data.domains.map(d=>d.id));
        const prjIds = new Set(data.projects.map(p=>p.id));
        for(const p of data.projects){ if(!domIds.has(p.domainId)) throw new Error(`Проект ${p.title||p.id}: неизвестный domainId ${p.domainId}`); }
        for(const t of data.tasks){
          if(typeof t.projectId==='undefined') continue;
          if(t.projectId===null) continue;
          if(!prjIds.has(t.projectId)) throw new Error(`Задача ${t.title||t.id}: неизвестный projectId ${t.projectId}`);
        }
        state.domains = data.domains;
        state.projects = data.projects;
        state.tasks = data.tasks;
        state.maxEdges = typeof data.maxEdges==='number' ? data.maxEdges : 300;
        state.showLinks = typeof data.showLinks==='boolean' ? data.showLinks : true;
        state.showAging = typeof data.showAging==='boolean' ? data.showAging : true;
        state.showGlow = typeof data.showGlow==='boolean' ? data.showGlow : true;
        state.view = typeof data.view==='string' ? data.view : 'map';
        state.settings = (data.settings && typeof data.settings.layoutMode==='string') ? { layoutMode: (data.settings.layoutMode==='manual'?'manual':'auto') } : { layoutMode:'auto' };
        const firstDom = state.domains[0]?.id || null;
        state.tasks.forEach(t=>{
          if(t && (t.projectId===null || typeof t.projectId==='undefined')){
            if(!t.domainId || !domIds.has(t.domainId)) t.domainId = state.activeDomain || firstDom;
          }
        });
        saveState();
        resolve(true);
      }catch(e){ reject(e); }
    };
    reader.readAsText(file);
  });
}
