// js/storage.js
import { state, normalizeTags } from './state.js';
import adapter from './storageAdapter.js';
import { logEvent } from './utils/analytics.js';

// Schema versioning + migrations
const SCHEMA_VERSION = 4;
const OPERATION_LOG_LIMIT = 1000;

function normalizeOperationLog(entries){
  if (!Array.isArray(entries)) return [];
  return entries
    .filter(entry => entry && typeof entry === 'object' && entry.id && entry.type)
    .map(entry => ({
      schema: Number(entry.schema) || 1,
      id: String(entry.id),
      deviceId: entry.deviceId ? String(entry.deviceId) : 'unknown-device',
      timestamp: Number(entry.timestamp) || Date.now(),
      type: String(entry.type),
      entityType: entry.entityType ? String(entry.entityType) : null,
      entityId: entry.entityId ? String(entry.entityId) : null,
      baseVersion: entry.baseVersion ?? null,
      payload: entry.payload ?? null,
      syncStatus: entry.syncStatus || 'pending',
    }))
    .slice(-OPERATION_LOG_LIMIT);
}

function normalizeInboxEntries(entries){
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry, index) => {
      const source = typeof entry === 'string' ? { text: entry } : entry;
      if (!source || typeof source !== 'object') return null;
      const text = String(source.text || source.title || '').trim();
      if (!text) return null;
      const createdAt = Number(source.createdAt) || Date.now();
      return {
        ...source,
        id: source.id || `inbox-migrated-${index}`,
        text,
        createdAt,
        updatedAt: Number(source.updatedAt) || createdAt,
      };
    })
    .filter(Boolean);
}

// Sync v1 C2: read-only projections of routed Tasks (rendered on devices that
// do not have the real Task). Missing/legacy data degrades to an empty list.
function normalizeTaskProjections(entries){
  if (!Array.isArray(entries)) return [];
  return entries
    .filter(entry => entry && typeof entry === 'object' && entry.id && typeof entry.title === 'string')
    .map(entry => ({
      id: String(entry.id),
      title: entry.title,
      sourceInboxId: entry.sourceInboxId ? String(entry.sourceInboxId) : null,
      domainId: entry.domainId ? String(entry.domainId) : null,
      domainTitle: typeof entry.domainTitle === 'string' ? entry.domainTitle : null,
      projectId: entry.projectId ? String(entry.projectId) : null,
      projectTitle: typeof entry.projectTitle === 'string' ? entry.projectTitle : null,
      priority: Number(entry.priority) || 2,
      due: entry.due && typeof entry.due === 'object' && entry.due.date
        ? { date: String(entry.due.date), time: entry.due.time ? String(entry.due.time) : null }
        : (Number(entry.due) || null),
      status: typeof entry.status === 'string' ? entry.status : 'backlog',
      updatedAt: Number(entry.updatedAt) || 0,
    }));
}

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
  // 1 -> 2: tags are always arrays. This prevents legacy incomplete records
  // from leaking an `undefined` tag into filters and view renderers.
  (data) => {
    const out = { ...data };
    if (Array.isArray(out.projects)) {
      out.projects = out.projects.map(project => ({
        ...project,
        tags: normalizeTags(project?.tags),
      }));
    }
    if (Array.isArray(out.tasks)) {
      out.tasks = out.tasks.map(task => ({
        ...task,
        tags: normalizeTags(task?.tags),
      }));
    }
    return out;
  },
  // 2 -> 3: introduce a dedicated Inbox collection.
  (data) => ({
    ...data,
    inbox: normalizeInboxEntries(data?.inbox),
  }),
  // 3 -> 4: add a bounded local operation log for recovery and future sync.
  (data) => ({
    ...data,
    operationLog: normalizeOperationLog(data?.operationLog),
  }),
];

function normalizeEntities(entities, options = {}){
  return Array.isArray(entities)
    ? entities.map(entity => {
      const { _type, ...clean } = entity || {};
      return options.tags === false
        ? clean
        : { ...clean, tags: normalizeTags(clean.tags) };
    })
    : entities;
}

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
    state.domains = normalizeEntities(data.domains, { tags: false });
    state.projects = normalizeEntities(data.projects);
    state.tasks = normalizeEntities(data.tasks);
    state.inbox = normalizeInboxEntries(data.inbox);
    state.operationLog = normalizeOperationLog(data.operationLog);
    state.taskProjections = normalizeTaskProjections(data.taskProjections);
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
    // Store the migration now, rather than waiting for an unrelated edit.
    if (ver < SCHEMA_VERSION) {
      data.schema = SCHEMA_VERSION;
      data.projects = state.projects;
      data.tasks = state.tasks;
      data.inbox = state.inbox;
      data.operationLog = state.operationLog;
      adapter.save(JSON.stringify(data));
    }
    return true;
  }catch(e){
    console.warn('loadState error', e);
    return false;
  }
}

export function saveState(){
  try{
    const data = {
      schema:SCHEMA_VERSION,
      exportedAt: Date.now(),
      domains: normalizeEntities(state.domains, { tags: false }),
      projects: normalizeEntities(state.projects),
      tasks: normalizeEntities(state.tasks),
      inbox: normalizeInboxEntries(state.inbox),
      operationLog: normalizeOperationLog(state.operationLog),
      taskProjections: normalizeTaskProjections(state.taskProjections),
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
    return true;
  }catch(e){
    console.warn('saveState error', e);
    // Notify user about save error
    if (typeof window !== 'undefined' && window.showToast) {
      window.showToast('Ошибка сохранения данных: ' + e.message, 'warn');
    }
    throw e;
  }
}

export function exportJson(){
  const data = {
    schema: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    domains: normalizeEntities(state.domains, { tags: false }),
    projects: normalizeEntities(state.projects),
    tasks: normalizeEntities(state.tasks),
    inbox: normalizeInboxEntries(state.inbox),
    operationLog: normalizeOperationLog(state.operationLog),
    taskProjections: normalizeTaskProjections(state.taskProjections),
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
        state.domains = normalizeEntities(data.domains, { tags: false });
        state.projects = normalizeEntities(data.projects);
        state.tasks = normalizeEntities(data.tasks);
        state.inbox = normalizeInboxEntries(data.inbox);
        state.operationLog = normalizeOperationLog(data.operationLog);
        state.taskProjections = normalizeTaskProjections(data.taskProjections);
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
        state.domains = normalizeEntities(data.domains, { tags: false });
        state.projects = normalizeEntities(data.projects);
        state.tasks = normalizeEntities(data.tasks);
        state.inbox = normalizeInboxEntries(data.inbox);
        state.operationLog = normalizeOperationLog(data.operationLog);
        state.taskProjections = normalizeTaskProjections(data.taskProjections);
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
