import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { URL } from 'node:url';
import {
  INBOX_SYNC_PROTOCOL,
  MAX_PUSH_LIMIT,
  normalizeSyncedInboxItem,
} from '../js/sync/inbox-protocol.js';

const MAX_BODY_BYTES = 1024 * 1024;
const PAIRING_CODE_TTL_MS = 5 * 60 * 1000;
const PAIRING_ATTEMPT_WINDOW_MS = 5 * 60 * 1000;
const MAX_PAIRING_ATTEMPTS_PER_WINDOW = 10;

function boundedString(value, maxLength = 160){
  const text = String(value ?? '').trim();
  return text && text.length <= maxLength ? text : null;
}

function safeLimit(value){
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(MAX_PUSH_LIMIT, parsed)) : 100;
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

function createStore(path, pairingSecret, pairingCodeTtlMs){
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS inbox_records (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id TEXT NOT NULL UNIQUE,
      item_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      device_id TEXT
    );
    CREATE TABLE IF NOT EXISTS sync_operations (
      operation_id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      item_json TEXT NOT NULL,
      received_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS inbox_records_sequence_idx
      ON inbox_records(sequence);
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
    CREATE INDEX IF NOT EXISTS pairing_codes_expiry_idx
      ON pairing_codes(expires_at);
  `);

  const findOperation = db.prepare(
    'SELECT device_id, item_id, item_json FROM sync_operations WHERE operation_id = ?'
  );
  const findItem = db.prepare(
    'SELECT sequence, item_json FROM inbox_records WHERE item_id = ?'
  );
  const insertItem = db.prepare(`
    INSERT INTO inbox_records(item_id, item_json, created_at, device_id)
    VALUES (?, ?, ?, ?)
  `);
  const insertOperation = db.prepare(`
    INSERT INTO sync_operations(operation_id, device_id, item_id, item_json, received_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const pullItems = db.prepare(`
    SELECT sequence, item_json
    FROM inbox_records
    WHERE sequence > ?
    ORDER BY sequence ASC
    LIMIT ?
  `);
  const countItems = db.prepare('SELECT COUNT(*) AS count FROM inbox_records');
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
  const insertPairingCode = db.prepare(`
    INSERT INTO pairing_codes(code_hash, created_by, created_at, expires_at)
    VALUES (?, ?, ?, ?)
  `);
  const deletePairingCodesByCreator = db.prepare(
    'DELETE FROM pairing_codes WHERE created_by = ? AND used_at IS NULL'
  );
  const claimPairingCode = db.prepare(`
    UPDATE pairing_codes
    SET used_at = ?, claimed_device_id = ?
    WHERE code_hash = ? AND used_at IS NULL AND expires_at >= ?
  `);
  const upsertDevice = db.prepare(`
    INSERT INTO sync_devices(device_id, device_name, token_hash, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(device_id) DO UPDATE SET
      device_name = excluded.device_name,
      token_hash = excluded.token_hash,
      last_seen_at = excluded.last_seen_at,
      revoked_at = NULL
  `);
  const purgePairingCodes = db.prepare(
    'DELETE FROM pairing_codes WHERE expires_at < ? OR used_at IS NOT NULL'
  );
  const countDevices = db.prepare(
    'SELECT COUNT(*) AS count FROM sync_devices WHERE revoked_at IS NULL'
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

    createPairingCode(createdBy){
      const now = Date.now();
      purgePairingCodes.run(now);
      deletePairingCodesByCreator.run(createdBy);
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = randomInt(0, 100_000_000).toString().padStart(8, '0');
        try {
          insertPairingCode.run(
            pairingCodeHash(code, pairingSecret),
            createdBy,
            now,
            now + pairingCodeTtlMs
          );
          return { code, expiresAt: now + pairingCodeTtlMs };
        } catch (error) {
          if (!String(error.message).includes('UNIQUE')) throw error;
        }
      }
      throw new Error('Unable to allocate pairing code');
    },

    claimPairingCode(input){
      const code = String(input?.code || '').replace(/\D/g, '');
      const deviceId = boundedString(input?.deviceId);
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
          pairingCodeHash(code, pairingSecret),
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
      if (batch?.protocol !== INBOX_SYNC_PROTOCOL) {
        throw Object.assign(new Error('Unsupported sync protocol'), { statusCode: 400 });
      }
      const deviceId = boundedString(batch.deviceId);
      const operations = Array.isArray(batch.operations) ? batch.operations : null;
      if (!deviceId || !operations || operations.length > MAX_PUSH_LIMIT) {
        throw Object.assign(new Error('Invalid push batch'), { statusCode: 400 });
      }
      if (authenticatedDeviceId && authenticatedDeviceId !== deviceId) {
        throw Object.assign(new Error('Device credential does not match push batch'), { statusCode: 403 });
      }

      const acknowledgedOperationIds = [];
      const conflicts = [];
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const operation of operations) {
          const operationId = boundedString(operation?.operationId);
          const operationDeviceId = boundedString(operation?.deviceId);
          const item = normalizeSyncedInboxItem(operation?.item);
          if (!operationId || operationDeviceId !== deviceId || !item ||
              (item.deviceId && item.deviceId !== deviceId)) {
            conflicts.push({ operationId, reason: 'invalid_operation' });
            continue;
          }

          const itemJson = JSON.stringify(item);
          const priorOperation = findOperation.get(operationId);
          if (priorOperation) {
            if (priorOperation.device_id === deviceId &&
                priorOperation.item_id === item.id &&
                priorOperation.item_json === itemJson) {
              acknowledgedOperationIds.push(operationId);
            } else {
              conflicts.push({ operationId, itemId: item.id, reason: 'operation_id_conflict' });
            }
            continue;
          }

          const priorItem = findItem.get(item.id);
          if (priorItem && priorItem.item_json !== itemJson) {
            conflicts.push({ operationId, itemId: item.id, reason: 'item_id_conflict' });
            continue;
          }

          if (!priorItem) {
            insertItem.run(item.id, itemJson, item.createdAt, item.deviceId);
          }
          insertOperation.run(operationId, deviceId, item.id, itemJson, Date.now());
          acknowledgedOperationIds.push(operationId);
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }

      return {
        protocol: INBOX_SYNC_PROTOCOL,
        acknowledgedOperationIds,
        conflicts,
      };
    },

    pull(after, limit){
      const cursor = safeCursor(after);
      const rows = pullItems.all(cursor, safeLimit(limit));
      const records = rows.map(row => ({
        sequence: String(row.sequence),
        item: JSON.parse(row.item_json),
      }));
      return {
        protocol: INBOX_SYNC_PROTOCOL,
        records,
        nextCursor: records.at(-1)?.sequence ?? cursor,
      };
    },

    status(){
      return {
        records: Number(countItems.get().count),
        devices: Number(countDevices.get().count),
      };
    },

    close(){
      db.close();
    },
  };
}

