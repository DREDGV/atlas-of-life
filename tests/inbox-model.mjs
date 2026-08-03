import { state } from '../js/state.js';
import {
  addInboxLines,
  convertInboxItemToTask,
  removeInboxItem,
  restoreInboxItem,
} from '../js/features/inbox/model.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

state.domains = [{ id: 'd-test', title: 'Test domain' }];
state.activeDomain = null;
state.tasks = [];
state.inbox = [];

const created = addInboxLines('Первая мысль\n\n Вторая мысль ', {
  now: 1000,
  idFactory: index => `inbox-${index}`,
});
assert(created.length === 2, 'Multiline capture should create two items');
assert(state.inbox[1].text === 'Вторая мысль', 'Captured text should be trimmed');

const removal = removeInboxItem('inbox-0');
assert(removal?.index === 0, 'Removal should preserve the original position');
assert(state.inbox.length === 1, 'Removal should update Inbox state');
assert(restoreInboxItem(removal), 'Removed item should be restorable');
assert(state.inbox[0].id === 'inbox-0', 'Undo should restore the original order');

const conversion = convertInboxItemToTask('inbox-1', {
  now: 2000,
  taskId: 'task-1',
});
assert(conversion?.task.title === 'Вторая мысль', 'Conversion should preserve the Inbox text');
assert(conversion.task.domainId === 'd-test', 'Conversion should use the first available domain');
assert(conversion.task.status === 'backlog', 'Converted tasks should start in backlog');
assert(Array.isArray(conversion.task.tags), 'Converted tasks should have normalized tags');
assert(state.inbox.length === 1, 'Converted Inbox item should be removed');
assert(state.tasks.length === 1, 'Conversion should create exactly one task');

console.log('Inbox model test passed.');
