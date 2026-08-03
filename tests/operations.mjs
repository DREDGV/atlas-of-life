import { state } from '../js/state.js';
import {
  appendOperation,
  getOperationLog,
  OPERATION_LOG_LIMIT,
} from '../js/core/operations.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

state.operationLog = [];
const payload = { title: 'Исходное значение' };
appendOperation({
  type: 'test.create',
  entityType: 'test',
  entityId: 'entity-0',
  payload,
}, {
  operationId: 'op-0',
  deviceId: 'device-test',
  timestamp: 1000,
});
payload.title = 'Изменено после записи';
assert(state.operationLog[0].payload.title === 'Исходное значение', 'Operation payload must be a snapshot');

for (let index = 1; index <= OPERATION_LOG_LIMIT; index += 1) {
  appendOperation({
    type: 'test.update',
    entityType: 'test',
    entityId: `entity-${index}`,
    payload: { index },
  }, {
    operationId: `op-${index}`,
    deviceId: 'device-test',
    timestamp: 1000 + index,
  });
}

const log = getOperationLog();
assert(log.length === OPERATION_LOG_LIMIT, 'Operation log must respect its size limit');
assert(log[0].id === 'op-1', 'Operation log must discard the oldest entries first');
assert(log.at(-1).id === `op-${OPERATION_LOG_LIMIT}`, 'Newest operation must be preserved');
assert(log.at(-1).syncStatus === 'pending', 'New local operations must be pending sync');

console.log('Operation log test passed.');
