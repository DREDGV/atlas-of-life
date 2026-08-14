export const INBOX_SYNC_CONFIG_KEY = 'atlas_inbox_sync_config_v1';
export const DEFAULT_INBOX_SYNC_ENDPOINT = 'https://atlas.31.28.27.96.sslip.io';

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
  const token = String(value?.token || '').trim();
  const legacySharedCredential = /^[a-f0-9]{64}$/i.test(token);
  return {
    enabled: value?.enabled === true && !legacySharedCredential,
    endpoint: normalizeEndpoint(value?.endpoint) || DEFAULT_INBOX_SYNC_ENDPOINT,
    token: legacySharedCredential ? '' : token,
  };
}

export function loadInboxSyncConfig(storage = globalThis.localStorage){
  try {
    const raw = storage?.getItem(INBOX_SYNC_CONFIG_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const normalized = normalizeInboxSyncConfig(parsed);
    if (raw && parsed?.token && !normalized.token) {
      storage?.setItem(INBOX_SYNC_CONFIG_KEY, JSON.stringify(normalized));
    }
    return normalized;
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
