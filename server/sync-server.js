// server/sync-server.js — Atlas Sync v1 remote service (Stage C1).
//
// A minimal, dependency-free HTTP service (Node >= 22.13, `node:sqlite`)
// that speaks the SAME transport contract as the C0 dev relay
// (js/sync/relay.js):
//
//   pushOperations(ops)            → { ackedIds }
//   pullOperations(cursor, opts)   → { operations: [{serverSequence, operation}], newCursor }
//   acknowledge(opIds)             → void (engine does not use it)
//
// The engine keeps all its guarantees (durable outbox, idempotency, ack,
// retry, quarantine, baseVersion conflict detection) — the server is a
// thin durable store: it orders operations with a monotonic
// serverSequence (SQLite AUTOINCREMENT), dedupes by operationId, and
// serves pulls by cursor, excluding the requesting device's own
// operations.
//
// Security (minimum viable isolation, no account system):
//   - an admin bootstrap token lives ONLY in the server environment
//     (e.g. /etc/atlas-sync/atlas-sync.env on the VDS), never in the repo;
//   - devices pair with a short-lived single-use 8-digit code (HMAC-keyed,
//     TTL 5 min) and receive a per-device bearer token (32 random bytes);
//   - tokens are stored as SHA-256 hashes; a device can revoke itself;
//     re-pairing invalidates the old token;
//   - push requires the batch deviceId to match the token's device;
//   - pairing is rate-limited per source address;
//   - CORS is an explicit allowlist (no wildcard for credentials).
//
// No encryption at rest / in transit beyond HTTPS: the transport boundary is
// Apache + Let's Encrypt on the deployment host (see deploy/vds/README.md).

import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { URL } from 'node:url';

export const SYNC_PROTOCOL = 'atlas-sync-v1';
export const OPERATION_TYPES = new Set([
  'inbox.capture',
  'inbox.update',
  'inbox.route_to_task',
  'inbox.route_revert',
  'inbox.delete',
  'inbox.restore',
  'task.result.upsert',
  'task.result.remove',
]);
export const ENTITY_TYPES = new Set(['inbox', 'task']);

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_PAYLOAD_BYTES = 256 * 1024;
const MAX_RAW_TEXT_LENGTH = 100_000;
const MAX_OPERATION_COUNT = 200;
const MAX_PULL_LIMIT = 200;
const DEFAULT_PULL_LIMIT = 100;
const PAIRING_CODE_TTL_MS = 5 * 60 * 1000;
const PAIRING_ATTEMPT_WINDOW_MS = 5 * 60 * 1000;
const MAX_PAIRING_ATTEMPTS_PER_WINDOW = 10;

function boundedString(value, maxLength){
  const text = String(value ?? '').trim();
  return text && text.length <= maxLength ? text : null;
}

function safeLimit(value){
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(MAX_PULL_LIMIT, parsed)) : DEFAULT_PULL_LIMIT;
}

function safeCursor(value){
  const cursor = String(value ?? '0');
  return /^\d+$/.test(cursor) ? cursor : '0';
}

function sameSecret(left, right){
  const a = Buffer.from(String(left ?? ''), 'utf8');
  const b = Buffer.from(String(right ?? ''), 'utf8');
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function secretHash(value){
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

function pairingCodeHash(code, secret){
  return createHmac('sha256', secret).update(String(code), 'utf8').digest('hex');
}

function readJson(request){
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body is too large'), { statusCode: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (_) {
        reject(Object.assign(new Error('Request body must be valid JSON'), { statusCode: 400 }));
      }
    });
    request.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Operation validation — the server never stores garbage and never lets a bad
// operation poison the stream: invalid ops are reported per-op as conflicts.
// ---------------------------------------------------------------------------

