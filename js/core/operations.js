import { state } from '../state.js';
import { getDeviceId } from './device.js';
import { nextDeviceSequence } from '../sync/device.js';

export const OPERATION_LOG_LIMIT = 1000;

function generateOperationId(){
  if (globalThis.crypto?.randomUUID) return `op-${globalThis.crypto.randomUUID()}`;
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function snapshot(value){
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return null;
  }
}

function ensureOperationLog(){
  if (!Array.isArray(state.operationLog)) state.operationLog = [];
  return state.operationLog;
}

// The immutable sync operation envelope. Delivery state (syncStatus, attempts,
// lastError) is NOT part of the operation — it lives on the durable outbox
// entry (js/sync/outbox.js). `sequence` is the per-device monotonic counter.
export function appendOperation(input, options = {}){
  if (!input?.type) throw new Error('Operation type is required');
  const timestamp = Number(options.timestamp ?? input.timestamp) || Date.now();
  const operation = {
    schema: 1,
    id: options.operationId || input.id || generateOperationId(),
    deviceId: options.deviceId || input.deviceId || getDeviceId(),
    sequence: nextDeviceSequence(),
    timestamp,
    type: input.type,
    entityType: input.entityType || null,
    entityId: input.entityId || null,
    baseVersion: input.baseVersion ?? null,
    payload: snapshot(input.payload),
  };
  const log = ensureOperationLog();
  log.push(operation);
  if (log.length > OPERATION_LOG_LIMIT) {
    log.splice(0, log.length - OPERATION_LOG_LIMIT);
  }
  return operation;
}

export function getOperationLog(){
  return [...ensureOperationLog()];
}
