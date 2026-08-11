import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInboxSyncServer } from '../server/inbox-sync-server.js';

function assert(condition, message){
  if (!condition) throw new Error(message);
}

const token = 'atlas-test-token-with-more-than-24-chars';
const directory = await mkdtemp(join(tmpdir(), 'atlas-sync-'));
const dbPath = join(directory, 'sync.sqlite');

function makeItem(text = 'Capture from phone'){
  return {
    id: 'inbox-phone-1',
    text,
    rawText: text,
    inputType: 'voice',
    source: 'mobile-capture',
    status: 'new',
    userHint: 'thought',
    deviceId: 'phone-1',
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function makeBatch(item = makeItem()){
  return {
    protocol: 1,
    deviceId: 'phone-1',
    operations: [{
      operationId: 'op-phone-1',
      deviceId: 'phone-1',
      timestamp: 1000,
      item,
    }],
  };
}

async function withServer(run){
  const server = createInboxSyncServer({ token, dbPath, allowedOrigins: ['*'] });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

try {
  await withServer(async endpoint => {
    const unauthorized = await fetch(`${endpoint}/v1/inbox/pull?after=0`);
    assert(unauthorized.status === 401, 'Data endpoints must require a bearer token');

    const push = await fetch(`${endpoint}/v1/inbox/push`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(makeBatch()),
    });
    const pushed = await push.json();
    assert(push.status === 200, 'Valid push must succeed');
    assert(pushed.acknowledgedOperationIds[0] === 'op-phone-1', 'Stored operation must be acknowledged');
    assert(pushed.conflicts.length === 0, 'First push must not conflict');

    const duplicate = await fetch(`${endpoint}/v1/inbox/push`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(makeBatch()),
    });
    const duplicated = await duplicate.json();
    assert(duplicated.acknowledgedOperationIds.length === 1, 'Repeated push must be idempotently acknowledged');

    const conflict = await fetch(`${endpoint}/v1/inbox/push`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(makeBatch(makeItem('Divergent text'))),
    });
    const conflicted = await conflict.json();
    assert(conflicted.acknowledgedOperationIds.length === 0, 'Conflicting operation must not be acknowledged');
    assert(conflicted.conflicts[0]?.reason === 'operation_id_conflict', 'Conflict reason must be explicit');

    const pull = await fetch(`${endpoint}/v1/inbox/pull?after=0&limit=100`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const pulled = await pull.json();
    assert(pulled.records.length === 1, 'Pull must return the stored capture once');
    assert(pulled.records[0].sequence === '1', 'First server sequence must be stable');
    assert(pulled.records[0].item.text === 'Capture from phone', 'Stored item must remain unchanged');
  });

  await withServer(async endpoint => {
    const pull = await fetch(`${endpoint}/v1/inbox/pull?after=0`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const persisted = await pull.json();
    assert(persisted.records.length === 1, 'SQLite data must survive server restart');
  });
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log('Inbox sync server test passed.');
