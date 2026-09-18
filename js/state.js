// js/state.js
import { statusLabel } from './ui/status-language.js';

export const state = {
  view:'map',
  showLinks:true, showAging:true, showGlow:true,
  activeDomain:null,
  filterTag:null,
  wipLimit:3,
  settings: { layoutMode: 'auto' },
  domains:[],
  projects:[],
  tasks:[],
  knowledge:[],
  inbox:[],
  operationLog:[],
  pendingSyncOperations:[],
  // Sync v1 C2: read-only projections of routed Tasks for remote devices.
  // The desktop is the single writer; other devices only render these.
  taskProjections:[],
  // Sync v1 C3: persisted tombstones of deleted Inbox records — distinguish
  // "never existed here" from "deleted here" so delete/restore races are
  // classified instead of resolved by delivery order.
  inboxTombstones:[],
  maxEdges:300
};

// Day planning: the explicit Focus of a day holds at most this many tasks.
// Independent from `wipLimit` (which caps the map's "doing" work-in-progress).
export const FOCUS_LIMIT = 3;

export const now = Date.now();
export const days = d => now - d*24*3600*1000;

export function initDemoData(){
  state.domains = [
    {id:'d1', title:'Дом', color:'var(--home)', createdAt:days(30), updatedAt:days(1)},
    {id:'d2', title:'Дача', color:'var(--dacha)', createdAt:days(45), updatedAt:days(2)}
  ];
  state.projects = [
    {id:'p1', domainId:'d1', title:'Домашние дела', tags:['дом'], priority:2, createdAt:days(20), updatedAt:days(1)},
    {id:'p2', domainId:'d2', title:'Дачные планы', tags:['дом','дача'], priority:2, createdAt:days(25), updatedAt:days(10)},
    {id:'p3', domainId:'d2', title:'Сад и огород', tags:['дача'], priority:1, createdAt:days(18), updatedAt:days(3)}
  ];
  state.tasks = [
    {id:'t1', projectId:'p1', title:'Купить продукты', tags:['дом','покупки'], status:'today', estimateMin:5, priority:2, updatedAt:days(1), createdAt:days(5)},
    {id:'t2', projectId:'p2', title:'Спланировать грядки', tags:['дача','сад'], status:'backlog', estimateMin:60, priority:3, updatedAt:days(10), createdAt:days(20)},
    {id:'t3', projectId:'p3', title:'Полить растения', tags:['дача','сад'], status:'doing', estimateMin:30, priority:2, updatedAt:days(3), createdAt:days(9)},
    {id:'t4', projectId:'p2', title:'Купить семена', tags:['покупки','дача'], status:'backlog', estimateMin:20, priority:2, updatedAt:days(15), createdAt:days(22)},
    {id:'t5', projectId:'p1', title:'Уборка на кухне', tags:['дом'], status:'today', estimateMin:90, priority:3, updatedAt:days(0), createdAt:days(2)},
    {id:'t6', projectId:'p3', title:'Настроить полив', tags:['дача','сад','техника'], status:'doing', estimateMin:45, priority:2, updatedAt:days(8), createdAt:days(14)}
  ];
}

export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];
export const byId = (arr,id) => arr.find(x=>x.id===id);
export const project = id => byId(state.projects,id);
export const domainOf = prj => byId(state.domains, prj.domainId);
export const tasksOfProject = pid => state.tasks.filter(t=>t.projectId===pid);
export const tasksIndependentOfDomain = (did) => state.tasks.filter(t=>!t.projectId && (t.domainId===did));

// Older exports may omit `tags` or store a single tag as a string. Keep the
// display and filtering layers defensive without discarding user-entered data.
export function normalizeTags(rawTags){
  const values = Array.isArray(rawTags)
    ? rawTags
    : rawTags == null
      ? []
      : [rawTags];
  return [...new Set(values
    .filter(tag => tag !== null && tag !== undefined)
    .map(tag => String(tag).trim())
    .filter(Boolean))];
}

export const daysSince = ts => Math.floor((Date.now()-ts)/(24*3600*1000));
export const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));

export function colorByAging(ts){
  const d = daysSince(ts||Date.now());
  if (d<=2) return '#34d399';
  if (d<=6) return '#a7f3d0';
  if (d<=14) return '#f59e0b';
  return '#ff6b6b';
}
// Orb size is a first visual channel, so it must say something the other
// channels do not: how much attention the task deserves (priority/impact) and
// how big the piece of work is (estimate). A tiny low-priority task and a large
// high-priority one used to differ by 4 px and read as identical dots.
export function sizeByImportance(item){
  const priority = Number(item?.priority) || 2;
  const impact = Number(item?.impact) || 2;
  const priorityPart = (clamp(priority, 1, 4) - 1) * 1.6;   // 0 .. 4.8
  const impactPart = clamp((impact - 2) * 1.1, -1.1, 1.1);  // -1.1 .. 1.1
  const estimatePart = Math.sqrt(clamp(Number(item?.estimateMin) || 0, 0, 240) / 240) * 3.6;
  return clamp(6.2 + priorityPart + impactPart + estimatePart, 6, 14);
}
export function statusPill(s){
  const cls = `status-pill ${s==='today'?'today': s==='doing'?'doing': s==='done'?'done':''}`;
  return `<span class="${cls}">${statusLabel(s)}</span>`;
}
