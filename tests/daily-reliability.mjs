import assert from 'node:assert/strict';
import { state } from '../js/state.js';
import adapter from '../js/storageAdapter.js';
import { loadState, saveState, getStorageStatus, BACKUP_KEY, RECOVERY_KEY } from '../js/storage.js';
import { createTask, updateTask, captureInbox, routeInboxToTask, restoreAtlasSnapshot, flushPendingSyncOperations } from '../js/core/commands.js';
import { listOutbox } from '../js/sync/outbox.js';
import { todayGroups } from '../js/features/today/model.js';

const memory = new Map();
let failRead = false, failWrite = null;
globalThis.localStorage = {
  getItem(key){ if (failRead) throw new Error('read denied'); return memory.get(key) ?? null; },
  setItem(key,value){ if (key === failWrite) throw new Error('write denied'); memory.set(key,String(value)); },
  removeItem(key){ memory.delete(key); },
};
const fixture = { schema:7, domains:[{ id:'d1', title:'Home' }], projects:[], tasks:[], inbox:[], knowledge:[], operationLog:[] };
const reset = () => { failRead = false; failWrite = null; memory.clear(); memory.set(adapter.key, JSON.stringify(fixture)); assert(loadState()); };
const oldWarn = console.warn;
console.warn = () => {};
try {
  reset();
  const before = JSON.stringify(state);
  failRead = true;
  assert.equal(loadState(), false); assert.equal(getStorageStatus().status,'error');
  assert.throws(() => createTask({ title:'unsafe' }));
  assert.equal(JSON.stringify(state),before);
  failRead = false;
  memory.set(adapter.key,'{corrupt');
  assert.equal(loadState(),false); assert.throws(() => saveState());
  assert.equal(memory.get(adapter.key),'{corrupt');
  memory.set(adapter.key,JSON.stringify({...fixture,schema:999}));
  assert.equal(loadState(),false); assert.equal(getStorageStatus().status,'error');
  memory.set(adapter.key,JSON.stringify({...fixture,pendingSyncOperations:[null]}));
  assert.equal(loadState(),false); assert.equal(getStorageStatus().status,'error');
  memory.delete(adapter.key); assert.equal(loadState(),false); assert.equal(getStorageStatus().status,'empty');
  reset();
  const original = memory.get(adapter.key);
  createTask({ id:'planned', title:'Chosen', status:'today', domainId:'d1', due:{date:'2099-01-01',time:null} });
  assert.equal(memory.get(BACKUP_KEY),original);
  const stable = JSON.stringify(state), stored = memory.get(adapter.key);
  failWrite = adapter.key; assert.throws(() => updateTask('planned',{status:'done'}));
  assert.equal(JSON.stringify(state),stable); assert.equal(memory.get(adapter.key),stored);
  failWrite = BACKUP_KEY; assert.throws(() => updateTask('planned',{status:'done'}));
  assert.equal(JSON.stringify(state),stable); assert.equal(memory.get(adapter.key),stored);
  failWrite = null;
  updateTask('planned',{status:'done'},{now:new Date(2026,8,6,12).getTime()});
  loadState();
  assert.equal(todayGroups(state.tasks,new Date(2026,8,6)).completed.length,1);
  updateTask('planned',{status:'today'});
  assert.equal(state.tasks[0].due.date,'2099-01-01');
  createTask({ id:'deadline', title:'Due', domainId:'d1', due:{date:'2026-09-06',time:null} });
  const groups = todayGroups(state.tasks,new Date(2026,8,6));
  assert.equal(groups.planned[0].id,'planned'); assert.equal(groups.deadlines[0].id,'deadline');
  // Same due date: priorities sort ascending P1 → P2 → P3 (P1 is the highest).
  createTask({ id:'p3', title:'P3', domainId:'d1', priority:3, due:{date:'2026-09-05',time:null} });
  createTask({ id:'p1', title:'P1', domainId:'d1', priority:1, due:{date:'2026-09-05',time:null} });
  createTask({ id:'p2', title:'P2', domainId:'d1', priority:2, due:{date:'2026-09-05',time:null} });
  const sameDuePriorities = todayGroups(state.tasks,new Date(2026,8,6)).deadlines
    .filter(task => task.due?.date === '2026-09-05')
    .map(task => task.priority);
  assert.deepEqual(sameDuePriorities,[1,2,3]);
  assert.throws(() => updateTask('planned',{projectId:'missing'}));
  const [inbox] = captureInbox('Routed',{itemType:'task'});
  routeInboxToTask(inbox.id,{domainId:'d1'});
  failWrite = 'atlas-sync-outbox-v1';
  updateTask(inbox.resultRef.id,{status:'done'});
  const saved = JSON.parse(memory.get(adapter.key));
  assert(saved.pendingSyncOperations.some(op => op.type === 'task.result.upsert' && op.payload.projection.status === 'done'));
  assert(saved.operationLog.some(op => op.type === 'task.result.upsert' && op.payload.projection.status === 'done'));
  loadState(); failWrite = null; flushPendingSyncOperations();
  assert(listOutbox().some(entry => entry.operation.payload?.projection?.status === 'done'));
  const outboxBefore = memory.get('atlas-sync-outbox-v1');
  memory.set('atlas-sync-outbox-v1','{outbox-original');
  captureInbox('Preserve queue');
  assert.equal(memory.get('atlas-sync-outbox-v1'),'{outbox-original');
  assert(state.pendingSyncOperations.length > 0);
  memory.set('atlas-sync-outbox-v1',outboxBefore); flushPendingSyncOperations();
  const restoredBefore = JSON.stringify(state);
  failWrite = adapter.key;
  assert.throws(() => restoreAtlasSnapshot(JSON.stringify(fixture)));
  assert.equal(JSON.stringify(state),restoredBefore);
  failWrite = null;
  memory.set(adapter.key,'{corrupt'); loadState();
  restoreAtlasSnapshot(JSON.stringify(fixture));
  assert.equal(memory.get(RECOVERY_KEY),'{corrupt'); assert.equal(getStorageStatus().status,'ready');
  assert.equal(state.operationLog.at(-1).type,'state.restore');
  // Migration failure does not publish a partly loaded state.
  const migratedBefore = JSON.stringify(state);
  memory.set(adapter.key,JSON.stringify({...fixture,schema:6})); failWrite=adapter.key;
  assert.equal(loadState(),false); assert.equal(JSON.stringify(state),migratedBefore);
  console.log('Daily reliability: startup/read/future schema, backup, failed writes, atomic restore/migration, durable Sync intent, Today vs due and completion reload passed.');
} finally { console.warn = oldWarn; }
