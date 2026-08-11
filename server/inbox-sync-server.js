import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { URL } from 'node:url';
import {
  INBOX_SYNC_PROTOCOL,
  MAX_PUSH_LIMIT,
  normalizeSyncedInboxItem,
} from '../js/sync/inbox-protocol.js';

const MAX_BODY_BYTES = 1024 * 1024;

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

function createStore(path){
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

  return {
    push(batch){
      if (batch?.protocol !== INBOX_SYNC_PROTOCOL) {
        throw Object.assign(new Error('Unsupported sync protocol'), { statusCode: 400 });
      }
      const deviceId = boundedString(batch.deviceId);
      const operations = Array.isArray(batch.operations) ? batch.operations : null;
      if (!deviceId || !operations || operations.length > MAX_PUSH_LIMIT) {
        throw Object.assign(new Error('Invalid push batch'), { statusCode: 400 });
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
      return { records: Number(countItems.get().count) };
    },

    close(){
      db.close();
    },
  };
}

export function createInboxSyncServer(options = {}){
  const token = String(options.token ?? '');
  if (token.length < 24) throw new Error('Sync token must contain at least 24 characters');
  const store = createStore(options.dbPath || ':memory:');
  const allowedOrigins = new Set(options.allowedOrigins || []);

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
      const authorization = request.headers.authorization || '';
      const suppliedToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
      if (!sameSecret(suppliedToken, token)) return send(401, { error: 'unauthorized' });

      if (request.method === 'POST' && url.pathname === '/v1/inbox/push') {
        return send(200, store.push(await readJson(request)));
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