export function createInboxSyncServer(options = {}){
  const token = String(options.token ?? '');
  if (token.length < 24) throw new Error('Sync token must contain at least 24 characters');
  const pairingCodeTtlMs = Number.isFinite(options.pairingCodeTtlMs)
    ? Math.max(1, options.pairingCodeTtlMs)
    : PAIRING_CODE_TTL_MS;
  const pairingAttemptLimit = Number.isFinite(options.pairingAttemptLimit)
    ? Math.max(1, options.pairingAttemptLimit)
    : MAX_PAIRING_ATTEMPTS_PER_WINDOW;
  const store = createStore(options.dbPath || ':memory:', token, pairingCodeTtlMs);
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
        return send(200, { ok: true, service: 'atlas-inbox-sync', ...store.status() });
      }

      if (!originAllowed) return send(403, { error: 'origin_not_allowed' });

      if (request.method === 'POST' && url.pathname === '/v1/pair/claim') {
        // Apache is the only public entry point and the Node service is bound
        // to loopback, so its X-Forwarded-For value is the real client address.
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
        if (attempts.count >= pairingAttemptLimit) {
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
      const admin = sameSecret(suppliedToken, token);
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

      if (request.method === 'POST' && url.pathname === '/v1/inbox/push') {
        return send(200, store.push(await readJson(request), credential.deviceId));
      }
      if (request.method === 'GET' && url.pathname === '/v1/inbox/pull') {
        return send(200, store.pull(url.searchParams.get('after'), url.searchParams.get('limit')));
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

  server.on('close', () => store.close());
  return server;
}