function normalizeOperation(operation){
  if (!operation || typeof operation !== 'object') return null;
  if (operation.schema !== 1) return null;
  const id = boundedString(operation.id, 160);
  const deviceId = boundedString(operation.deviceId, 160);
  const entityId = boundedString(operation.entityId, 160);
  const timestamp = Number(operation.timestamp);
  const baseVersion = operation.baseVersion == null ? null : operation.baseVersion;
  const sequence = Number(operation.sequence);
  if (!id || !/^op-[\w.-]{8,}$/.test(id)) return null;
  if (!deviceId) return null;
  if (!OPERATION_TYPES.has(operation.type)) return null;
  if (!ENTITY_TYPES.has(operation.entityType) || !entityId) return null;
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  // Review: baseVersion is strictly a finite number or absent — strings,
  // booleans, whitespace must never slip through as "versions".
  if (baseVersion !== null && (typeof baseVersion !== 'number' || !Number.isFinite(baseVersion))) return null;
  // Review: inbox.delete / inbox.restore are version-sensitive — a missing
  // baseVersion must never be stored (the client would otherwise apply them
  // without race detection).
  if ((operation.type === 'inbox.delete' || operation.type === 'inbox.restore') && baseVersion === null) {
    return null;
  }
  if (!Number.isFinite(sequence) || sequence <= 0) return null;
  if (!operation.payload || typeof operation.payload !== 'object') return null;
  let payload;
  try {
    payload = JSON.parse(JSON.stringify(operation.payload));
  } catch (_) {
    return null;
  }
  if (payload === null || typeof payload !== 'object') return null;
  if (JSON.stringify(payload).length > MAX_PAYLOAD_BYTES) return null;
  if (typeof payload.rawText === 'string' && payload.rawText.length > MAX_RAW_TEXT_LENGTH) return null;
  return {
    schema: 1,
    id,
    deviceId,
    sequence,
    timestamp,
    type: operation.type,
    entityType: operation.entityType,
    entityId,
    baseVersion,
    payload,
  };
}

// ---------------------------------------------------------------------------
// SQLite store
// ---------------------------------------------------------------------------

