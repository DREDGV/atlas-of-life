import {
  DEFAULT_INBOX_SYNC_ENDPOINT,
  INBOX_SYNC_CONFIG_KEY,
  clearInboxSyncConfig,
  loadInboxSyncConfig,
  normalizeInboxSyncConfig,
  saveInboxSyncConfig,
} from '../js/sync/config.js';

function assert(condition, message){
  if (!condition) throw new Error(message);
}

function memoryStorage(initial = {}){
  const values = new Map(Object.entries(initial));
  return {
    getItem(key){ return values.has(key) ? values.get(key) : null; },
    setItem(key, value){ values.set(key, String(value)); },
    removeItem(key){ values.delete(key); },
  };
}

assert(DEFAULT_INBOX_SYNC_ENDPOINT.startsWith('https://'), 'Default endpoint must use HTTPS');

const empty = normalizeInboxSyncConfig(null);
assert(empty.endpoint === DEFAULT_INBOX_SYNC_ENDPOINT, 'Unpaired client must use built-in endpoint');
assert(empty.enabled === false && empty.token === '', 'Unpaired client must remain disabled');

const storage = memoryStorage();
const saved = saveInboxSyncConfig({ enabled: false }, storage);
assert(saved.endpoint === DEFAULT_INBOX_SYNC_ENDPOINT, 'Disabled config must retain built-in endpoint');
assert(loadInboxSyncConfig(storage).token === '', 'Disabled config must not require a token');

let invalidFailure = null;
try {
  saveInboxSyncConfig({ enabled: true, token: '' }, storage);
} catch (error) {
  invalidFailure = error;
}
assert(invalidFailure, 'Enabled config must require a device credential');

const paired = saveInboxSyncConfig({ enabled: true, token: 'device-token' }, storage);
assert(paired.endpoint === DEFAULT_INBOX_SYNC_ENDPOINT, 'Paired config must use built-in endpoint');
assert(loadInboxSyncConfig(storage).token === 'device-token', 'Device credential must persist locally');

clearInboxSyncConfig(storage);
assert(storage.getItem(INBOX_SYNC_CONFIG_KEY) === null, 'Disconnect must remove local config');

const legacyStorage = memoryStorage({
  [INBOX_SYNC_CONFIG_KEY]: JSON.stringify({
    enabled: true,
    endpoint: 'https://legacy.example.test/',
    token: 'legacy-token',
  }),
});
const legacy = loadInboxSyncConfig(legacyStorage);
assert(legacy.endpoint === 'https://legacy.example.test', 'Existing test deployments must keep custom endpoint');
assert(legacy.token === 'legacy-token', 'Existing credential migration must be non-destructive');

const sharedStorage = memoryStorage({
  [INBOX_SYNC_CONFIG_KEY]: JSON.stringify({
    enabled: true,
    endpoint: DEFAULT_INBOX_SYNC_ENDPOINT,
    token: 'a'.repeat(64),
  }),
});
const removedSharedCredential = loadInboxSyncConfig(sharedStorage);
assert(removedSharedCredential.enabled === false, 'Legacy shared server credential must be disabled');
assert(removedSharedCredential.token === '', 'Legacy shared server credential must be removed from client config');
assert(!sharedStorage.getItem(INBOX_SYNC_CONFIG_KEY)?.includes('a'.repeat(64)), 'Shared credential must not remain in storage');

console.log('Inbox sync config test passed.');
