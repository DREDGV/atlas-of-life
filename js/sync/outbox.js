// js/sync/outbox.js — durable local outbox for outbound sync operations.
//
// This is deliberately independent of `state.operationLog`: the operation log
// is bounded history and can be trimmed, while the outbox is the durable queue
// that must survive reload/offline until an operation is acknowledged.
//
// Entry shape: { operation, sequence, syncStatus, attempts, lastError }
//   syncStatus: 'pending' → 'sent' (awaiting ack) → removed on ack;
//               'retryable' (transient failure), 'failed' (permanent).
import { nextDeviceSequence } from './device.js';

const OUTBOX_KEY = 'atlas-sync-outbox-v1';
const MAX_ENTRIES = 1000;
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

function write(data){
  try {
    globalThis.localStorage?.setItem(OUTBOX_KEY, JSON.stringify(data));
  } catch (_) {}
}

export function enqueueSyncOperation(operation){
  const data = read();
  const entry = {
    operation,
    sequence: nextDeviceSequence(),
    syncStatus: 'pending',
    attempts: 0,
    lastError: null,
  };
  data.entries.push(entry);
  if (data.entries.length > MAX_ENTRIES) {
    data.entries.splice(0, data.entries.length - MAX_ENTRIES);
  }
  write(data);
  return entry;
}

export function listOutbox(){
  return read().entries;
}

// Ops that still need to be delivered: pending (never sent) or retryable.
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
