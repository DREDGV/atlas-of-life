const REQUEST_TIMEOUT_MS = 15000;

function normalizeEndpoint(value){
  const url = new URL(String(value || '').trim());
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Sync endpoint must use HTTP or HTTPS');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

async function requestJson(url, options = {}){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    let payload = null;
    try {
      payload = await response.json();
    } catch (_) {}
    if (!response.ok) {
      const error = new Error(payload?.message || `Sync request failed (${response.status})`);
      error.status = response.status;
      error.code = payload?.error || 'sync_http_error';
      throw error;
    }
    return payload || {};
  } finally {
    clearTimeout(timer);
  }
}

export function createInboxHttpTransport(options = {}){
  const endpoint = normalizeEndpoint(options.endpoint);
  const token = String(options.token || '').trim();
  if (!token) throw new Error('Sync token is required');
  const headers = { Authorization: `Bearer ${token}` };

  return {
    push(batch){
      return requestJson(`${endpoint}/v1/inbox/push`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(batch),
      });
    },

    pull(request){
      const query = new URLSearchParams({
        after: String(request.after ?? '0'),
        limit: String(request.limit ?? 100),
      });
      return requestJson(`${endpoint}/v1/inbox/pull?${query}`, { headers });
    },
  };
}

export function claimInboxDevice(options = {}){
  const endpoint = normalizeEndpoint(options.endpoint);
  return requestJson(`${endpoint}/v1/pair/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: String(options.code || '').replace(/\D/g, ''),
      deviceId: String(options.deviceId || ''),
      deviceName: String(options.deviceName || ''),
    }),
  });
}

export function createInboxPairingCode(options = {}){
  const endpoint = normalizeEndpoint(options.endpoint);
  const token = String(options.token || '').trim();
  if (!token) throw new Error('Sync token is required');
  return requestJson(`${endpoint}/v1/pair/codes`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
}

export function revokeInboxDevice(options = {}){
  const endpoint = normalizeEndpoint(options.endpoint);
  const token = String(options.token || '').trim();
  if (!token) throw new Error('Sync token is required');
  return requestJson(`${endpoint}/v1/devices/revoke-self`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}
