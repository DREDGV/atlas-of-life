// js/sync/outbox.js — durable local outbox for outbound sync operations.
//
// This is deliberately independent of `state.operationLog`: the operation log
// is bounded history and can be trimmed, while the outbox is the durable queue
// that must survive reload/offline until an operation is acknowledged.
//
// Entry shape: { operation, syncStatus, attempts, lastError }
//   - `operation` is the immutable sync operation envelope (schema, id, deviceId,
//     sequence, timestamp, type, entityType, entityId, baseVersion, payload);
//   - `syncStatus`/`attempts`/`lastError` are LOCAL delivery metadata:
//     'pending' → 'sent' (awaiting ack) → removed on ack;
//     'retryable' (transient failure), 'failed' (permanent).
//
// Durability guarantees:
//   - entries are never silently dropped to respect a size cap (unacked queue is
//     unbounded; acked entries are removed explicitly on ack);
//   - a storage write failure propagates as an error instead of being swallowed
//     as a success.
import { nextDeviceSequence } from './device.js';

const OUTBOX_KEY = 'atlas-sync-outbox-v1';
export const MAX_ATTEMPTS = 5;

function read(){
  try {
    const raw = globalThis.localStorage?.getItem(OUTBOX_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (Array.isArray(data?.entries)) return data;
    }
  } catch (_) {}
  return { entries: [] };
}

// Writes propagate storage failures — an outbox write is never silently lost.
function write(data){
  globalThis.localStorage?.setItem(OUTBOX_KEY, JSON.stringify(data));
}

export function enqueueSyncOperation(operation){
  const data = read();
  // The envelope carries its own monotonic sequence; assign one if the caller
  // supplied a hand-built operation without it.
  if (!operation.sequence) operation.sequence = nextDeviceSequence();
  const entry = {
    operation,
    syncStatus: 'pending',
    attempts: 0,
    lastError: null,
  };
  data.entries.push(entry);
  write(data);
  return entry;
}

export function listOutbox(){
  return read().entries;
}

// Ops that still need to be delivered: pending (never sent) or retryable.
// `sent` (awaiting ack) is deliberately NOT eligible here — recovery of stuck
// `sent` entries is the engine's job (see engine.createSyncEngine recovery).
export function getPendingOps(){
  return listOutbox().filter(entry =>
    entry.syncStatus === 'pending' || entry.syncStatus === 'retryable'
  );
}

export function updateOutboxEntry(id, patch){
  const data = read();
  const entry = data.entries.find(item => item.operation?.id === id);
  if (entry) Object.assign(entry, patch);
  write(data);
  return entry || null;
}

export function markAcked(id){
  const data = read();
  data.entries = data.entries.filter(item => item.operation?.id !== id);
  write(data);
}

export function clearOutbox(){
  write({ entries: [] });
}