function createStore(dbPath, pairing){
  const db = new DatabaseSync(dbPath);
  const codeTtlMs = pairing.codeTtlMs;
  const attemptLimit = pairing.attemptLimit;
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS sync_operations (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_id TEXT NOT NULL UNIQUE,
      device_id TEXT NOT NULL,
      operation_json TEXT NOT NULL,
      received_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_devices (
      device_id TEXT PRIMARY KEY,
      device_name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      revoked_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS pairing_codes (
      code_hash TEXT PRIMARY KEY,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      claimed_device_id TEXT
    );
  `);

  const findOperation = db.prepare(
    'SELECT device_id, operation_json FROM sync_operations WHERE operation_id = ?'
  );
  const insertOperation = db.prepare(`
    INSERT INTO sync_operations(operation_id, device_id, operation_json, received_at)
    VALUES (?, ?, ?, ?)
  `);
  const pullOperations = db.prepare(`
    SELECT sequence, operation_json
    FROM sync_operations
    WHERE sequence > ? AND device_id != ?
    ORDER BY sequence ASC
    LIMIT ?
  `);
  const countRecords = db.prepare('SELECT COUNT(*) AS count FROM sync_operations');
  const findDeviceByToken = db.prepare(`
    SELECT device_id, device_name
    FROM sync_devices
    WHERE token_hash = ? AND revoked_at IS NULL
  `);
  const touchDevice = db.prepare(
    'UPDATE sync_devices SET last_seen_at = ? WHERE device_id = ?'
  );
  const revokeDevice = db.prepare(
    'UPDATE sync_devices SET revoked_at = ? WHERE device_id = ? AND revoked_at IS NULL'
  );
  const upsertDevice = db.prepare(`
    INSERT INTO sync_devices(device_id, device_name, token_hash, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(device_id) DO UPDATE SET
      device_name = excluded.device_name,
      token_hash = excluded.token_hash,
      last_seen_at = excluded.last_seen_at,
      revoked_at = NULL
  `);
  const insertPairingCode = db.prepare(`
    INSERT INTO pairing_codes(code_hash, created_by, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `);
  const deletePairingCodesByCreator = db.prepare(
    'DELETE FROM pairing_codes WHERE created_by = ? AND used_at IS NULL'
  );
  const purgePairingCodes = db.prepare(
    'DELETE FROM pairing_codes WHERE expires_at < ? OR used_at IS NOT NULL'
  );
  const claimPairingCode = db.prepare(`
    UPDATE pairing_codes
    SET used_at = ?, claimed_device_id = ?
    WHERE code_hash = ? AND used_at IS NULL AND expires_at >= ?
  `);
  const countDevices = db.prepare(
    'SELECT COUNT(*) AS count FROM sync_devices WHERE revoked_at IS NULL'
  );
  const listDevices = db.prepare(`
    SELECT device_id, device_name, created_at, last_seen_at
    FROM sync_devices
    WHERE revoked_at IS NULL
    ORDER BY created_at ASC
  `);
  const renameDevice = db.prepare(
    'UPDATE sync_devices SET device_name = ? WHERE device_id = ?'
  );

  return {
    authenticate(token){
      const row = findDeviceByToken.get(secretHash(token));
      if (!row) return null;
      touchDevice.run(Date.now(), row.device_id);
      return { type: 'device', deviceId: row.device_id, deviceName: row.device_name };
    },

    revokeDevice(deviceId){
      return revokeDevice.run(Date.now(), deviceId).changes === 1;
    },

    // C4 device management: every device of the same sync-space may see the
    // list; renaming applies to the authenticated device only.
    devices(){
      return listDevices.all().map(row => ({
        deviceId: row.device_id,
        deviceName: row.device_name,
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
      }));
    },

    renameDevice(deviceId, deviceName){
      const name = boundedString(deviceName, 80);
      if (!name) throw Object.assign(new Error('Invalid device name'), { statusCode: 400 });
      renameDevice.run(name, deviceId);
      return { deviceId, deviceName: name };
    },

    createPairingCode(createdBy){
      const now = Date.now();
      purgePairingCodes.run(now);
      deletePairingCodesByCreator.run(createdBy);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = randomInt(0, 100_000_000).toString().padStart(8, '0');
        try {
          insertPairingCode.run(
            pairingCodeHash(code, pairing.secret),
            createdBy,
            now,
            now + codeTtlMs
          );
          return { code, expiresAt: now + codeTtlMs };
        } catch (error) {
          if (!String(error.message).includes('UNIQUE')) throw error;
        }
      }
      throw new Error('Unable to allocate pairing code');
    },

    claimPairingCode(input){
      const code = String(input?.code || '').replace(/\D/g, '');
      const deviceId = boundedString(input?.deviceId, 160);
      const deviceName = boundedString(input?.deviceName, 80) || 'Atlas device';
      if (!/^\d{8}$/.test(code) || !deviceId) {
        throw Object.assign(new Error('Invalid pairing request'), { statusCode: 400 });
      }
      const now = Date.now();
      const token = randomBytes(32).toString('base64url');
      db.exec('BEGIN IMMEDIATE');
      try {
        const claimed = claimPairingCode.run(
          now,
          deviceId,
          pairingCodeHash(code, pairing.secret),
          now
        );
        if (claimed.changes !== 1) {
          throw Object.assign(new Error('Pairing code is invalid or expired'), { statusCode: 401 });
        }
        upsertDevice.run(deviceId, deviceName, secretHash(token), now, now);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return { token, deviceId, deviceName };
    },

    push(batch, authenticatedDeviceId = null){
      if (batch?.protocol !== SYNC_PROTOCOL) {
        throw Object.assign(new Error('Unsupported sync protocol'), { statusCode: 400 });
      }
      const deviceId = boundedString(batch.deviceId, 160);
      const operations = Array.isArray(batch.operations) ? batch.operations : null;
      if (!deviceId || !operations || operations.length > MAX_OPERATION_COUNT) {
        throw Object.assign(new Error('Invalid push batch'), { statusCode: 400 });
      }
      if (authenticatedDeviceId && authenticatedDeviceId !== deviceId) {
        throw Object.assign(new Error('Device credential does not match push batch'), { statusCode: 403 });
      }

      const ackedIds = [];
      const conflicts = [];
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const raw of operations) {
          const operation = normalizeOperation(raw);
          const operationId = operation?.id || boundedString(raw?.id, 160);
          if (!operation || operation.deviceId !== deviceId) {
            conflicts.push({ operationId, reason: 'invalid_operation' });
            continue;
          }
          const operationJson = JSON.stringify(operation);
          const prior = findOperation.get(operation.id);
          if (prior) {
            // Idempotent replay: identical operation (same device, same
            // payload) is acknowledged, not stored twice.
            if (prior.device_id === deviceId && prior.operation_json === operationJson) {
              ackedIds.push(operation.id);
            } else {
              conflicts.push({ operationId: operation.id, reason: 'operation_id_conflict' });
            }
            continue;
          }
          insertOperation.run(operation.id, deviceId, operationJson, Date.now());
          ackedIds.push(operation.id);
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }

      return {
        protocol: SYNC_PROTOCOL,
        ackedIds,
        conflicts,
      };
    },

    pull(after, limit, excludeDeviceId = null){
      const cursor = safeCursor(after);
      const rows = pullOperations.all(
        cursor,
        boundedString(excludeDeviceId, 160) || '',
        safeLimit(limit)
      );
      const operations = rows.map(row => ({
        serverSequence: Number(row.sequence),
        operation: JSON.parse(row.operation_json),
      }));
      const newCursor = operations.length
        ? operations[operations.length - 1].serverSequence
        : Number(cursor);
      return {
        protocol: SYNC_PROTOCOL,
        operations,
        newCursor,
      };
    },

    status(){
      return {
        records: Number(countRecords.get().count),
        devices: Number(countDevices.get().count),
      };
    },

    close(){
      db.close();
    },
  };
}

export function createSyncServer(options = {}){
  const adminToken = String(options.token ?? '');
  if (adminToken.length < 24) throw new Error('Sync token must contain at least 24 characters');
  const pairingCodeTtlMs = Number.isFinite(options.pairingCodeTtlMs)
    ? Math.max(1, options.pairingCodeTtlMs)
    : PAIRING_CODE_TTL_MS;
  const maxPairingAttempts = Number.isFinite(options.pairingAttemptLimit)
    ? Math.max(1, options.pairingAttemptLimit)
    : MAX_PAIRING_ATTEMPTS_PER_WINDOW;

  const store = createStore(options.dbPath || ':memory:', {
    secret: adminToken,
    codeTtlMs: pairingCodeTtlMs,
    attemptLimit: maxPairingAttempts,
  });
  const allowedOrigins = new Set(options.allowedOrigins || []);
  const pairingAttempts = new Map();

  const server = createServer(async (request, response) => {
    const origin = request.headers.origin;
    const originAllowed = !origin || allowedOrigins.has('*') || allowedOrigins.has(origin);
    if (origin && originAllowed) {
      response.setHeader('Access-Control-Allow-Origin', allowedOrigins.has('*') ? '*' : origin);
      response.setHeader('Vary', 'Origin');
      response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }

    const send = (statusCode, payload) => {
      response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(payload));
    };

    try {
      if (request.method === 'OPTIONS') {
        if (!originAllowed) return send(403, { error: 'origin_not_allowed' });
        response.writeHead(204);
        response.end();
        return;
      }

      const url = new URL(request.url || '/', 'http://localhost');
      if (request.method === 'GET' && url.pathname === '/health') {
        return send(200, { ok: true, service: 'atlas-sync', ...store.status() });
      }

      if (!originAllowed) return send(403, { error: 'origin_not_allowed' });

      if (request.method === 'POST' && url.pathname === '/v1/pair/claim') {
        // The public entry point is Apache on the same host; the Node service
        // binds to loopback, so X-Forwarded-For is the real client address.
        const forwardedChain = String(request.headers['x-forwarded-for'] || '')
          .split(',')
          .map(value => value.trim())
          .filter(Boolean);
        const forwarded = forwardedChain.at(-1) || '';
        const address = forwarded || request.socket.remoteAddress || 'unknown';
        const now = Date.now();
        const prior = pairingAttempts.get(address);
        const attempts = !prior || prior.resetAt <= now
          ? { count: 0, resetAt: now + PAIRING_ATTEMPT_WINDOW_MS }
          : prior;
        if (attempts.count >= maxPairingAttempts) {
          return send(429, { error: 'pairing_rate_limited', message: 'Too many pairing attempts' });
        }
        attempts.count += 1;
        pairingAttempts.set(address, attempts);
        try {
          const claimed = store.claimPairingCode(await readJson(request));
          pairingAttempts.delete(address);
          return send(200, claimed);
        } catch (error) {
          throw error;
        }
      }

      const authorization = request.headers.authorization || '';
      const suppliedToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
      const admin = sameSecret(suppliedToken, adminToken);
      const credential = admin ? { type: 'admin', deviceId: null } : store.authenticate(suppliedToken);
      if (!credential) return send(401, { error: 'unauthorized' });

      if (request.method === 'POST' && url.pathname === '/v1/pair/codes') {
        const createdBy = credential.deviceId || 'admin';
        return send(200, store.createPairingCode(createdBy));
      }

      if (request.method === 'POST' && url.pathname === '/v1/devices/revoke-self') {
        if (credential.type !== 'device') {
          return send(403, { error: 'device_credential_required' });
        }
        store.revokeDevice(credential.deviceId);
        return send(200, { revoked: true });
      }

      // C4 device management
      if (request.method === 'GET' && url.pathname === '/v1/devices') {
        return send(200, { devices: store.devices() });
      }
      if (request.method === 'POST' && url.pathname === '/v1/devices/rename') {
        if (credential.type !== 'device') {
          return send(403, { error: 'device_credential_required' });
        }
        const body = await readJson(request);
        return send(200, store.renameDevice(credential.deviceId, body?.deviceName));
      }
      if (request.method === 'POST' && url.pathname === '/v1/devices/revoke') {
        // Admin can revoke any device of the sync-space (device recovery path).
        if (credential.type !== 'admin') {
          return send(403, { error: 'admin_credential_required' });
        }
        const body = await readJson(request);
        const deviceId = boundedString(body?.deviceId, 160);
        if (!deviceId) return send(400, { error: 'invalid_request', message: 'deviceId required' });
        return send(200, { revoked: store.revokeDevice(deviceId) });
      }

      if (request.method === 'POST' && url.pathname === '/v1/ops/push') {
        return send(200, store.push(await readJson(request), credential.deviceId));
      }
      if (request.method === 'GET' && url.pathname === '/v1/ops/pull') {
        return send(200, store.pull(
          url.searchParams.get('after'),
          url.searchParams.get('limit'),
          url.searchParams.get('excludeDevice')
        ));
      }
      return send(404, { error: 'not_found' });
    } catch (error) {
      if (!response.headersSent) {
        send(error.statusCode || 500, {
          error: error.statusCode ? 'invalid_request' : 'internal_error',
          message: error.message,
        });
      } else {
        response.destroy();
      }
    }
  });

  let closed = false;
  server.on('close', () => {
    if (closed) return;
    closed = true;
    store.close();
  });
  return server;
}

