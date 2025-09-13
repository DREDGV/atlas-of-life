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
  // Принудительно очищаем старые данные для тестирования mood
  
  // Принудительно очищаем localStorage для тестирования
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('atlas-state');
    console.log("Cleared localStorage for fresh test data");
  }
  
  state.domains = [
    {id:'d1', title:'Дом', color:'var(--home)', createdAt:days(30), updatedAt:days(1)},
    {id:'d2', title:'Дача', color:'var(--dacha)', createdAt:days(45), updatedAt:days(2)},
    {id:'d3', title:'Работа', color:'#3b82f6', createdAt:days(20), updatedAt:days(0)}
  ];
  state.projects = [
    {id:'p1', domainId:'d1', title:'Домашние дела', tags:['дом'], priority:2, color:'#ff6b6b', createdAt:days(20), updatedAt:days(1)},
    {id:'p2', domainId:'d2', title:'Дачные планы', tags:['дом','дача'], priority:2, color:'#4ecdc4', createdAt:days(25), updatedAt:days(10)},
    {id:'p3', domainId:'d2', title:'Сад и огород', tags:['дача'], priority:1, color:'#45b7d1', createdAt:days(18), updatedAt:days(3)},
    {id:'p4', domainId:'d3', title:'Разработка', tags:['работа','код'], priority:1, color:'#8b5cf6', createdAt:days(15), updatedAt:days(0)},
    {id:'p5', domainId:'d3', title:'Встречи', tags:['работа','встречи'], priority:2, color:'#06b6d4', createdAt:days(10), updatedAt:days(0)}
  ];
  state.tasks = [
    // Домен "Дом" - много приоритетных задач (pressure)
    {id:'t1', projectId:'p1', title:'Купить продукты', tags:['дом','покупки'], status:'today', estimateMin:5, priority:1, updatedAt:days(1), createdAt:days(5)},
    {id:'t2', projectId:'p1', title:'Уборка на кухне', tags:['дом'], status:'today', estimateMin:90, priority:1, updatedAt:days(0), createdAt:days(2)},
    {id:'t3', projectId:'p1', title:'Починить кран', tags:['дом','ремонт'], status:'doing', estimateMin:120, priority:1, updatedAt:days(1), createdAt:days(3)},
    {id:'t4', projectId:'p1', title:'Повесить картину', tags:['дом','ремонт'], status:'backlog', estimateMin:30, priority:2, updatedAt:days(2), createdAt:days(4)},
    {id:'t5', projectId:'p1', title:'Настроить Wi-Fi', tags:['дом','техника'], status:'backlog', estimateMin:60, priority:2, updatedAt:days(1), createdAt:days(5)},
    {id:'t6', projectId:'p1', title:'Помыть окна', tags:['дом','уборка'], status:'backlog', estimateMin:180, priority:2, updatedAt:days(0), createdAt:days(6)},
    
    // Домен "Дача" - просроченные задачи (crisis)
    {id:'t7', projectId:'p2', title:'Спланировать грядки', tags:['дача','сад'], status:'backlog', estimateMin:60, priority:3, updatedAt:days(10), createdAt:days(20), due: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()},
    {id:'t8', projectId:'p2', title:'Купить семена', tags:['покупки','дача'], status:'backlog', estimateMin:20, priority:2, updatedAt:days(15), createdAt:days(22), due: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString()},
    {id:'t9', projectId:'p3', title:'Полить растения', tags:['дача','сад'], status:'doing', estimateMin:30, priority:2, updatedAt:days(3), createdAt:days(9)},
    {id:'t10', projectId:'p3', title:'Настроить полив', tags:['дача','сад','техника'], status:'doing', estimateMin:45, priority:2, updatedAt:days(8), createdAt:days(14)},
    
    // === ДОПОЛНИТЕЛЬНЫЕ ТЕСТОВЫЕ ЗАДАЧИ ДЛЯ TODAY VIEW ===
    
    // Задачи с дедлайнами (для тестирования фильтра "С временем")
    {id:'t11', projectId:'p1', title:'Утренняя встреча', tags:['дом','встреча'], status:'today', estimateMin:60, priority:1, updatedAt:days(0), createdAt:days(1), scheduledFor: new Date(Date.now() + 30 * 60 * 1000).toISOString()},
    {id:'t12', projectId:'p1', title:'Обеденный перерыв', tags:['дом','обед'], status:'today', estimateMin:60, priority:4, updatedAt:days(0), createdAt:days(1), scheduledFor: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString()},
    {id:'t13', projectId:'p1', title:'Вечерний звонок', tags:['дом','звонок'], status:'today', estimateMin:30, priority:3, updatedAt:days(0), createdAt:days(1), scheduledFor: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString()},
    
    // Задачи без дедлайнов (для тестирования фильтра "Без времени")
    {id:'t14', projectId:'p1', title:'Помыть посуду', tags:['дом','уборка'], status:'today', estimateMin:20, priority:4, updatedAt:days(0), createdAt:days(1)},
    {id:'t15', projectId:'p1', title:'Проверить почту', tags:['дом','администрация'], status:'today', estimateMin:15, priority:3, updatedAt:days(0), createdAt:days(1)},
    {id:'t16', projectId:'p1', title:'Записаться к врачу', tags:['дом','здоровье'], status:'today', estimateMin:10, priority:2, updatedAt:days(0), createdAt:days(1)},
    
    // Выполненные задачи (для тестирования фильтра "Выполненные")
    {id:'t17', projectId:'p1', title:'Сделать зарядку', tags:['дом','спорт'], status:'done', estimateMin:30, priority:4, updatedAt:days(0), createdAt:days(2), completedAt: Date.now() - 2 * 60 * 60 * 1000},
    {id:'t18', projectId:'p1', title:'Прочитать новости', tags:['дом','информация'], status:'done', estimateMin:20, priority:4, updatedAt:days(0), createdAt:days(2), completedAt: Date.now() - 4 * 60 * 60 * 1000},
    {id:'t19', projectId:'p1', title:'Проверить счета', tags:['дом','финансы'], status:'done', estimateMin:15, priority:3, updatedAt:days(0), createdAt:days(2), completedAt: Date.now() - 6 * 60 * 60 * 1000},
    
    // Задачи для домена "Работа" (для тестирования разных доменов)
    {id:'t20', projectId:'p4', title:'Исправить баги', tags:['работа','код','баги'], status:'today', estimateMin:120, priority:1, updatedAt:days(0), createdAt:days(1)},
    {id:'t21', projectId:'p4', title:'Написать тесты', tags:['работа','код','тесты'], status:'today', estimateMin:90, priority:2, updatedAt:days(0), createdAt:days(1)},
    {id:'t22', projectId:'p4', title:'Оптимизировать код', tags:['работа','код','оптимизация'], status:'today', estimateMin:60, priority:2, updatedAt:days(0), createdAt:days(1)},
    {id:'t23', projectId:'p4', title:'Обновить документацию', tags:['работа','код','документация'], status:'today', estimateMin:45, priority:3, updatedAt:days(0), createdAt:days(1)},
    {id:'t24', projectId:'p4', title:'Code review', tags:['работа','код','review'], status:'today', estimateMin:30, priority:2, updatedAt:days(0), createdAt:days(1)},
    
    // Встречи и планы
    {id:'t25', projectId:'p5', title:'Планирование спринта', tags:['работа','встречи','планирование'], status:'today', estimateMin:90, priority:1, updatedAt:days(0), createdAt:days(1), scheduledFor: new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString()},
    {id:'t26', projectId:'p5', title:'Стендап команды', tags:['работа','встречи','стендап'], status:'today', estimateMin:30, priority:2, updatedAt:days(0), createdAt:days(1), scheduledFor: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()},
    {id:'t27', projectId:'p5', title:'Обсуждение архитектуры', tags:['работа','встречи','архитектура'], status:'today', estimateMin:60, priority:2, updatedAt:days(0), createdAt:days(1)},
    
    // Задачи с разными приоритетами для тестирования фильтров
    {id:'t28', projectId:'p1', title:'КРИТИЧНО: Срочный ремонт', tags:['дом','ремонт','критично'], status:'today', estimateMin:180, priority:1, updatedAt:days(0), createdAt:days(0)},
    {id:'t29', projectId:'p1', title:'Важно: Оплатить счета', tags:['дом','финансы','важно'], status:'today', estimateMin:30, priority:2, updatedAt:days(0), createdAt:days(0)},
    {id:'t30', projectId:'p1', title:'Обычно: Полить цветы', tags:['дом','уход','обычно'], status:'today', estimateMin:15, priority:3, updatedAt:days(0), createdAt:days(0)},
    {id:'t31', projectId:'p1', title:'Неважно: Разобрать шкаф', tags:['дом','уборка','неважно'], status:'today', estimateMin:120, priority:4, updatedAt:days(0), createdAt:days(0)},
    
    // Просроченные задачи (для тестирования статистики)
    {id:'t32', projectId:'p2', title:'ПОЗДНО: Посадить рассаду', tags:['дача','сад','поздно'], status:'backlog', estimateMin:90, priority:2, updatedAt:days(0), createdAt:days(5), due: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()},
    {id:'t33', projectId:'p2', title:'ПОЗДНО: Подготовить теплицу', tags:['дача','сад','поздно'], status:'backlog', estimateMin:120, priority:1, updatedAt:days(0), createdAt:days(4), due: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString()},
    
    // Дополнительные задачи для роста (growth)
    {id:'t34', projectId:'p4', title:'Изучить новую технологию', tags:['работа','обучение','технология'], status:'today', estimateMin:180, priority:3, updatedAt:days(0), createdAt:days(0)},
    {id:'t35', projectId:'p4', title:'Написать статью в блог', tags:['работа','контент','статья'], status:'today', estimateMin:120, priority:3, updatedAt:days(0), createdAt:days(0)},
    {id:'t36', projectId:'p4', title:'Создать новый проект', tags:['работа','проект','создание'], status:'today', estimateMin:240, priority:3, updatedAt:days(0), createdAt:days(0)},
    {id:'t37', projectId:'p4', title:'Добавить новые функции', tags:['работа','функции','разработка'], status:'today', estimateMin:150, priority:3, updatedAt:days(0), createdAt:days(0)},
    {id:'t38', projectId:'p4', title:'Улучшить UX', tags:['работа','ux','улучшение'], status:'today', estimateMin:90, priority:3, updatedAt:days(0), createdAt:days(0)},
    {id:'t39', projectId:'p4', title:'Оптимизировать производительность', tags:['работа','оптимизация','производительность'], status:'today', estimateMin:120, priority:3, updatedAt:days(0), createdAt:days(0)}
  ];
  
  console.log("After init:", { domains: state.domains.length, projects: state.projects.length, tasks: state.tasks.length });
  console.log("Tasks for Дача domain:", state.tasks.filter(t => {
    const project = state.projects.find(p => p.id === t.projectId);
    return project && project.domainId === 'd2';
  }));
  
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

