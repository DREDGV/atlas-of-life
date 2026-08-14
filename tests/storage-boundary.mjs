const memory = new Map();
globalThis.localStorage = {
  getItem(key) {
    return memory.has(key) ? memory.get(key) : null;
  },
  setItem(key, value) {
    memory.set(key, String(value));
  },
  removeItem(key) {
    memory.delete(key);
  },
};

const { state } = await import('../js/state.js');
const { loadState, saveState } = await import('../js/storage.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

state.domains = [{ id: 'd1', title: 'Domain', _type: 'domain' }];
state.projects = [{ id: 'p1', domainId: 'd1', title: 'Project', tags: [], _type: 'project' }];
state.tasks = [{
  id: 't1',
  projectId: 'p1',
  title: 'Task',
  tags: [],
  status: 'today',
  createdAt: 1,
  updatedAt: 1,
  _type: 'task',
}];
state.inbox = [];
state.operationLog = [];
state.sync = { endpoint: 'https://sync.example.test', cursor: '42', lastSyncAt: 123456 };

saveState();
const stored = JSON.parse(memory.get('atlas_v2_data'));
assert(!('_type' in stored.domains[0]), 'Domain UI type must not cross the storage boundary');
assert(!('_type' in stored.projects[0]), 'Project UI type must not cross the storage boundary');
assert(!('_type' in stored.tasks[0]), 'Task UI type must not cross the storage boundary');
assert(stored.sync.cursor === '42', 'Server cursor must be stored with Atlas state');
assert(stored.sync.endpoint === 'https://sync.example.test', 'Server cursor must be tied to its endpoint');
assert(stored.sync.lastSyncAt === 123456, 'Last successful sync time must be stored');

stored.domains[0]._type = 'domain';
stored.projects[0]._type = 'project';
stored.tasks[0]._type = 'task';
memory.set('atlas_v2_data', JSON.stringify(stored));
assert(loadState(), 'Stored state must load');
assert(!('_type' in state.domains[0]), 'Domain UI type must be removed while loading');
assert(!('_type' in state.projects[0]), 'Project UI type must be removed while loading');
assert(!('_type' in state.tasks[0]), 'Task UI type must be removed while loading');
assert(state.sync.cursor === '42', 'Server cursor must survive reload');
assert(state.sync.endpoint === 'https://sync.example.test', 'Server endpoint must survive reload');

console.log('Storage boundary test passed.');
