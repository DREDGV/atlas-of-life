import { state } from '../js/state.js';
import {
  captureInbox,
  convertInboxToTask,
  createProject,
  createTask,
  deleteTask,
  deleteInbox,
  moveTask,
  promoteTaskToProject,
  undoDeleteInbox,
  undoTaskMove,
  updateTask,
} from '../js/core/commands.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

state.domains = [{ id: 'd-test', title: 'Test domain' }];
state.projects = [];
state.tasks = [];
state.inbox = [];
state.operationLog = [];
state.activeDomain = null;

const commandOptions = {
  persist: false,
  now: 1000,
  deviceId: 'device-test',
  idFactory: index => `inbox-${index}`,
};
const captured = captureInbox('Первая\nВторая', commandOptions);
assert(captured.length === 2, 'Capture command must create two Inbox items');
assert(state.operationLog.length === 2, 'Each captured item must create an operation');
assert(state.operationLog.every(operation => operation.type === 'inbox.capture'), 'Capture operations must be typed');

const removal = deleteInbox('inbox-0', { ...commandOptions, now: 1100 });
assert(removal?.item.text === 'Первая', 'Delete command must return an undo token');
assert(state.operationLog.at(-1).type === 'inbox.delete', 'Delete command must be journaled');
assert(undoDeleteInbox(removal, { ...commandOptions, now: 1200 }), 'Undo command must restore the item');
assert(state.operationLog.at(-1).type === 'inbox.restore', 'Undo command must be journaled');

const converted = convertInboxToTask('inbox-1', {
  ...commandOptions,
  now: 1300,
  taskId: 'task-from-inbox',
});
assert(converted?.task.id === 'task-from-inbox', 'Convert command must create the requested task');
assert(state.operationLog.at(-1).type === 'inbox.convert_to_task', 'Conversion must be journaled atomically');

const quickTask = createTask({
  id: 'task-quick',
  title: 'Быстрая задача',
  tags: ['дом'],
  status: 'today',
}, { ...commandOptions, now: 1400 });
assert(quickTask.domainId === 'd-test', 'Task command must assign the available domain');
assert(state.operationLog.at(-1).type === 'task.create', 'Task creation must be journaled');
assert(state.operationLog.length === 6, 'The complete command scenario must produce six operations');

const updated = updateTask('task-quick', {
  title: 'Обновлённая задача',
  tags: ['дом', 'важно', 'дом'],
  status: 'doing',
}, { ...commandOptions, now: 1500 });
assert(updated?.task.title === 'Обновлённая задача', 'Update command must change the task title');
assert(updated?.task.tags.join(',') === 'дом,важно', 'Update command must normalize tags');
assert(updated?.task.status === 'doing', 'Update command must change task status');
assert(updated?.before.status === 'today', 'Update command must retain the previous snapshot');
assert(state.operationLog.at(-1).type === 'task.update', 'Task update must be journaled');

const operationCountBeforeNoop = state.operationLog.length;
const noop = updateTask('task-quick', { status: 'doing' }, { ...commandOptions, now: 1550 });
assert(noop?.operation === null, 'No-op update must not create an operation');
assert(state.operationLog.length === operationCountBeforeNoop, 'No-op update must not grow the journal');

const project = createProject({
  id: 'project-command',
  title: 'Командный проект',
}, { ...commandOptions, now: 1600 });
assert(project.domainId === 'd-test', 'Project command must assign the available domain');
assert(state.operationLog.at(-1).type === 'project.create', 'Project creation must be journaled');

const attached = moveTask('task-from-inbox', {
  projectId: 'project-command',
}, { ...commandOptions, now: 1650, reason: 'test-attach' });
assert(attached?.task.projectId === 'project-command', 'Move command must attach a task to a project');
assert(!('domainId' in attached.task), 'A project task must derive its domain from the project');
assert(state.operationLog.at(-1).type === 'task.move', 'Task attachment must be journaled');

const detached = moveTask('task-from-inbox', {
  projectId: null,
  domainId: 'd-test',
  pos: { x: 12, y: 34 },
}, { ...commandOptions, now: 1670, reason: 'test-detach' });
assert(detached?.task.projectId === null, 'Move command must detach a task from its project');
assert(detached?.task.domainId === 'd-test', 'Detached task must retain its destination domain');
assert(detached?.task.pos.x === 12, 'Detached task must retain a valid manual position');

const undoneMove = undoTaskMove(detached, { ...commandOptions, now: 1690 });
assert(undoneMove?.task.projectId === 'project-command', 'Move undo must restore the original project');
assert(!('pos' in undoneMove.task), 'Move undo must restore the original position state');
assert(state.operationLog.at(-1).type === 'task.move.undo', 'Move undo must be journaled');

const promoted = promoteTaskToProject('task-quick', {
  ...commandOptions,
  now: 1710,
  projectId: 'project-from-task',
});
assert(promoted?.project.id === 'project-from-task', 'Promotion must create a project');
assert(promoted?.task.projectId === 'project-from-task', 'Promotion must attach the task to its project');
assert(state.operationLog.at(-1).type === 'task.promote_to_project', 'Promotion must be journaled atomically');

const deletion = deleteTask('task-from-inbox', { ...commandOptions, now: 1800 });
assert(deletion?.task.id === 'task-from-inbox', 'Delete command must return the removed task');
assert(!state.tasks.some(task => task.id === 'task-from-inbox'), 'Delete command must remove the task');
assert(state.operationLog.at(-1).type === 'task.delete', 'Task deletion must be journaled');
assert(state.operationLog.length === 13, 'The extended command scenario must produce thirteen operations');

console.log('Command layer test passed.');
