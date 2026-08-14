import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createInboxSyncServer } from '../server/inbox-sync-server.js';

function assert(condition, message){
  if (!condition) throw new Error(message);
}

const token = 'atlas-test-token-with-more-than-24-chars';
const directory = await mkdtemp(join(tmpdir(), 'atlas-sync-'));
const dbPath = join(directory, 'sync.sqlite');
let pairedToken = '';

async function jsonRequest(url, options = {}){
  const response = await fetch(url, options);
  const payload = await response.json();
  return { response, payload };
}

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

async function withServer(run, options = {}){
  const server = createInboxSyncServer({
    token,
    dbPath,
    allowedOrigins: ['*'],
    ...options,
  });
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

    const created = await jsonRequest(`${endpoint}/v1/pair/codes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert(created.response.status === 200, 'Admin credential must create a pairing code');
    assert(/^\d{8}$/.test(created.payload.code), 'Pairing code must contain eight digits');
    assert(created.payload.expiresAt > Date.now(), 'Pairing code must include a future expiry');

    const claimed = await jsonRequest(`${endpoint}/v1/pair/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: created.payload.code,
        deviceId: 'paired-phone-1',
        deviceName: 'Test phone',
      }),
    });
    assert(claimed.response.status === 200, 'Valid pairing code must issue a device credential');
    assert(claimed.payload.token.length >= 40, 'Device credential must have high entropy');
    assert(!claimed.payload.token.includes(created.payload.code), 'Credential must not contain pairing code');
    pairedToken = claimed.payload.token;

    const reused = await jsonRequest(`${endpoint}/v1/pair/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: created.payload.code,
        deviceId: 'paired-phone-2',
        deviceName: 'Second phone',
      }),
    });
    assert(reused.response.status === 401, 'Pairing code must be single-use');

    const pairedPull = await fetch(`${endpoint}/v1/inbox/pull?after=0`, {
      headers: { Authorization: `Bearer ${claimed.payload.token}` },
    });
    assert(pairedPull.status === 200, 'Issued device credential must authorize sync');

    const nestedCode = await jsonRequest(`${endpoint}/v1/pair/codes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${claimed.payload.token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    assert(nestedCode.response.status === 200, 'Paired device must pair another device');

    const replacementCode = await jsonRequest(`${endpoint}/v1/pair/codes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${claimed.payload.token}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    const superseded = await jsonRequest(`${endpoint}/v1/pair/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: nestedCode.payload.code, deviceId: 'superseded-device' }),
    });
    assert(superseded.response.status === 401, 'New code must invalidate prior code from the same device');
    assert(replacementCode.payload.code !== nestedCode.payload.code, 'Replacement code must be newly generated');

    const mismatchedPush = await fetch(`${endpoint}/v1/inbox/push`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${claimed.payload.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(makeBatch()),
    });
    assert(mismatchedPush.status === 403, 'Device credential must not impersonate another device ID');
  });

  const credentialDb = new DatabaseSync(dbPath, { readOnly: true });
  const storedCredential = credentialDb.prepare(
    'SELECT token_hash FROM sync_devices WHERE device_id = ?'
  ).get('paired-phone-1');
  credentialDb.close();
  assert(storedCredential.token_hash !== pairedToken, 'Database must not store device credential in clear text');
  assert(/^[a-f0-9]{64}$/.test(storedCredential.token_hash), 'Database must store a SHA-256 credential hash');

  await withServer(async endpoint => {
    const pull = await fetch(`${endpoint}/v1/inbox/pull?after=0`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const persisted = await pull.json();
    assert(persisted.records.length === 1, 'SQLite data must survive server restart');

    const pairedCredential = await fetch(`${endpoint}/v1/inbox/pull?after=0`, {
      headers: { Authorization: `Bearer ${pairedToken}` },
    });
    assert(pairedCredential.status === 200, 'Device credential must survive server restart');

    const revoked = await fetch(`${endpoint}/v1/devices/revoke-self`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${pairedToken}` },
    });
    assert(revoked.status === 200, 'Device must be able to revoke its credential');
    const afterRevoke = await fetch(`${endpoint}/v1/inbox/pull?after=0`, {
      headers: { Authorization: `Bearer ${pairedToken}` },
    });
    assert(afterRevoke.status === 401, 'Revoked credential must stop working immediately');
  });

  const expiryDirectory = await mkdtemp(join(tmpdir(), 'atlas-sync-expiry-'));
  const expiryDbPath = join(expiryDirectory, 'sync.sqlite');
  try {
    const expiryServer = createInboxSyncServer({
      token,
      dbPath: expiryDbPath,
      allowedOrigins: ['*'],
      pairingCodeTtlMs: 5,
      pairingAttemptLimit: 2,
    });
    await new Promise(resolve => expiryServer.listen(0, '127.0.0.1', resolve));
    const expiryEndpoint = `http://127.0.0.1:${expiryServer.address().port}`;
    try {
      const created = await jsonRequest(`${expiryEndpoint}/v1/pair/codes`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
      await new Promise(resolve => setTimeout(resolve, 15));
      const expired = await jsonRequest(`${expiryEndpoint}/v1/pair/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: created.payload.code, deviceId: 'late-device' }),
      });
      assert(expired.response.status === 401, 'Expired pairing code must be rejected');

      const invalid = body => jsonRequest(`${expiryEndpoint}/v1/pair/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const secondFailure = await invalid({ code: '00000000', deviceId: 'guess-1' });
      assert(secondFailure.response.status === 401, 'Invalid pairing guess must be rejected');
      const limited = await invalid({ code: '11111111', deviceId: 'guess-2' });
      assert(limited.response.status === 429, 'Repeated pairing guesses must be rate-limited');
    } finally {
      await new Promise((resolve, reject) => expiryServer.close(error => error ? reject(error) : resolve()));
    }
  } finally {
    await rm(expiryDirectory, { recursive: true, force: true });
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}

console.log('Inbox sync server test passed.');
