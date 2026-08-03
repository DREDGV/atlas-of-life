const PRIMARY_STORAGE_KEY = 'atlas_v2_data';
const previousStoredValue = '{"existing":"durable-state"}';
const memory = new Map([[PRIMARY_STORAGE_KEY, previousStoredValue]]);
const storageFailure = new Error('simulated localStorage write failure');
storageFailure.name = 'QuotaExceededError';
let failPrimaryWrites = false;

globalThis.localStorage = {
  getItem(key) {
    return memory.has(key) ? memory.get(key) : null;
  },
  setItem(key, value) {
    if (failPrimaryWrites && key === PRIMARY_STORAGE_KEY) throw storageFailure;
    memory.set(key, String(value));
  },
  removeItem(key) {
    memory.delete(key);
  },
};

const hookCalls = {
  layout: 0,
  draw: 0,
  sidebar: 0,
  today: 0,
  toasts: [],
  warnings: [],
};
const originalConsoleWarn = console.warn;
console.warn = (...args) => {
  hookCalls.warnings.push(args);
};

globalThis.window = {
  mapApi: {
    layoutMap() {
      hookCalls.layout += 1;
    },
    drawMap() {
      hookCalls.draw += 1;
    },
  },
  renderSidebar() {
    hookCalls.sidebar += 1;
  },
  renderToday() {
    hookCalls.today += 1;
  },
  showToast(message, kind) {
    hookCalls.toasts.push({ message, kind });
  },
};

const { state } = await import('../js/state.js');
const {
  captureInbox,
  convertInboxToTask,
  createProject,
  createTask,
  deleteInbox,
  deleteTask,
  moveTask,
  promoteTaskToProject,
  undoDeleteInbox,
  undoTaskMove,
  updateTask,
} = await import('../js/core/commands.js');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function resetHooks() {
  hookCalls.layout = 0;
  hookCalls.draw = 0;
  hookCalls.sidebar = 0;
  hookCalls.today = 0;
  hookCalls.toasts.length = 0;
  hookCalls.warnings.length = 0;
}

function resetState() {
  state.domains = [
    { id: 'd1', title: 'Domain 1', color: '#111111', createdAt: 1, updatedAt: 10 },
    { id: 'd2', title: 'Domain 2', color: '#222222', createdAt: 2, updatedAt: 20 },
  ];
  state.projects = [
    { id: 'p1', domainId: 'd1', title: 'Project 1', tags: [], priority: 2, createdAt: 3, updatedAt: 30 },
    { id: 'p2', domainId: 'd2', title: 'Project 2', tags: [], priority: 2, createdAt: 4, updatedAt: 40 },
  ];
  state.tasks = [
    {
      id: 't1',
      projectId: 'p1',
      title: 'Original task',
      tags: ['old'],
      status: 'backlog',
      estimateMin: 15,
      priority: 2,
      createdAt: 5,
      updatedAt: 50,
    },
    {
      id: 't2',
      projectId: null,
      domainId: 'd1',
      pos: { x: 10, y: 20 },
      title: 'Independent task',
      tags: [],
      status: 'today',
      estimateMin: null,
      priority: 2,
      createdAt: 6,
      updatedAt: 60,
    },
  ];
  state.inbox = [
    { id: 'i1', text: 'Inbox source', createdAt: 7, updatedAt: 70 },
    { id: 'i2', text: 'Second source', createdAt: 8, updatedAt: 80 },
  ];
  state.operationLog = [
    {
      schema: 1,
      id: 'op-existing',
      deviceId: 'test-device',
      timestamp: 90,
      type: 'test.existing',
      entityType: null,
      entityId: null,
      baseVersion: null,
      payload: null,
      syncStatus: 'pending',
    },
  ];
  state.activeDomain = 'd1';
  state.settings = { layoutMode: 'manual' };
  memory.set(PRIMARY_STORAGE_KEY, previousStoredValue);
  resetHooks();
}

