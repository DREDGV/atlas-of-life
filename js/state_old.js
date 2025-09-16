// js/state.js
import { saveState } from "./storage.js";
import { 
  initHierarchyFields,
  setParentChild,
  removeParentChild,
  getParentObject,
  getChildObjects,
  validateHierarchy,
  isObjectLocked,
  setObjectLock,
  canMoveObject,
  canChangeHierarchy
} from "./hierarchy/index.js";
export const state = {
  view:'map',
  showLinks:true, showAging:true, showGlow:true,
  activeDomain:null,
  filterTag:null,
  wipLimit:3,
  settings: {
    layoutMode: 'auto',
    wipTodayLimit: 5,
    enableHierarchyV2: false, // Флаг для включения новой системы иерархии
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
  ideas:[],
  notes:[],
  maxEdges:300
};

export const now = Date.now();

// Функция для проверки включения системы иерархии v2
export function isHierarchyV2Enabled() {
  return state.settings.enableHierarchyV2 === true;
}

// Функция для включения/отключения системы иерархии v2
export function setHierarchyV2Enabled(enabled) {
  state.settings.enableHierarchyV2 = enabled;
  console.log(`🔄 Система иерархии v2: ${enabled ? 'включена' : 'отключена'}`);
}
export const days = d => now - d*24*3600*1000;

export function initDemoData(){
  // Инициализация демо-данных (убрана принудительная очистка для стабильности)
  console.log("Initializing demo data...");
  
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
  
  // Добавляем тестовые идеи и заметки
  state.ideas = [
    {id:'idea1', title:'Новая функция', content:'Добавить возможность создания идей прямо на карте', domainId:'d3', x: 200, y: 150, r: 35, color:'#ff6b6b', opacity: 0.4, createdAt:days(1), updatedAt:days(1)},
    {id:'idea2', title:'Улучшение UI', content:'Сделать интерфейс более интуитивным', domainId:'d3', x: -300, y: 100, r: 25, color:'#4ecdc4', opacity: 0.5, createdAt:days(2), updatedAt:days(2)},
    {id:'idea3', title:'Мобильная версия', content:'Адаптировать приложение для мобильных устройств', domainId:'d3', x: 100, y: -200, r: 40, color:'#45b7d1', opacity: 0.3, createdAt:days(3), updatedAt:days(3)}
  ];
  
  state.notes = [
    {id:'note1', title:'Важная заметка', content:'Не забыть про тестирование в Edge', domainId:'d3', x: 150, y: 300, r: 8, color:'#8b7355', opacity: 1.0, createdAt:days(1), updatedAt:days(1)},
    {id:'note2', title:'Идея для будущего', content:'Добавить синхронизацию с облаком', domainId:'d3', x: -250, y: -150, r: 6, color:'#a0a0a0', opacity: 1.0, createdAt:days(2), updatedAt:days(2)},
    {id:'note3', title:'Техническая заметка', content:'Оптимизировать рендеринг больших карт', domainId:'d3', x: 400, y: -100, r: 10, color:'#6c757d', opacity: 1.0, createdAt:days(3), updatedAt:days(3)}
  ];
  
  console.log("After init:", { domains: state.domains.length, projects: state.projects.length, tasks: state.tasks.length, ideas: state.ideas.length, notes: state.notes.length });
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

// Генератор уникальных ID
export function generateId() {
  return 'id_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
}
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

// ===== СИСТЕМА ИЕРАРХИИ И СВЯЗЕЙ =====

// Функция initHierarchyFields импортируется из модуля hierarchy/index.js

// Получение максимального радиуса по типу объекта
// Вспомогательные функции для иерархии импортируются из модуля hierarchy/index.js

// Получение родительского объекта
export function getParentObject(obj) {
  if (!obj || !obj.parentId) return null;
  
  // Ищем родителя по типу и ID
  const allObjects = [
    ...state.domains.map(d => ({...d, _type: 'domain'})),
    ...state.projects.map(p => ({...p, _type: 'project'})),
    ...state.tasks.map(t => ({...t, _type: 'task'})),
    ...state.ideas.map(i => ({...i, _type: 'idea'})),
    ...state.notes.map(n => ({...n, _type: 'note'}))
  ];
  
  return allObjects.find(o => o.id === obj.parentId) || null;
}

// Получение всех дочерних объектов
export function getChildObjects(obj) {
  if (!obj || !obj.children) return { projects: [], tasks: [], ideas: [], notes: [] };
  
  const children = { projects: [], tasks: [], ideas: [], notes: [] };
  
  // Получаем проекты
  if (obj.children.projects) {
    children.projects = state.projects.filter(p => obj.children.projects.includes(p.id));
  }
  
  // Получаем задачи
  if (obj.children.tasks) {
    children.tasks = state.tasks.filter(t => obj.children.tasks.includes(t.id));
  }
  
  // Получаем идеи
  if (obj.children.ideas) {
    children.ideas = state.ideas.filter(i => obj.children.ideas.includes(i.id));
  }
  
  // Получаем заметки
  if (obj.children.notes) {
    children.notes = state.notes.filter(n => obj.children.notes.includes(n.id));
  }
  
  return children;
}

// Установка связи родитель-ребенок
export function setParentChild(parentId, childId, childType) {
  if (!parentId || !childId || !childType) return false;
  
  // Находим родителя
  const parent = findObjectById(parentId);
  if (!parent) return false;
  
  // Находим ребенка
  const child = findObjectById(childId);
  if (!child) return false;
  
  // Инициализируем поля иерархии если нужно
  initHierarchyFields(parent, parent._type || 'domain');
  initHierarchyFields(child, childType);
  
  // Устанавливаем связь
  child.parentId = parentId;
  
  // Добавляем ребенка в список детей родителя
  const childArrayKey = childType + 's';
  if (!parent.children[childArrayKey]) {
    parent.children[childArrayKey] = [];
  }
  if (!parent.children[childArrayKey].includes(childId)) {
    parent.children[childArrayKey].push(childId);
  }
  
  return true;
}

// Удаление связи родитель-ребенок
export function removeParentChild(parentId, childId, childType) {
  if (!parentId || !childId || !childType) return false;
  
  // Находим родителя
  const parent = findObjectById(parentId);
  if (!parent) return false;
  
  // Находим ребенка
  const child = findObjectById(childId);
  if (!child) return false;
  
  // Удаляем связь
  child.parentId = null;
  
  // Удаляем ребенка из списка детей родителя
  const childArrayKey = childType + 's';
  if (parent.children && parent.children[childArrayKey]) {
    const index = parent.children[childArrayKey].indexOf(childId);
    if (index > -1) {
      parent.children[childArrayKey].splice(index, 1);
    }
  }
  
  return true;
}

// Поиск объекта по ID во всех коллекциях
export function findObjectById(id) {
  if (!id) return null;
  
  // Ищем во всех коллекциях
  const allObjects = [
    ...state.domains.map(d => ({...d, _type: 'domain'})),
    ...state.projects.map(p => ({...p, _type: 'project'})),
    ...state.tasks.map(t => ({...t, _type: 'task'})),
    ...state.ideas.map(i => ({...i, _type: 'idea'})),
    ...state.notes.map(n => ({...n, _type: 'note'}))
  ];
  
  return allObjects.find(o => o.id === id) || null;
}

// Старые функции иерархии удалены - используются новые из модуля hierarchy/index.js

// ===== СИСТЕМА ИЕРАРХИИ V2 =====
  console.log('🔄 Начинаем миграцию к системе иерархии...');
  
  // Мигрируем домены
  state.domains.forEach(domain => {
    initHierarchyFields(domain, 'domain');
  });
  
  // Мигрируем проекты
  state.projects.forEach(project => {
    initHierarchyFields(project, 'project');
    
    // Устанавливаем связь с доменом если есть
    if (project.domainId) {
      setParentChild(project.domainId, project.id, 'project');
    }
  });
  
  // Мигрируем задачи
  state.tasks.forEach(task => {
    initHierarchyFields(task, 'task');
    
    // Устанавливаем связь с проектом или доменом
    if (task.projectId) {
      setParentChild(task.projectId, task.id, 'task');
    } else if (task.domainId) {
      setParentChild(task.domainId, task.id, 'task');
    }
  });
  
  // Мигрируем идеи
  state.ideas.forEach(idea => {
    initHierarchyFields(idea, 'idea');
    
    // Идеи по умолчанию независимые, но могут быть привязаны к домену
    if (idea.domainId) {
      setParentChild(idea.domainId, idea.id, 'idea');
    }
  });
  
  // Мигрируем заметки
  state.notes.forEach(note => {
    initHierarchyFields(note, 'note');
    
    // Заметки по умолчанию независимые, но могут быть привязаны к домену
    if (note.domainId) {
      setParentChild(note.domainId, note.id, 'note');
    }
  });
  
  // Валидируем результат
  let errors = validateHierarchy();
  if (errors.length > 0) {
    console.warn('⚠️ Ошибки валидации иерархии:', errors.length);
    console.log('🔍 Первые 5 ошибок:', errors.slice(0, 5));
    console.log('🔍 Типы ошибок:', [...new Set(errors.map(err => err.type))]);
    
    // Пытаемся исправить ошибки
    const fixed = fixHierarchyErrors();
    if (fixed > 0) {
      console.log(`🔧 Исправлено ${fixed} ошибок, повторная валидация...`);
      errors = validateHierarchy();
      if (errors.length === 0) {
        console.log('✅ Все ошибки исправлены!');
      } else {
        console.warn(`⚠️ Осталось ${errors.length} ошибок после исправления`);
        console.log('🔍 Оставшиеся типы ошибок:', [...new Set(errors.map(err => err.type))]);
      }
    }
  } else {
    console.log('✅ Миграция к системе иерархии завершена успешно');
  }
  
  return errors.length === 0;
}

// Исправление ошибок валидации
export function fixHierarchyErrors() {
  console.log('🔧 Исправляем ошибки иерархии...');
  
  const errors = validateHierarchy();
  let fixed = 0;
  
  // Создаем копию ошибок для безопасной итерации
  const errorsToFix = [...errors];
  
  errorsToFix.forEach(error => {
    switch (error.type) {
      case 'missing_parent':
        // Удаляем ссылку на несуществующего родителя
        const obj = findObjectById(error.objectId);
        if (obj) {
          console.log(`🔧 Исправляем missing_parent: ${error.objectId} -> null`);
          obj.parentId = null;
          fixed++;
        }
        break;
        
      case 'missing_child':
        // Удаляем ссылку на несуществующего ребенка
        const parent = findObjectById(error.objectId);
        if (parent && parent.children) {
          Object.keys(parent.children).forEach(childType => {
            const index = parent.children[childType].indexOf(error.childId);
            if (index > -1) {
              console.log(`🔧 Исправляем missing_child: ${error.objectId} удаляет ${error.childId} из ${childType}`);
              parent.children[childType].splice(index, 1);
              fixed++;
            }
          });
        }
        break;
        
      case 'mismatched_relation':
        // Исправляем несоответствие связи
        const child = findObjectById(error.childId);
        if (child) {
          console.log(`🔧 Исправляем mismatched_relation: ${error.childId} -> ${error.objectId}`);
          child.parentId = error.objectId;
          fixed++;
        }
        break;
    }
  });
  
  // Сохраняем изменения
  if (fixed > 0) {
    try {
      saveState();
      console.log(`💾 Изменения сохранены в localStorage`);
    } catch (e) {
      console.error('Ошибка сохранения:', e);
    }
  }
  
  console.log(`✅ Исправлено ${fixed} ошибок иерархии`);
  return fixed;
}

// Очистка иерархии и повторная миграция
export function resetAndMigrateHierarchy() {
  console.log('🔄 Очищаем иерархию и выполняем повторную миграцию...');
  
  // Очищаем все поля иерархии
  const allObjects = [
    ...state.domains,
    ...state.projects,
    ...state.tasks,
    ...state.ideas,
    ...state.notes
  ];
  
  allObjects.forEach(obj => {
    delete obj.parentId;
    delete obj.children;
    delete obj.locks;
    delete obj.constraints;
  });
  
  // Сохраняем очищенное состояние
  try {
    saveState();
    console.log('💾 Очищенное состояние сохранено');
  } catch (e) {
    console.error('Ошибка сохранения очищенного состояния:', e);
  }
  
  // Выполняем миграцию заново
  return migrateToHierarchy();
}

// Полная очистка иерархии без миграции
export function clearHierarchy() {
  console.log('🧹 Полная очистка иерархии...');
  
  const allObjects = [
    ...state.domains,
    ...state.projects,
    ...state.tasks,
    ...state.ideas,
    ...state.notes
  ];
  
  allObjects.forEach(obj => {
    delete obj.parentId;
    delete obj.children;
    delete obj.locks;
    delete obj.constraints;
  });
  
  try {
    saveState();
    console.log('✅ Иерархия полностью очищена');
    return true;
  } catch (e) {
    console.error('Ошибка очистки иерархии:', e);
    return false;
  }
}

// Функции для работы с блокировками
export function isObjectLocked(obj, lockType) {
  if (!obj || !obj.locks) return false;
  return obj.locks[lockType] === true;
}

export function canMoveObject(obj) {
  return !isObjectLocked(obj, 'move');
}

export function canChangeHierarchy(obj) {
  return !isObjectLocked(obj, 'hierarchy');
}

export function getLockedObjects() {
  const allObjects = [
    ...state.domains.map(d => ({...d, _type: 'domain'})),
    ...state.projects.map(p => ({...p, _type: 'project'})),
    ...state.tasks.map(t => ({...t, _type: 'task'})),
    ...state.ideas.map(i => ({...i, _type: 'idea'})),
    ...state.notes.map(n => ({...n, _type: 'note'}))
  ];
  
  return allObjects.filter(obj => 
    isObjectLocked(obj, 'move') || isObjectLocked(obj, 'hierarchy')
  );
}

// Функции для изменения связей
export function attachObjectToParent(childId, childType, parentId, parentType) {
  console.log(`🔗 Attaching ${childType} ${childId} to ${parentType} ${parentId}`);
  
  // Находим объекты
  const child = findObjectById(childId);
  const parent = findObjectById(parentId);
  
  if (!child || !parent) {
    console.error('❌ Object not found:', { childId, parentId });
    return false;
  }
  
  // Проверяем блокировки
  if (!canChangeHierarchy(child) || !canChangeHierarchy(parent)) {
    console.warn('🚫 Hierarchy change blocked by locks');
    return false;
  }
  
  // Отвязываем от старого родителя
  if (child.parentId) {
    removeParentChild(child.parentId, childId, childType);
  }
  
  // Устанавливаем нового родителя
  child.parentId = parentId;
  if (parentType === 'domain') {
    child.domainId = parentId;
    child.projectId = null;
  } else if (parentType === 'project') {
    child.projectId = parentId;
    child.domainId = parent.domainId; // Наследуем домен от проекта
  }
  
  // Добавляем в детей родителя
  setParentChild(parentId, childId, childType);
  
  child.updatedAt = Date.now();
  parent.updatedAt = Date.now();
  
  console.log(`✅ Successfully attached ${childType} ${childId} to ${parentType} ${parentId}`);
  return true;
}

export function detachObjectFromParent(childId, childType) {
  console.log(`🔓 Detaching ${childType} ${childId} from parent`);
  
  const child = findObjectById(childId);
  if (!child) {
    console.error('❌ Child object not found:', childId);
    return false;
  }
  
  // Проверяем блокировки
  if (!canChangeHierarchy(child)) {
    console.warn('🚫 Hierarchy change blocked by locks');
    return false;
  }
  
  // Отвязываем от родителя
  if (child.parentId) {
    const success = removeParentChild(child.parentId, childId, childType);
    if (!success) {
      console.warn('⚠️ Failed to remove from parent children list');
    }
  }
  
  // Очищаем связи (removeParentChild уже установил parentId = null)
  if (childType === 'task' || childType === 'idea' || childType === 'note') {
    child.projectId = null;
    child.domainId = null;
  } else if (childType === 'project') {
    child.domainId = null;
  }
  
  child.updatedAt = Date.now();
  
  console.log(`✅ Successfully detached ${childType} ${childId}`);
  return true;
}

export function getAvailableParents(childType) {
  const parents = [];
  
  if (childType === 'project') {
    // Проекты могут принадлежать доменам
    parents.push(...state.domains.map(d => ({...d, _type: 'domain'})));
  } else if (childType === 'task' || childType === 'idea' || childType === 'note') {
    // Задачи, идеи, заметки могут принадлежать проектам и доменам
    parents.push(...state.domains.map(d => ({...d, _type: 'domain'})));
    parents.push(...state.projects.map(p => ({...p, _type: 'project'})));
  }
  
  return parents.filter(p => canChangeHierarchy(p));
}

// Функции для работы с идеями
export function createIdea(title, content = '', domainId = null) {
  const idea = {
    id: generateId(),
    title: title || 'Новая идея',
    content: content,
    domainId: domainId,
    x: Math.random() * 2000 - 1000,
    y: Math.random() * 2000 - 1000,
    r: 20 + Math.random() * 30, // 20-50px радиус
    color: getRandomIdeaColor(),
    opacity: 0.3 + Math.random() * 0.3, // 0.3-0.6
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  state.ideas.push(idea);
  return idea;
}

// Функции для работы с заметками
export function createNote(title, content = '', domainId = null) {
  const note = {
    id: generateId(),
    title: title || 'Новая заметка',
    content: content,
    domainId: domainId,
    x: Math.random() * 2000 - 1000,
    y: Math.random() * 2000 - 1000,
    r: 4 + Math.random() * 8, // 4-12px радиус
    color: getRandomNoteColor(),
    opacity: 1.0,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  state.notes.push(note);
  return note;
}

// Цветовые палитры
export function getRandomIdeaColor() {
  const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4', '#feca57', '#ff9ff3'];
  return colors[Math.floor(Math.random() * colors.length)];
}

export function getRandomNoteColor() {
  const colors = ['#8b7355', '#a0a0a0', '#6c757d', '#495057', '#343a40'];
  return colors[Math.floor(Math.random() * colors.length)];
}

// ===== СИСТЕМА ИЕРАРХИИ V2 =====

/**
 * Получение объекта по ID
 * @param {string} id - ID объекта
 * @returns {Object|null} Объект или null
 */
export function findObjectById(id) {
  const allObjects = [
    ...state.domains,
    ...state.projects,
    ...state.tasks,
    ...state.ideas,
    ...state.notes
  ];
  return allObjects.find(obj => obj.id === id) || null;
}

/**
 * Получение типа объекта
 * @param {Object} obj - Объект
 * @returns {string} Тип объекта
 */
export function getObjectType(obj) {
  if (obj.title && obj.mood) return 'domain';
  if (obj.title && obj.domainId) return 'project';
  if (obj.title && obj.status) return 'task';
  if (obj.title && obj.content) return 'idea';
  if (obj.title && obj.text) return 'note';
  return 'unknown';
}

/**
 * Инициализация системы иерархии для всех объектов
 * @returns {Object} Результат инициализации
 */
export function initializeHierarchySystem() {
  try {
    console.log('🚀 Инициализация системы иерархии v2...');
    
    const result = {
      success: false,
      processedObjects: 0,
      errors: [],
      warnings: []
    };

    // Инициализируем поля иерархии для всех объектов
    const allObjects = [
      ...state.domains,
      ...state.projects,
      ...state.tasks,
      ...state.ideas,
      ...state.notes
    ];

    allObjects.forEach(obj => {
      try {
        const objType = getObjectType(obj);
        initHierarchyFields(obj, objType);
        result.processedObjects++;
      } catch (error) {
        result.errors.push(`Ошибка инициализации ${obj.id}: ${error.message}`);
      }
    });

    // Валидируем иерархию
    const validationErrors = validateHierarchy(state);
    if (validationErrors.length > 0) {
      result.warnings.push(`Найдено ${validationErrors.length} ошибок валидации`);
    }

    result.success = result.errors.length === 0;
    
    if (result.success) {
      console.log(`✅ Система иерархии инициализирована. Обработано объектов: ${result.processedObjects}`);
    } else {
      console.warn(`⚠️ Инициализация завершена с ошибками. Ошибок: ${result.errors.length}`);
    }

    return result;

  } catch (error) {
    console.error('❌ initializeHierarchySystem: Критическая ошибка инициализации:', error);
    return {
      success: false,
      processedObjects: 0,
      errors: [`Критическая ошибка: ${error.message}`],
      warnings: []
    };
  }
}

/**
 * Восстановление связей на основе существующих полей
 * @returns {Object} Результат восстановления
 */
export function restoreHierarchyConnections() {
  try {
    console.log('🔗 Восстановление связей иерархии...');
    
    const result = {
      success: false,
      restoredConnections: 0,
      errors: [],
      details: []
    };

    // Восстанавливаем связи проектов с доменами
    state.projects.forEach(project => {
      if (project.domainId) {
        try {
          if (setParentChild(project.domainId, project.id, 'project')) {
            result.restoredConnections++;
            result.details.push(`Восстановлена связь: ${project.domainId} → ${project.id} (project)`);
          }
        } catch (error) {
          result.errors.push(`Ошибка восстановления связи проекта ${project.id}: ${error.message}`);
        }
      }
    });

    // Восстанавливаем связи задач с проектами или доменами
    state.tasks.forEach(task => {
      if (task.projectId) {
        try {
          if (setParentChild(task.projectId, task.id, 'task')) {
            result.restoredConnections++;
            result.details.push(`Восстановлена связь: ${task.projectId} → ${task.id} (task)`);
          }
        } catch (error) {
          result.errors.push(`Ошибка восстановления связи задачи ${task.id}: ${error.message}`);
        }
      } else if (task.domainId) {
        try {
          if (setParentChild(task.domainId, task.id, 'task')) {
            result.restoredConnections++;
            result.details.push(`Восстановлена связь: ${task.domainId} → ${task.id} (task)`);
          }
        } catch (error) {
          result.errors.push(`Ошибка восстановления связи задачи ${task.id}: ${error.message}`);
        }
      }
    });

    // Восстанавливаем связи идей с доменами
    state.ideas.forEach(idea => {
      if (idea.domainId) {
        try {
          if (setParentChild(idea.domainId, idea.id, 'idea')) {
            result.restoredConnections++;
            result.details.push(`Восстановлена связь: ${idea.domainId} → ${idea.id} (idea)`);
          }
        } catch (error) {
          result.errors.push(`Ошибка восстановления связи идеи ${idea.id}: ${error.message}`);
        }
      }
    });

    // Восстанавливаем связи заметок с доменами
    state.notes.forEach(note => {
      if (note.domainId) {
        try {
          if (setParentChild(note.domainId, note.id, 'note')) {
            result.restoredConnections++;
            result.details.push(`Восстановлена связь: ${note.domainId} → ${note.id} (note)`);
          }
        } catch (error) {
          result.errors.push(`Ошибка восстановления связи заметки ${note.id}: ${error.message}`);
        }
      }
    });

    result.success = result.errors.length === 0;
    
    if (result.success) {
      console.log(`✅ Связи восстановлены. Восстановлено связей: ${result.restoredConnections}`);
    } else {
      console.warn(`⚠️ Восстановление завершено с ошибками. Ошибок: ${result.errors.length}`);
    }

    return result;

  } catch (error) {
    console.error('❌ restoreHierarchyConnections: Критическая ошибка восстановления:', error);
    return {
      success: false,
      restoredConnections: 0,
      errors: [`Критическая ошибка: ${error.message}`],
      details: []
    };
  }
}

/**
 * Полная миграция к системе иерархии v2
 * @param {Object} options - Опции миграции
 * @returns {Object} Результат миграции
 */
export function migrateToHierarchyV2(options = {}) {
  try {
    console.log('🚀 Начинаем полную миграцию к системе иерархии v2...');
    
    const result = {
      success: false,
      steps: [],
      errors: [],
      warnings: []
    };

    // Шаг 1: Инициализация системы
    console.log('📋 Шаг 1: Инициализация системы...');
    const initResult = initializeHierarchySystem();
    result.steps.push({
      step: 1,
      name: 'Инициализация системы',
      success: initResult.success,
      details: initResult
    });

    if (!initResult.success) {
      result.errors.push(...initResult.errors);
      return result;
    }

    // Шаг 2: Восстановление связей
    console.log('🔗 Шаг 2: Восстановление связей...');
    const restoreResult = restoreHierarchyConnections();
    result.steps.push({
      step: 2,
      name: 'Восстановление связей',
      success: restoreResult.success,
      details: restoreResult
    });

    if (!restoreResult.success) {
      result.warnings.push(...restoreResult.errors);
    }

    // Шаг 3: Валидация
    console.log('🔍 Шаг 3: Валидация иерархии...');
    const validationErrors = validateHierarchy(state);
    result.steps.push({
      step: 3,
      name: 'Валидация иерархии',
      success: validationErrors.length === 0,
      details: { errors: validationErrors }
    });

    if (validationErrors.length > 0) {
      result.warnings.push(`Найдено ${validationErrors.length} ошибок валидации`);
    }

    // Шаг 4: Сохранение
    console.log('💾 Шаг 4: Сохранение состояния...');
    try {
      saveState();
      result.steps.push({
        step: 4,
        name: 'Сохранение состояния',
        success: true,
        details: { message: 'Состояние успешно сохранено' }
      });
    } catch (error) {
      result.errors.push(`Ошибка сохранения: ${error.message}`);
      result.steps.push({
        step: 4,
        name: 'Сохранение состояния',
        success: false,
        details: { error: error.message }
      });
    }

    result.success = result.errors.length === 0;
    
    if (result.success) {
      console.log('✅ Миграция завершена успешно!');
    } else {
      console.warn(`⚠️ Миграция завершена с ошибками. Ошибок: ${result.errors.length}`);
    }

    return result;

  } catch (error) {
    console.error('❌ migrateToHierarchyV2: Критическая ошибка миграции:', error);
    return {
      success: false,
      steps: [],
      errors: [`Критическая ошибка: ${error.message}`],
      warnings: []
    };
  }
}

/**
 * Откат миграции
 * @returns {Object} Результат отката
 */
export function rollbackHierarchyMigration() {
  try {
    console.log('⏪ Откат миграции иерархии...');
    
    const result = {
      success: false,
      clearedObjects: 0,
      errors: [],
      details: []
    };

    const allObjects = [
      ...state.domains,
      ...state.projects,
      ...state.tasks,
      ...state.ideas,
      ...state.notes
    ];

    allObjects.forEach(obj => {
      try {
        let cleared = false;
        
        // Удаляем поля иерархии
        if (obj.parentId) {
          obj.parentId = null;
          cleared = true;
        }
        
        if (obj.children) {
          obj.children = {
            projects: [],
            tasks: [],
            ideas: [],
            notes: []
          };
          cleared = true;
        }
        
        if (obj.locks) {
          delete obj.locks;
          cleared = true;
        }
        
        if (obj.constraints) {
          delete obj.constraints;
          cleared = true;
        }

        if (cleared) {
          result.clearedObjects++;
          result.details.push(`Очищен объект: ${obj.id}`);
        }

      } catch (error) {
        result.errors.push(`Ошибка очистки ${obj.id}: ${error.message}`);
      }
    });

    // Сохраняем очищенное состояние
    try {
      saveState();
      result.details.push('Очищенное состояние сохранено');
    } catch (error) {
      result.errors.push(`Ошибка сохранения: ${error.message}`);
    }

    result.success = result.errors.length === 0;
    
    if (result.success) {
      console.log(`✅ Откат завершен. Очищено объектов: ${result.clearedObjects}`);
    } else {
      console.warn(`⚠️ Откат завершен с ошибками. Ошибок: ${result.errors.length}`);
    }

    return result;

  } catch (error) {
    console.error('❌ rollbackHierarchyMigration: Критическая ошибка отката:', error);
    return {
      success: false,
      clearedObjects: 0,
      errors: [`Критическая ошибка: ${error.message}`],
      details: []
    };
  }
}

/**
 * Получение статистики иерархии
 * @returns {Object} Статистика иерархии
 */
export function getHierarchyStatistics() {
  try {
    const allObjects = [
      ...state.domains,
      ...state.projects,
      ...state.tasks,
      ...state.ideas,
      ...state.notes
    ];

    const stats = {
      total: allObjects.length,
      withParent: 0,
      withoutParent: 0,
      totalConnections: 0,
      byType: {
        domains: { total: 0, withParent: 0, children: 0 },
        projects: { total: 0, withParent: 0, children: 0 },
        tasks: { total: 0, withParent: 0, children: 0 },
        ideas: { total: 0, withParent: 0, children: 0 },
        notes: { total: 0, withParent: 0, children: 0 }
      }
    };

    allObjects.forEach(obj => {
      const objType = getObjectType(obj);
      const typeKey = objType + 's';
      
      if (stats.byType[typeKey]) {
        stats.byType[typeKey].total++;
        
        if (obj.parentId) {
          stats.withParent++;
          stats.byType[typeKey].withParent++;
        } else {
          stats.withoutParent++;
        }

        // Подсчитываем детей
        if (obj.children) {
          const childrenCount = Object.values(obj.children).reduce((sum, arr) => sum + arr.length, 0);
          stats.totalConnections += childrenCount;
          stats.byType[typeKey].children += childrenCount;
        }
      }
    });

    return stats;

  } catch (error) {
    console.error('❌ getHierarchyStatistics: Ошибка получения статистики:', error);
    return {
      total: 0,
      withParent: 0,
      withoutParent: 0,
      totalConnections: 0,
      byType: {}
    };
  }
}
