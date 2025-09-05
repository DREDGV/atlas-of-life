// js/state.js
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
  maxEdges:300
};

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
export const daysSince = ts => Math.floor((Date.now()-ts)/(24*3600*1000));
export const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));

export function colorByAging(ts){
  const d = daysSince(ts||Date.now());
  if (d<=2) return '#34d399';
  if (d<=6) return '#a7f3d0';
  if (d<=14) return '#f59e0b';
  return '#ff6b6b';
}
export function sizeByImportance(item){
  const pr = (item.priority||2), impact = (item.impact||2);
  const base = 6 + (pr-1)*2 + (impact-2);
  return clamp(base,6,14);
}
export function statusPill(s){
  const map = {today:'Сегодня', doing:'В работе', done:'Готово', backlog:'Бэклог'};
  const cls = `status-pill ${s==='today'?'today': s==='doing'?'doing': s==='done'?'done':''}`;
  return `<span class="${cls}">${map[s]||s}</span>`;
}
