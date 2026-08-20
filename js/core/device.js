const DEVICE_ID_KEY = 'atlas-device-id';
let memoryDeviceId = null;

function generateDeviceId(){
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getDeviceId(){
  if (memoryDeviceId) return memoryDeviceId;
  try {
    const stored = globalThis.localStorage?.getItem(DEVICE_ID_KEY);
    if (stored) {
      memoryDeviceId = stored;
      return memoryDeviceId;
    }
  } catch (_) {}

  memoryDeviceId = generateDeviceId();
  try {
    globalThis.localStorage?.setItem(DEVICE_ID_KEY, memoryDeviceId);
  } catch (_) {}
  return memoryDeviceId;
}

// Test helper: clear the memoized id so a fresh localStorage is re-read.
export function resetDeviceIdForTest(){
  memoryDeviceId = null;
}
