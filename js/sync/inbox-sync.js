import {
  acknowledgeInboxOperations,
  buildInboxPushBatch,
  mergeRemoteInboxRecords,
} from './inbox-protocol.js';

function assertFunction(value, name){
  if (typeof value !== 'function') throw new Error(`${name} must be a function`);
}

function captureLocalCheckpoint(inbox, operationLog){
  return {
    inboxItems: [...inbox],
    operationStatuses: operationLog.map(operation => ({
      operation,
      hadStatus: Object.hasOwn(operation || {}, 'syncStatus'),
      syncStatus: operation?.syncStatus,
    })),
  };
}

function restoreLocalCheckpoint(inbox, checkpoint){
  inbox.splice(0, inbox.length, ...checkpoint.inboxItems);
  checkpoint.operationStatuses.forEach(entry => {
    if (!entry.operation || typeof entry.operation !== 'object') return;
    if (entry.hadStatus) entry.operation.syncStatus = entry.syncStatus;
    else delete entry.operation.syncStatus;
  });
}

export async function runInboxSyncCycle(options = {}){
  const inbox = options.inbox;
  const operationLog = options.operationLog;
  const transport = options.transport;
  const persist = options.persist;

  if (!Array.isArray(inbox)) throw new Error('Inbox must be an array');
  if (!Array.isArray(operationLog)) throw new Error('Operation log must be an array');
  if (!transport || typeof transport !== 'object') throw new Error('Sync transport is required');
  assertFunction(transport.push, 'transport.push');
  assertFunction(transport.pull, 'transport.pull');
  assertFunction(persist, 'persist');

  const batch = buildInboxPushBatch(operationLog, {
    deviceId: options.deviceId,
    limit: options.pushLimit,
  });

  let acknowledgedOperationIds = [];
  if (batch.operations.length > 0) {
    const pushResult = await transport.push(batch);
    acknowledgedOperationIds = Array.isArray(pushResult?.acknowledgedOperationIds)
      ? pushResult.acknowledgedOperationIds
      : [];
  }

  const pullResult = await transport.pull({
    protocol: batch.protocol,
    deviceId: batch.deviceId,
    after: String(options.cursor ?? '0'),
    limit: options.pullLimit,
  });
  const records = Array.isArray(pullResult?.records) ? pullResult.records : [];

  const checkpoint = captureLocalCheckpoint(inbox, operationLog);
  try {
    const acknowledged = acknowledgeInboxOperations(
      operationLog,
      acknowledgedOperationIds
    );
    const merged = mergeRemoteInboxRecords(inbox, records, {
      cursor: options.cursor,
    });
    const changed = acknowledged > 0 || merged.added.length > 0;

    if (changed) {
      await persist({ nextCursor: merged.nextCursor });
    }

    return {
      pushed: batch.operations.length,
      acknowledged,
      received: merged.added.length,
      duplicates: merged.duplicateIds,
      conflicts: merged.conflicts,
      nextCursor: merged.nextCursor,
      changed,
    };
  } catch (error) {
    restoreLocalCheckpoint(inbox, checkpoint);
    throw error;
  }
}
