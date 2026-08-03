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

saveState();
const stored = JSON.parse(memory.get('atlas_v2_data'));
assert(!('_type' in stored.domains[0]), 'Domain UI type must not cross the storage boundary');
assert(!('_type' in stored.projects[0]), 'Project UI type must not cross the storage boundary');
assert(!('_type' in stored.tasks[0]), 'Task UI type must not cross the storage boundary');

stored.domains[0]._type = 'domain';
stored.projects[0]._type = 'project';
stored.tasks[0]._type = 'task';
memory.set('atlas_v2_data', JSON.stringify(stored));
assert(loadState(), 'Stored state must load');
assert(!('_type' in state.domains[0]), 'Domain UI type must be removed while loading');
assert(!('_type' in state.projects[0]), 'Project UI type must be removed while loading');
assert(!('_type' in state.tasks[0]), 'Task UI type must be removed while loading');

console.log('Storage boundary test passed.');
