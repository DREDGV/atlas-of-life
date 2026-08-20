// js/sync/http-transport.js — remote HTTP transport for Sync v1 (Stage C1).
//
// Implements the SAME transport contract as the C0 dev relay
// (js/sync/relay.js):
//
//   pushOperations(ops)          → { ackedIds }
//   pullOperations(cursor, opts) → { operations: [{serverSequence, operation}], newCursor }
//   acknowledge(opIds)           → void
//
// Wire protocol (see server/sync-server.js):
//   POST {endpoint}/v1/ops/push   body: { protocol, deviceId, operations }
//   GET  {endpoint}/v1/ops/pull?after=<cursor>&excludeDevice=<deviceId>&limit=<n>
//   POST {endpoint}/v1/devices/revoke-self
// All requests carry `Authorization: Bearer <deviceToken>`.
//
// Error contract for the engine/runtime:
//   - transport failures throw; the engine marks entries retryable;
//   - a 401 throws an error with `code === 'unauthorized'` so the runtime can
//     surface "device revoked / re-pair needed" instead of retrying forever.
import { SYNC_PROTOCOL } from './config.js';
import { getSyncDeviceId } from './device.js';

const PULL_LIMIT = 200;

function createError(message, code, status){
  const error = new Error(message);
  error.code = code || 'http';
  error.status = status || 0;
  return error;
}

export function createHttpTransport({ endpoint, getToken, fetchImpl }){
  const fetchFn = fetchImpl || globalThis.fetch?.bind(globalThis);
  const baseUrl = String(endpoint || '').replace(/\/+$/, '');

  if (!fetchFn) throw new Error('fetch is not available in this environment');

  async function request(path, options = {}){
    const token = typeof getToken === 'function' ? getToken() : getToken;
    const headers = { ...(options.headers || {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    let response;
    try {
      response = await fetchFn(`${baseUrl}${path}`, {
        method: options.method || 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (error) {
      // Network-level failure (offline, DNS, TLS): transparent to the engine.
      const wrapped = createError(`Sync network error: ${error?.message || error}`, 'network');
      wrapped.cause = error;
      throw wrapped;
    }

    if (response.status === 401) {
      throw createError('Sync device credential rejected (revoked or invalid)', 'unauthorized', 401);
    }
    if (response.status === 403) {
      throw createError('Sync server refused the request', 'forbidden', 403);
    }
    if (!response.ok) {
      let detail = '';
      try {
        const body = await response.json();
        detail = body?.message || body?.error || '';
      } catch (_) {}
      throw createError(`Sync server error ${response.status}${detail ? `: ${detail}` : ''}`, 'http', response.status);
    }

    try {
      return await response.json();
    } catch (_) {
      throw createError('Sync server returned a non-JSON response', 'http', response.status);
    }
  }

  return {
    async pushOperations(ops){
      const result = await request('/v1/ops/push', {
        method: 'POST',
        body: {
          protocol: SYNC_PROTOCOL,
          deviceId: getSyncDeviceId(),
          operations: ops,
        },
      });
      return { ackedIds: Array.isArray(result?.ackedIds) ? result.ackedIds : [] };
    },

    async pullOperations(cursor = 0, opts = {}){
      const params = new URLSearchParams({
        after: String(cursor || 0),
        limit: String(PULL_LIMIT),
      });
      const exclude = opts?.excludeDeviceId;
      if (exclude) params.set('excludeDevice', exclude);
      const result = await request(`/v1/ops/pull?${params.toString()}`);
      return {
        operations: Array.isArray(result?.operations) ? result.operations : [],
        newCursor: Number(result?.newCursor) || Number(cursor) || 0,
      };
    },

    // Parity with the transport contract; the engine acknowledges on push.
    async acknowledge(){
      return;
    },

    // Pairing / maintenance helpers used by the runtime (not the engine).
    async revokeSelf(){
      await request('/v1/devices/revoke-self', { method: 'POST', body: {} });
    },

    // Create a one-time pairing code for another device (admin or any paired
    // device may do this; the server rotates the creator's unused codes).
    async createPairingCode(){
      const result = await request('/v1/pair/codes', { method: 'POST', body: {} });
      return { code: result?.code, expiresAt: Number(result?.expiresAt) || 0 };
    },
  };
}

// POST {endpoint}/v1/pair/claim — no auth: exchanges a one-time pairing code
// for a fresh device token. Used by the pairing UI before any config exists.
export async function claimPairingCode(endpoint, { code, deviceId, deviceName, fetchImpl }){
  const fetchFn = fetchImpl || globalThis.fetch?.bind(globalThis);
  if (!fetchFn) throw new Error('fetch is not available in this environment');
  const baseUrl = String(endpoint || '').replace(/\/+$/, '');
  const response = await fetchFn(`${baseUrl}/v1/pair/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: String(code || ''), deviceId, deviceName }),
  });
  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.message || body?.error || '';
    } catch (_) {}
    throw createError(
      detail ? `Pairing failed: ${detail}` : `Pairing failed (HTTP ${response.status})`,
      response.status === 401 ? 'pairing_code' : 'pairing',
      response.status
    );
  }
  return response.json();
}
