export const INBOX_SYNC_CONFIG_KEY = 'atlas_inbox_sync_config_v1';

function normalizeEndpoint(value){
  const input = String(value || '').trim();
  if (!input) return '';
  try {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.toString().replace(/\/$/, '');
  } catch (_) {
    return '';
  }
}

export function normalizeInboxSyncConfig(value){
  return {
    enabled: value?.enabled === true,
    endpoint: normalizeEndpoint(value?.endpoint),
    token: String(value?.token || '').trim(),
  };
}

export function loadInboxSyncConfig(storage = globalThis.localStorage){
  try {
    const raw = storage?.getItem(INBOX_SYNC_CONFIG_KEY);
    return normalizeInboxSyncConfig(raw ? JSON.parse(raw) : null);
  } catch (_) {
    return normalizeInboxSyncConfig(null);
  }
}

export function saveInboxSyncConfig(config, storage = globalThis.localStorage){
  const normalized = normalizeInboxSyncConfig(config);
  if (normalized.enabled && (!normalized.endpoint || !normalized.token)) {
    throw new Error('Sync endpoint and token are required');
  }
  storage.setItem(INBOX_SYNC_CONFIG_KEY, JSON.stringify(normalized));
  return normalized;
}

export function clearInboxSyncConfig(storage = globalThis.localStorage){
  storage?.removeItem(INBOX_SYNC_CONFIG_KEY);
}
