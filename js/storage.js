// js/storage.js
import { state } from './state.js';
import adapter from './storageAdapter.js';
import { logEvent } from './utils/analytics.js';

// Schema versioning + migrations
const SCHEMA_VERSION = 1;
const MIGRATIONS = [
  // 0 -> 1
  (data) => {
    // ensure settings.layoutMode and domain archived flag
    const out = { ...data };
    out.settings = out.settings && typeof out.settings.layoutMode==='string'
      ? { layoutMode: out.settings.layoutMode==='manual'?'manual':'auto' }
      : { layoutMode:'auto' };
    if (Array.isArray(out.domains)) {
      out.domains = out.domains.map(d => ({ archived:false, ...d }));
    }
    return out;
  },
];

export function loadState(){
  try{
    const raw = adapter.load();
    if(!raw) return false;
    let data = JSON.parse(raw);
    // migrate
    const ver = typeof data.schema==='number' ? data.schema : 0;
    let cur = ver;
    while (cur < SCHEMA_VERSION) {
      const mig = MIGRATIONS[cur];
      if (typeof mig === 'function') data = mig(data);
      cur++;
    }
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
    const text = JSON.stringify(data);
    if (!text) {
      throw new Error('Failed to serialize state data');
    }
    adapter.save(text);
    // Immediate UI refresh hooks
    try {
      if (window.mapApi && typeof window.mapApi.layoutMap==='function') window.mapApi.layoutMap();
      if (window.mapApi && typeof window.mapApi.drawMap==='function') window.mapApi.drawMap();
    } catch(_){}
    try {
      if (typeof window.renderSidebar==='function') window.renderSidebar();
      if (typeof window.renderToday==='function') window.renderToday();
    } catch(_){}
  }catch(e){
    console.warn('saveState error', e);
    // Notify user about save error
    if (typeof window !== 'undefined' && window.showToast) {
      window.showToast('Ошибка сохранения данных: ' + e.message, 'warn');
    }
  }
}

export function exportJson(){
  const data = {
    schema: SCHEMA_VERSION,
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
  try { logEvent('export_json', { tasks: state.tasks.length, projects: state.projects.length, domains: state.domains.length }); } catch(_){}
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
        try { logEvent('import_json', { kind:'strict', tasks: state.tasks.length }); } catch(_){}
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
        try { logEvent('import_json', { kind:'tolerant', tasks: state.tasks.length }); } catch(_){}
        resolve(true);
      }catch(e){ reject(e); }
    };
    reader.readAsText(file);
  });
}
