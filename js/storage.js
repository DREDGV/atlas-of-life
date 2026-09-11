// js/storage.js
import { state, normalizeTags } from './state.js';
import adapter from './storageAdapter.js';
import { logEvent } from './utils/analytics.js';

// Schema versioning + migrations
const SCHEMA_VERSION = 9;
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

// Sync v1 C3: persisted Inbox tombstones (id, baseVersion at delete time,
// deletedAt, removal snapshot). Missing/legacy data degrades to an empty list.
function normalizeInboxTombstones(entries){
  if (!Array.isArray(entries)) return [];
  return entries
    .filter(entry => entry && typeof entry === 'object' && entry.id)
    .map(entry => ({
      id: String(entry.id),
      baseVersion: Number(entry.baseVersion) || null,
      deletedAt: Number(entry.deletedAt) || 0,
      removal: entry.removal || null,
    }));
}

function normalizeKnowledge(entries){
  return Array.isArray(entries) ? entries.filter(entry => entry && entry.id &&
    ['thought', 'note'].includes(entry.kind) && typeof entry.text === 'string')
    .map(({ _type, ...entry }) => ({ ...entry })) : [];
}

// Day planning migration helper: local calendar day of the migration moment.
function plannedDayKey(now = Date.now()){
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
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
  // 4 -> 5: Sync v1 C3 — persisted Inbox tombstones (delete/restore race
  // detection). Missing/legacy data degrades to an empty list.
  (data) => ({
    ...data,
    inboxTombstones: normalizeInboxTombstones(data?.inboxTombstones),
  }),
  // 5 -> 6: explicit materials; legacy processed Inbox stays untouched.
  data => ({ ...data, knowledge: normalizeKnowledge(data?.knowledge) }),
  data => ({ ...data, pendingSyncOperations: [] }),
  // 7 -> 8: material action provenance; older writers must not remove its source.
  data => ({ ...data }),
  // 8 -> 9: day planning (Today 2.0). A legacy `today`/`doing` task is anchored
  // to the migration day (the original day is unknowable); all other tasks are
  // "not planned". Focus defaults to off. `due` is never touched.
  data => ({
    ...data,
    tasks: Array.isArray(data.tasks)
      ? data.tasks.map(task => ({
          ...task,
          plannedDay: typeof task.plannedDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(task.plannedDay)
            ? task.plannedDay
            : ((task.status === 'today' || task.status === 'doing') ? plannedDayKey() : null),
          focus: task.focus === true,
        }))
      : data.tasks,
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

// Loading is a read/validate/commit boundary. Never initialize demo state after
// a failed read, malformed document, future schema or failed migration write.
export const BACKUP_KEY = 'atlas_v2_previous';
export const RECOVERY_KEY = 'atlas_v2_recovery_original';
let storageStatus = { status:'uninitialized', error:null };
export function getStorageStatus(){ return { ...storageStatus }; }

export function prepareState(raw){
  let data = JSON.parse(raw);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Неверный формат данных Atlas');
  const version = data.schema ?? 0;
  if (!Number.isInteger(version) || version < 0 || version > SCHEMA_VERSION) throw new Error('Версия данных не поддерживается. Откройте их в подходящей версии Atlas.');
  for (const key of ['domains', 'projects', 'tasks']) {
    if (!Array.isArray(data[key]) || data[key].some(item => !item || typeof item !== 'object' || !item.id)) throw new Error(`Повреждён раздел ${key}`);
  }
  for (const key of ['inbox', 'knowledge', 'operationLog', 'taskProjections', 'inboxTombstones', 'pendingSyncOperations']) {
    if (data[key] !== undefined && !Array.isArray(data[key])) throw new Error(`Повреждён раздел ${key}`);
  }
  const materialIds = new Set((data.knowledge || []).map(item => item?.id));
  if (data.tasks.some(task => task.sourceKnowledgeId && !materialIds.has(task.sourceKnowledgeId))) {
    throw new Error('У связанной задачи отсутствует материал-источник. Исходник сохранён.');
  }
  if (data.pendingSyncOperations?.some(operation => !operation || typeof operation.id !== 'string' || typeof operation.type !== 'string')) {
    throw new Error('Повреждены сохранённые операции Sync. Исходник сохранён.');
  }
  // Normalization may repair legacy representation, never silently drop records.
  for (const [key, normalize] of Object.entries({ inbox:normalizeInboxEntries, knowledge:normalizeKnowledge,
    operationLog:normalizeOperationLog, taskProjections:normalizeTaskProjections, inboxTombstones:normalizeInboxTombstones })) {
    if (Array.isArray(data[key]) && normalize(data[key]).length !== Math.min(data[key].length, key === 'operationLog' ? OPERATION_LOG_LIMIT : Infinity)) {
      throw new Error(`В разделе ${key} есть нечитаемые записи. Исходник сохранён.`);
    }
  }
  for (let cur = version; cur < SCHEMA_VERSION; cur++) data = MIGRATIONS[cur](data);
  return {
    schema: SCHEMA_VERSION,
    domains: normalizeEntities(data.domains, { tags:false }),
    projects: normalizeEntities(data.projects),
    tasks: normalizeEntities(data.tasks),
    knowledge: normalizeKnowledge(data.knowledge),
    inbox: normalizeInboxEntries(data.inbox),
    operationLog: normalizeOperationLog(data.operationLog),
    taskProjections: normalizeTaskProjections(data.taskProjections),
    inboxTombstones: normalizeInboxTombstones(data.inboxTombstones),
    pendingSyncOperations: Array.isArray(data.pendingSyncOperations) ? data.pendingSyncOperations : [],
    maxEdges: typeof data.maxEdges === 'number' ? data.maxEdges : 300,
    showLinks: data.showLinks ?? true,
    showAging: data.showAging ?? true,
    showGlow: data.showGlow ?? true,
    view: ['today','knowledge'].includes(data.view) ? data.view : 'map',
    settings: data.settings && typeof data.settings === 'object' ? data.settings : { layoutMode:'auto' },
  };
}

function applyPrepared(data){
  for (const [key, value] of Object.entries(data)) {
    if (key !== 'schema') state[key] = value;
  }
}

export function loadState(){
  try {
    const raw = adapter.load();
    if (raw === null) {
      storageStatus = { status:'empty', error:null };
      return false;
    }
    const data = prepareState(raw);
    const firstDom = data.domains[0]?.id || null;
    data.tasks.forEach(task => {
      if (!task.projectId && !task.domainId) task.domainId = firstDom;
    });
    if ((JSON.parse(raw).schema ?? 0) < SCHEMA_VERSION) {
      localStorage.setItem(BACKUP_KEY, raw);
      adapter.save(JSON.stringify(data));
    }
    applyPrepared(data);
    storageStatus = { status:'ready', error:null };
    return true;
  } catch (error) {
    storageStatus = { status:'error', error: error?.message || 'Не удалось прочитать хранилище' };
    return false;
  }
}

function serializeState(){
  return {
    schema:SCHEMA_VERSION, exportedAt:Date.now(),
    domains:normalizeEntities(state.domains, { tags:false }),
    projects:normalizeEntities(state.projects), tasks:normalizeEntities(state.tasks),
    knowledge:normalizeKnowledge(state.knowledge), inbox:normalizeInboxEntries(state.inbox),
    operationLog:normalizeOperationLog(state.operationLog),
    taskProjections:normalizeTaskProjections(state.taskProjections),
    inboxTombstones:normalizeInboxTombstones(state.inboxTombstones),
    pendingSyncOperations:state.pendingSyncOperations,
    maxEdges:state.maxEdges, showLinks:!!state.showLinks, showAging:!!state.showAging,
    showGlow:!!state.showGlow, view:state.view, settings:state.settings || { layoutMode:'auto' },
  };
}

export function saveState(options = {}){
  try {
    if (storageStatus.status === 'error') throw new Error('Данные не загружены. Сначала восстановите хранилище.');
    const text = JSON.stringify(serializeState());
    const previous = adapter.load();
    // A snapshot failure refuses the replacement; the original remains intact.
    if (options.backup !== false && previous !== null && previous !== text) localStorage.setItem(BACKUP_KEY, previous);
    adapter.save(text);
    storageStatus = { status:'ready', error:null };
    try {
      if (options.notify !== false && typeof window !== 'undefined') {
        window.mapApi?.layoutMap?.(); window.mapApi?.drawMap?.();
        window.renderSidebar?.(); window.renderToday?.();
        window.renderKnowledge?.();
      }
    } catch (_) {}
    return true;
  } catch (error) {
    console.warn('saveState error', error);
    if (typeof window !== 'undefined') window.showToast?.('Ошибка сохранения данных: ' + error.message, 'warn');
    throw error;
  }
}

export function downloadStateText(text, name = 'atlas_export.json'){
  const url = URL.createObjectURL(new Blob([text], { type:'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function exportJson(){
  // Delivery intent is local to this device, never replay imported operations.
  const data = serializeState();
  delete data.pendingSyncOperations;
  downloadStateText(JSON.stringify(data, null, 2));
}

// Called only by Core's explicit restore/import command. Validate and preserve
// the original before replacing; a failed write never changes the in-memory Atlas.
export function replaceStoredState(raw, operation, options = {}){
  const candidate = prepareState(raw);
  candidate.pendingSyncOperations = [...new Map([
    ...(options.localBackup ? candidate.pendingSyncOperations : []),
    ...state.pendingSyncOperations,
  ].map(operation => [operation.id, operation])).values()];
  const domains = new Set(candidate.domains.map(item => item.id));
  const projects = new Set(candidate.projects.map(item => item.id));
  for (const project of candidate.projects) if (!domains.has(project.domainId)) throw new Error('Неизвестный домен проекта');
  for (const task of candidate.tasks) if (task.projectId && !projects.has(task.projectId)) throw new Error('Неизвестный проект задачи');
  candidate.operationLog.push(operation);
  const previous = adapter.load();
  if (previous !== null) localStorage.setItem(RECOVERY_KEY, previous);
  adapter.save(JSON.stringify(candidate));
  applyPrepared(candidate);
  storageStatus = { status:'ready', error:null };
  return true;
}

export function importJsonV26(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = async () => {
      try {
        const { restoreAtlasSnapshot } = await import('./core/commands.js');
        resolve(restoreAtlasSnapshot(reader.result));
      } catch (error) { reject(error); }
    };
    reader.readAsText(file);
  });
}
export const importJson = importJsonV26;
