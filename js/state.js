// js/state.js
export const state = {
  view:'map',
  showLinks:true, showAging:true, showGlow:true,
  activeDomain:null,
  filterTag:null,
  wipLimit:3,
  settings: {
    layoutMode: 'auto',
    wipTodayLimit: 5,
    hotkeys: {
      newTask: 'ctrl+n',
      newProject: 'ctrl+shift+n', 
      newDomain: 'ctrl+shift+d',
      search: 'ctrl+f',
      closeInspector: 'escape',
      statusPlan: '1',
      statusToday: '2', 
      statusDoing: '3',
      statusDone: '4',
      fitAll: 'ctrl+0',
      fitDomain: 'ctrl+1',
      fitProject: 'ctrl+2'
    }
  },
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
    {id:'p1', domainId:'d1', title:'Домашние дела', tags:['дом'], priority:2, color:'#ff6b6b', createdAt:days(20), updatedAt:days(1)},
    {id:'p2', domainId:'d2', title:'Дачные планы', tags:['дом','дача'], priority:2, color:'#4ecdc4', createdAt:days(25), updatedAt:days(10)},
    {id:'p3', domainId:'d2', title:'Сад и огород', tags:['дача'], priority:1, color:'#45b7d1', createdAt:days(18), updatedAt:days(3)}
  ];
  state.tasks = [
    {id:'t1', projectId:'p1', title:'Купить продукты', tags:['дом','покупки'], status:'today', estimateMin:5, priority:2, updatedAt:days(1), createdAt:days(5)},
    {id:'t2', projectId:'p2', title:'Спланировать грядки', tags:['дача','сад'], status:'backlog', estimateMin:60, priority:3, updatedAt:days(10), createdAt:days(20)},
    {id:'t3', projectId:'p3', title:'Полить растения', tags:['дача','сад'], status:'doing', estimateMin:30, priority:2, updatedAt:days(3), createdAt:days(9)},
    {id:'t4', projectId:'p2', title:'Купить семена', tags:['покупки','дача'], status:'backlog', estimateMin:20, priority:2, updatedAt:days(15), createdAt:days(22)},
    {id:'t5', projectId:'p1', title:'Уборка на кухне', tags:['дом'], status:'today', estimateMin:90, priority:3, updatedAt:days(0), createdAt:days(2)},
    {id:'t6', projectId:'p3', title:'Настроить полив', tags:['дача','сад','техника'], status:'doing', estimateMin:45, priority:2, updatedAt:days(8), createdAt:days(14)}
  ];
  
  // Отладка для Edge
  if (window.DEBUG_EDGE_TASKS) {
    console.log('initDemoData called, tasks created:', state.tasks.length, state.tasks);
  }
}

export const $ = s => document.querySelector(s);
export const $$ = s => [...document.querySelectorAll(s)];
export const byId = (arr,id) => arr.find(x=>x.id===id);
export const project = id => byId(state.projects,id);
export const domainOf = prj => prj.domainId ? byId(state.domains, prj.domainId) : null;
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

// Цветовая палитра для проектов
export const PROJECT_COLOR_PRESETS = [
  '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#feca57',
  '#ff9ff3', '#54a0ff', '#5f27cd', '#00d2d3', '#ff9f43',
  '#10ac84', '#ee5a24', '#0984e3', '#6c5ce7', '#a29bfe'
];

// Получить случайный цвет для проекта
export function getRandomProjectColor() {
  return PROJECT_COLOR_PRESETS[Math.floor(Math.random() * PROJECT_COLOR_PRESETS.length)];
}

// Получить цвет проекта или дефолтный
export function getProjectColor(project) {
  // Если у проекта есть цвет - используем его, иначе - единый цвет по умолчанию
  return project?.color || "#7b68ee"; // Единый цвет по умолчанию для всех проектов
}

// Проверить контрастность цвета (светлый/темный текст)
export function getContrastColor(hexColor) {
  // Убираем # если есть
  const color = hexColor.replace('#', '');
  
  // Конвертируем в RGB
  const r = parseInt(color.substr(0, 2), 16);
  const g = parseInt(color.substr(2, 2), 16);
  const b = parseInt(color.substr(4, 2), 16);
  
  // Вычисляем яркость
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  
  // Возвращаем светлый или темный цвет текста
  return brightness > 128 ? '#000000' : '#ffffff';
}