function captureProtectedState() {
  return clone({
    domains: state.domains,
    projects: state.projects,
    tasks: state.tasks,
    inbox: state.inbox,
    operationLog: state.operationLog,
    activeDomain: state.activeDomain,
    settings: state.settings,
  });
}

function assertProtectedStateEquals(expected, label) {
  const actual = captureProtectedState();
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label}: protected state must be restored exactly`
  );
}

function expectPersistenceRollback(label, prepare, execute) {
  resetState();
  const context = prepare ? prepare() : undefined;
  const before = captureProtectedState();
  const rawBefore = memory.get(PRIMARY_STORAGE_KEY);
  let thrown = null;

  failPrimaryWrites = true;
  try {
    execute(context);
  } catch (error) {
    thrown = error;
  } finally {
    failPrimaryWrites = false;
  }

  assert(thrown === storageFailure, `${label}: original storage error must be rethrown`);
  assertProtectedStateEquals(before, label);
  assert(
    memory.get(PRIMARY_STORAGE_KEY) === rawBefore,
    `${label}: previous durable JSON must remain unchanged`
  );
  assert(hookCalls.layout === 0, `${label}: layout success hook must not run`);
  assert(hookCalls.draw === 0, `${label}: draw success hook must not run`);
  assert(hookCalls.sidebar === 0, `${label}: sidebar success hook must not run`);
  assert(hookCalls.today === 0, `${label}: Today success hook must not run`);
  assert(hookCalls.warnings.length === 1, `${label}: one persistence warning is expected`);
  assert(
    hookCalls.warnings[0][0] === 'saveState error' &&
      !JSON.stringify(hookCalls.warnings[0]).includes(previousStoredValue),
    `${label}: warning must not contain stored user data`
  );
  assert(hookCalls.toasts.length === 1, `${label}: one persistence error toast is expected`);
  assert(
    hookCalls.toasts[0].kind === 'warn' &&
      hookCalls.toasts[0].message.includes('Ошибка сохранения данных'),
    `${label}: persistence toast must be understandable`
  );
}

function captureIdentityState(taskId = 't1') {
  const taskRef = state.tasks.find(task => task.id === taskId);
  return {
    domainsRef: state.domains,
    domainRefs: [...state.domains],
    projectsRef: state.projects,
    projectRefs: [...state.projects],
    tasksRef: state.tasks,
    taskRefs: [...state.tasks],
    taskRef,
    taskSnapshot: clone(taskRef),
    inboxRef: state.inbox,
    inboxRefs: [...state.inbox],
    operationLogRef: state.operationLog,
    operationRefs: [...state.operationLog],
    settingsRef: state.settings,
    settingsSnapshot: clone(state.settings),
  };
}

function assertBaseIdentityRestored(identity, label) {
  assert(state.domains === identity.domainsRef, `${label}: domains array identity must survive rollback`);
  assert(state.projects === identity.projectsRef, `${label}: projects array identity must survive rollback`);
  assert(state.tasks === identity.tasksRef, `${label}: tasks array identity must survive rollback`);
  assert(state.inbox === identity.inboxRef, `${label}: Inbox array identity must survive rollback`);
  assert(
    state.operationLog === identity.operationLogRef,
    `${label}: operationLog array identity must survive rollback`
  );
  assert(state.settings === identity.settingsRef, `${label}: settings identity must survive rollback`);
  assert(
    state.domains.every((item, index) => item === identity.domainRefs[index]),
    `${label}: domain object identities must survive rollback`
  );
  assert(
    state.projects.every((item, index) => item === identity.projectRefs[index]),
    `${label}: project object identities must survive rollback`
  );
  assert(
    state.tasks.every((item, index) => item === identity.taskRefs[index]),
    `${label}: task object identities and order must survive rollback`
  );
  assert(
    state.inbox.every((item, index) => item === identity.inboxRefs[index]),
    `${label}: Inbox object identities must survive rollback`
  );
  assert(
    state.operationLog.every((item, index) => item === identity.operationRefs[index]),
    `${label}: operation object identities must survive rollback`
  );
  assert(
    JSON.stringify(state.settings) === JSON.stringify(identity.settingsSnapshot),
    `${label}: settings values must be restored`
  );
}

function expectStorageIdentityRollback(label, taskId, execute, verify) {
  resetState();
  const identity = captureIdentityState(taskId);
  let thrown = null;

  failPrimaryWrites = true;
  try {
    execute(identity);
  } catch (error) {
    thrown = error;
  } finally {
    failPrimaryWrites = false;
  }

  assert(thrown === storageFailure, `${label}: original storage error must be rethrown`);
  assertBaseIdentityRestored(identity, label);
  verify(identity);
}

expectPersistenceRollback(
  'captureInbox',
  null,
  () => captureInbox('Captured line', {
    now: 100,
    deviceId: 'test-device',
    idFactory: () => 'i-created',
  })
);

expectPersistenceRollback(
  'deleteInbox',
  null,
  () => deleteInbox('i1', { now: 101, deviceId: 'test-device' })
);

expectPersistenceRollback(
  'undoDeleteInbox',
  () => {
    const [item] = state.inbox.splice(0, 1);
    return { item, index: 0 };
  },
  removal => undoDeleteInbox(removal, { now: 102, deviceId: 'test-device' })
);

expectPersistenceRollback(
  'convertInboxToTask',
  null,
  () => convertInboxToTask('i1', {
    now: 103,
    deviceId: 'test-device',
    taskId: 'task-from-inbox',
  })
);

expectPersistenceRollback(
  'createTask',
  null,
  () => createTask({
    id: 't-created',
    projectId: 'p1',
    title: 'Created task',
    status: 'today',
  }, { now: 104, deviceId: 'test-device' })
);

expectPersistenceRollback(
  'updateTask',
  null,
  () => updateTask('t1', {
    title: 'Changed title',
    tags: ['new'],
    status: 'doing',
  }, { now: 105, deviceId: 'test-device' })
);

expectPersistenceRollback(
  'moveTask',
  null,
  () => moveTask('t2', {
    projectId: 'p2',
  }, { now: 106, deviceId: 'test-device' })
);

expectPersistenceRollback(
  'undoTaskMove',
  () => {
    const task = state.tasks.find(item => item.id === 't1');
    task.projectId = 'p2';
    task.updatedAt = 107;
    return {
      before: {
        ...clone(task),
        projectId: 'p1',
        updatedAt: 50,
      },
      operation: {
        id: 'op-move-source',
        entityId: 't1',
      },
    };
  },
  moveResult => undoTaskMove(moveResult, {
    now: 108,
    deviceId: 'test-device',
  })
);

expectPersistenceRollback(
  'deleteTask',
  null,
  () => deleteTask('t1', { now: 109, deviceId: 'test-device' })
);

expectPersistenceRollback(
  'createProject',
  null,
  () => createProject({
    id: 'p-created',
    domainId: 'd1',
    title: 'Created project',
  }, { now: 110, deviceId: 'test-device' })
);

expectPersistenceRollback(
  'promoteTaskToProject',
  null,
  () => promoteTaskToProject('t2', {
    now: 111,
    deviceId: 'test-device',
    projectId: 'p-promoted',
  })
);

expectStorageIdentityRollback(
  'updateTask identity',
  't1',
  () => updateTask('t1', {
    title: 'Changed identity title',
    tags: ['identity'],
    status: 'doing',
  }, { now: 301, deviceId: 'test-device' }),
  identity => {
    const task = state.tasks.find(item => item.id === 't1');
    assert(task === identity.taskRef, 'updateTask identity: original task reference must be restored');
    assert(identity.taskRef.title === identity.taskSnapshot.title, 'updateTask identity: title must restore in-place');
    assert(
      JSON.stringify(identity.taskRef.tags) === JSON.stringify(identity.taskSnapshot.tags),
      'updateTask identity: tags must restore in-place'
    );
    assert(identity.taskRef.status === identity.taskSnapshot.status, 'updateTask identity: status must restore in-place');
    assert(
      identity.taskRef.updatedAt === identity.taskSnapshot.updatedAt,
      'updateTask identity: updatedAt must restore in-place'
    );
  }
);

expectStorageIdentityRollback(
  'deleteTask identity',
  't1',
  identity => {
    identity.originalIndex = state.tasks.indexOf(identity.taskRef);
    return deleteTask('t1', { now: 302, deviceId: 'test-device' });
  },
  identity => {
    assert(
      state.tasks[identity.originalIndex] === identity.taskRef,
      'deleteTask identity: original task must return to the same index and reference'
    );
  }
);

expectStorageIdentityRollback(
  'createTask identity',
  't1',
  () => createTask({
    id: 't-identity-created',
    projectId: 'p1',
    title: 'Must be removed',
  }, { now: 303, deviceId: 'test-device' }),
  identity => {
    assert(
      !state.tasks.some(task => task.id === 't-identity-created'),
      'createTask identity: failed new task must be removed'
    );
    assert(
      state.tasks[0] === identity.taskRefs[0] && state.tasks[1] === identity.taskRefs[1],
      'createTask identity: existing task references must be preserved'
    );
  }
);

expectStorageIdentityRollback(
  'promoteTaskToProject identity',
  't2',
  () => promoteTaskToProject('t2', {
    now: 304,
    deviceId: 'test-device',
    projectId: 'p-identity-promoted',
  }),
  identity => {
    const task = state.tasks.find(item => item.id === 't2');
    assert(task === identity.taskRef, 'promote identity: original task reference must be restored');
    assert(
      JSON.stringify(identity.taskRef) === JSON.stringify(identity.taskSnapshot),
      'promote identity: original task fields must restore in-place'
    );
    assert(
      !state.projects.some(project => project.id === 'p-identity-promoted'),
      'promote identity: failed project must be removed'
    );
    assert(
      state.projects === identity.projectsRef,
      'promote identity: projects array identity must be preserved'
    );
  }
);

resetState();
const validationIdentity = captureIdentityState('t1');
const validationBefore = captureProtectedState();
let validationError = null;
try {
  updateTask('t1', { title: '' }, { now: 305, deviceId: 'test-device' });
} catch (error) {
  validationError = error;
}
assert(validationError?.message === 'Task title cannot be empty', 'Validation error must be rethrown');
assertBaseIdentityRestored(validationIdentity, 'validation error identity');
assertProtectedStateEquals(validationBefore, 'validation error values');
assert(
  state.tasks[0] === validationIdentity.taskRef,
  'Validation error must preserve the original task reference'
);

resetState();
const created = createTask({
  id: 't-success',
  projectId: 'p1',
  title: 'Durable task',
  status: 'today',
}, { now: 200, deviceId: 'test-device' });

assert(created.id === 't-success', 'Successful createTask must preserve its public return type');
assert(state.tasks.some(task => task.id === 't-success'), 'Successful command must keep its state change');
assert(state.operationLog.at(-1)?.type === 'task.create', 'Successful command must keep its operation');
assert(
  memory.get(PRIMARY_STORAGE_KEY) !== previousStoredValue,
  'Successful command must replace the previous durable JSON'
);
assert(hookCalls.layout === 1, 'Successful save must run layout hook once');
assert(hookCalls.draw === 1, 'Successful save must run draw hook once');
assert(hookCalls.sidebar === 1, 'Successful save must run sidebar hook once');
assert(hookCalls.today === 1, 'Successful save must run Today hook once');
assert(hookCalls.toasts.length === 0, 'Successful save must not show an error toast');
assert(hookCalls.warnings.length === 0, 'Successful save must not emit a persistence warning');

console.warn = originalConsoleWarn;
console.log('Command persistence rollback test passed.');
