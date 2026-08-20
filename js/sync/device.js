// js/sync/device.js — stable sync device identity + a local monotonic sequence.
//
// Reuses the existing stable deviceId (js/core/device.js), which is generated
// once and persisted locally. Adds a per-device sequence counter used to order
// outbound sync operations. No account/auth — just a local device identity.
import { getDeviceId, resetDeviceIdForTest } from '../core/device.js';

const SEQ_KEY = 'atlas-sync-device-seq';
let memorySeq = null;

export function getSyncDeviceId(){
  return getDeviceId();
}

export function getDeviceSequence(){
  if (memorySeq != null) return memorySeq;
  try {
    const stored = Number(globalThis.localStorage?.getItem(SEQ_KEY));
    memorySeq = Number.isFinite(stored) ? stored : 0;
  } catch (_) {
    memorySeq = 0;
  }
  return memorySeq;
}

export function nextDeviceSequence(){
  const next = getDeviceSequence() + 1;
  memorySeq = next;
  try {
    globalThis.localStorage?.setItem(SEQ_KEY, String(next));
  } catch (_) {}
  return next;
}

// Test helper: reset the memoized sequence (does not touch localStorage).
export function resetDeviceSequence(){
  memorySeq = null;
}

// Test helper: reset both device id and sequence memos.
export function resetSyncDeviceForTest(){
  resetDeviceIdForTest();
  resetDeviceSequence();
}