// Эмоциональная палитра доменов - расчет mood
export function getDomainMood(domainId) {
  const domain = state.domains.find(d => d.id === domainId);
  if (!domain) return 'balance';
  
  // Получаем все задачи домена (через проекты)
  const domainProjects = state.projects.filter(p => p.domainId === domainId);
  const domainTasks = state.tasks.filter(t => 
    domainProjects.some(p => p.id === t.projectId) || t.domainId === domainId
  );
  
  // Debug: calculating mood for domain
  
  if (domainTasks.length === 0) return 'balance';
  
  const now = Date.now();
  const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
  const threeDaysAgo = now - (3 * 24 * 60 * 60 * 1000);
  
  // 1. Crisis: есть просроченные задачи >3 дней
  const overdueTasks = domainTasks.filter(t => {
    if (t.status === 'done') return false;
    if (!t.due) return false;
    const dueTime = new Date(t.due).getTime();
    return dueTime < threeDaysAgo;
  });
  
  console.log(`Overdue tasks for ${domain.title}:`, overdueTasks.length, overdueTasks.map(t => ({ title: t.title, due: t.due })));
  
  if (overdueTasks.length > 0) {
    console.log(`Domain ${domain.title} is in CRISIS due to overdue tasks`);
    return 'crisis';
  }
  
  // 2. Pressure: много незавершенных p1/p2 задач (снижаем порог)
  const highPriorityTasks = domainTasks.filter(t => 
    t.status !== 'done' && (t.priority === 1 || t.priority === 2)
  );
  
  console.log(`High priority tasks for ${domain.title}:`, highPriorityTasks.length, highPriorityTasks.map(t => ({ title: t.title, priority: t.priority, status: t.status })));
  
  if (highPriorityTasks.length >= 2) { // Снижаем с 5 до 2
    console.log(`Domain ${domain.title} is under PRESSURE due to high priority tasks`);
    return 'pressure';
  }
  
  // 3. Growth: за 7 дней добавлено >3 задач (снижаем порог)
  const recentTasks = domainTasks.filter(t => {
    const createdTime = new Date(t.createdAt).getTime();
    return createdTime > sevenDaysAgo;
  });
  
  console.log(`Recent tasks for ${domain.title}:`, recentTasks.length, recentTasks.map(t => ({ title: t.title, createdAt: t.createdAt })));
  
  if (recentTasks.length > 3) { // Снижаем с 5 до 3
    console.log(`Domain ${domain.title} is in GROWTH due to recent tasks`);
    return 'growth';
  }
  
  // 4. Balance: все остальные случаи
  console.log(`Domain ${domain.title} is in BALANCE`);
  return 'balance';
}

// Цвета для mood
export function getMoodColor(mood) {
  const moodColors = {
    crisis: '#ef4444',    // Красный - кризис
    pressure: '#f59e0b',  // Оранжевый - давление
    growth: '#10b981',    // Зеленый - рост
    balance: '#3b82f6'    // Синий - баланс
  };
  return moodColors[mood] || moodColors.balance;
}

// Описание mood для подсказок
export function getMoodDescription(mood) {
  const descriptions = {
    crisis: 'Кризис: есть просроченные задачи',
    pressure: 'Давление: много приоритетных задач',
    growth: 'Рост: активно добавляются новые задачи',
    balance: 'Баланс: стабильное состояние'
  };
  return descriptions[mood] || descriptions.balance;
}
