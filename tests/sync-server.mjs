// Stage C1 — Atlas Sync remote service tests.
// Covers the HTTP transport contract over a live server (real fetch):
// pairing lifecycle (code → token → revoke), bearer auth, push validation,
// idempotent replay, per-op conflicts, cursor pull with device exclusion,
// CORS allowlist, rate limiting.
import { createSyncServer } from '../server/sync-server.js';
import { SYNC_PROTOCOL } from '../server/sync-server.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const ADMIN_TOKEN = 'test-admin-token-0123456789abcdef';
let server = null;
let baseUrl = '';

async function startServer(options = {}){
  server = createSyncServer({ token: ADMIN_TOKEN, ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

async function stopServer(){
  if (!server) return;
  await new Promise(resolve => server.close(resolve));
  server = null;
}

async function api(path, { method = 'GET', body, token, headers = {} } = {}){
  const requestHeaders = { ...headers };
  if (token) requestHeaders.Authorization = `Bearer ${token}`;
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await response.json(); } catch (_) {}
  return { status: response.status, json };
}

function makeOperation(overrides = {}){
  return {
    schema: 1,
    id: `op-${Math.random().toString(36).slice(2, 14)}`,
    deviceId: 'device-test',
    sequence: 1,
    timestamp: Date.now(),
    type: 'inbox.capture',
    entityType: 'inbox',
    entityId: 'inbox-1',
    baseVersion: null,
    payload: { id: 'inbox-1', rawText: 'Запись с сервера', status: 'new', createdAt: Date.now() },
    ...overrides,
  };
}

async function pairDevice(deviceId, deviceName = 'Test device'){
  const codes = await api('/v1/pair/codes', { method: 'POST', token: ADMIN_TOKEN, body: {} });
  assert(codes.status === 200 && /^\d{8}$/.test(codes.json.code), 'pair: admin can create a code');
  const claimed = await api('/v1/pair/claim', {
    method: 'POST',
    body: { code: codes.json.code, deviceId, deviceName },
  });
  assert(claimed.status === 200 && typeof claimed.json.token === 'string' && claimed.json.token.length >= 32, 'pair: claim returns a device token');
  return claimed.json.token;
}

// --- Test 1: health + auth boundary --------------------------------------
{
  await startServer();
  const health = await api('/health');
  assert(health.status === 200 && health.json.ok === true, 'Test 1a: /health is open');
  const noAuth = await api('/v1/ops/pull');
  assert(noAuth.status === 401, 'Test 1b: pull without token is 401');
  const badToken = await api('/v1/ops/pull', { token: 'wrong-token-value' });
  assert(badToken.status === 401, 'Test 1c: unknown token is 401');
  console.log('✓ Test 1: health + auth boundary');
}

// --- Test 2: pairing lifecycle --------------------------------------------
{
  const code1 = await api('/v1/pair/codes', { method: 'POST', token: ADMIN_TOKEN, body: {} });
  const tokenA = await pairDevice('device-pair-a');
  // The same code is single-use
  const reuse = await api('/v1/pair/claim', {
    method: 'POST',
    body: { code: code1.json.code, deviceId: 'device-pair-b' },
  });
  assert(reuse.status === 401, 'Test 2a: pairing code is single-use');

  const bad = await api('/v1/pair/claim', {
    method: 'POST',
    body: { code: '00000000', deviceId: 'device-pair-c' },
  });
  assert(bad.status === 401, 'Test 2b: unknown code rejected');

  const malformed = await api('/v1/pair/claim', {
    method: 'POST',
    body: { code: '12ab', deviceId: 'device-pair-d' },
  });
  assert(malformed.status === 400, 'Test 2c: malformed code rejected');

  // A device token can create codes for further devices (recovery path)
  const code2 = await api('/v1/pair/codes', { method: 'POST', token: tokenA, body: {} });
  assert(code2.status === 200 && /^\d{8}$/.test(code2.json.code), 'Test 2d: paired device can create codes');
  console.log('✓ Test 2: pairing lifecycle');
}

// --- Test 3: push + idempotent replay + per-op conflicts ------------------
{
  const token = await pairDevice('device-push');
  const op = makeOperation({ deviceId: 'device-push' });
  const push1 = await api('/v1/ops/push', {
    method: 'POST',
    token,
    body: { protocol: SYNC_PROTOCOL, deviceId: 'device-push', operations: [op] },
  });
  assert(push1.status === 200 && push1.json.ackedIds.includes(op.id) && push1.json.conflicts.length === 0, 'Test 3a: valid op acknowledged');

  // Idempotent replay: identical op is acked, not stored twice
  const push2 = await api('/v1/ops/push', {
    method: 'POST',
    token,
    body: { protocol: SYNC_PROTOCOL, deviceId: 'device-push', operations: [op] },
  });
  assert(push2.status === 200 && push2.json.ackedIds.includes(op.id), 'Test 3b: replay acknowledged (idempotent)');

  // Same operationId with a different payload → conflict, not stored
  const op2 = makeOperation({ deviceId: 'device-push', id: op.id, payload: { ...op.payload, rawText: 'Другая запись' } });
  const push3 = await api('/v1/ops/push', {
    method: 'POST',
    token,
    body: { protocol: SYNC_PROTOCOL, deviceId: 'device-push', operations: [op2] },
  });
  assert(push3.json.ackedIds.length === 0 && push3.json.conflicts.some(c => c.operationId === op.id), 'Test 3c: conflicting replay reported, not stored');

  // Invalid ops are reported per-op; valid ones still pass
  const good = makeOperation({ deviceId: 'device-push' });
  const bad = makeOperation({ deviceId: 'device-push', type: 'inbox.wild_type' });
  const push4 = await api('/v1/ops/push', {
    method: 'POST',
    token,
    body: { protocol: SYNC_PROTOCOL, deviceId: 'device-push', operations: [good, bad] },
  });
  assert(push4.json.ackedIds.includes(good.id), 'Test 3d: valid op in mixed batch acked');
  assert(push4.json.conflicts.some(c => c.operationId === bad.id && c.reason === 'invalid_operation'), 'Test 3e: invalid op quarantined server-side as conflict');
  assert(push4.json.ackedIds.length === 1, 'Test 3f: only the valid op acked');

  // deviceId mismatch with the credential
  const foreign = makeOperation({ deviceId: 'device-other' });
  const push5 = await api('/v1/ops/push', {
    method: 'POST',
    token,
    body: { protocol: SYNC_PROTOCOL, deviceId: 'device-other', operations: [foreign] },
  });
  assert(push5.status === 403, 'Test 3g: batch deviceId must match the credential');
  console.log('✓ Test 3: push, idempotent replay, per-op conflicts');
}

// --- Test 4: cursor pull + device exclusion + limit ------------------------
{
  const tokenA = await pairDevice('device-pull-a');
  const tokenB = await pairDevice('device-pull-b');
  const ackIds = [];
  for (let i = 0; i < 3; i += 1) {
    const op = makeOperation({ deviceId: 'device-pull-a', entityId: `inbox-${i}`, payload: { id: `inbox-${i}`, rawText: `Запись ${i}`, status: 'new' } });
    const push = await api('/v1/ops/push', {
      method: 'POST',
      token: tokenA,
      body: { protocol: SYNC_PROTOCOL, deviceId: 'device-pull-a', operations: [op] },
    });
    ackIds.push(push.json.ackedIds[0]);
  }

  const pullB = await api(`/v1/ops/pull?after=0&excludeDevice=device-pull-b`, { token: tokenB });
  const fromA = pullB.json.operations.filter(entry => entry.operation.deviceId === 'device-pull-a');
  assert(pullB.status === 200 && fromA.length === 3, 'Test 4a: B pulls all of A ops');
  assert(pullB.json.operations.every(entry => entry.operation.deviceId !== 'device-pull-b'), 'Test 4b: own ops excluded');
  assert(pullB.json.newCursor === pullB.json.operations[pullB.json.operations.length - 1].serverSequence, 'Test 4c: newCursor is the last sequence');

  const pullB2 = await api(`/v1/ops/pull?after=${pullB.json.newCursor}&excludeDevice=device-pull-b`, { token: tokenB });
  assert(pullB2.json.operations.length === 0 && pullB2.json.newCursor === pullB.json.newCursor, 'Test 4d: cursor does not regress');

  // A never sees its own ops back
  const pullA = await api(`/v1/ops/pull?after=0&excludeDevice=device-pull-a`, { token: tokenA });
  assert(pullA.json.operations.every(entry => entry.operation.deviceId !== 'device-pull-a'), 'Test 4e: pull excludes own device');

  const pullLimited = await api(`/v1/ops/pull?after=0&excludeDevice=device-pull-b&limit=2`, { token: tokenB });
  assert(pullLimited.json.operations.length === 2, 'Test 4f: limit honored');
  console.log('✓ Test 4: cursor pull, exclusion, limit');
}

// --- Test 5: server-side operation validation ------------------------------
{
  const token = await pairDevice('device-validate');
  const cases = [
    { op: makeOperation({ deviceId: 'device-validate', schema: 2 }), reason: 'bad schema' },
    { op: makeOperation({ deviceId: 'device-validate', id: 'not-an-op' }), reason: 'bad id' },
    { op: makeOperation({ deviceId: 'device-validate', timestamp: 'yesterday' }), reason: 'bad timestamp' },
    { op: makeOperation({ deviceId: 'device-validate', entityType: 'tasks' }), reason: 'bad entityType' },
    { op: makeOperation({ deviceId: 'device-validate', payload: 'text' }), reason: 'payload not object' },
    { op: makeOperation({ deviceId: 'device-validate', payload: { id: 'inbox-x', rawText: 'x'.repeat(200000) } }), reason: 'oversized payload' },
  ];
  for (const { op, reason } of cases) {
    const push = await api('/v1/ops/push', {
      method: 'POST',
      token,
      body: { protocol: SYNC_PROTOCOL, deviceId: 'device-validate', operations: [op] },
    });
    assert(push.json.ackedIds.length === 0 && push.json.conflicts.some(c => c.reason === 'invalid_operation'), `Test 5: rejected (${reason})`);
  }
  // Huge batch is refused outright
  const huge = await api('/v1/ops/push', {
    method: 'POST',
    token,
    body: { protocol: SYNC_PROTOCOL, deviceId: 'device-validate', operations: new Array(300).fill(makeOperation({ deviceId: 'device-validate' })) },
  });
  assert(huge.status === 400, 'Test 5b: oversized batch refused');
  console.log('✓ Test 5: server-side validation');
}

// --- Test 6: revoke-self ---------------------------------------------------
{
  const token = await pairDevice('device-revoke');
  const ok = await api('/v1/devices/revoke-self', { method: 'POST', token });
  assert(ok.status === 200 && ok.json.revoked === true, 'Test 6a: device revokes itself');
  const after = await api('/v1/ops/pull?after=0', { token });
  assert(after.status === 401, 'Test 6b: revoked token is rejected');
  // Re-pairing with the same deviceId works and issues a fresh token
  const newToken = await pairDevice('device-revoke');
  const after2 = await api('/v1/ops/pull?after=0', { token: newToken });
  assert(after2.status === 200, 'Test 6c: re-paired device works again');
  console.log('✓ Test 6: revoke-self + re-pair');
}

// --- Test 7: CORS allowlist + pairing rate limit ---------------------------
{
  await stopServer();
  await startServer({ allowedOrigins: ['https://atlas.example.test'] });

  const disallowed = await fetch(`${baseUrl}/v1/ops/pull`, { headers: { Origin: 'https://evil.example' } });
  assert(disallowed.status === 403, 'Test 7a: disallowed origin rejected');

  const preflight = await fetch(`${baseUrl}/v1/ops/pull`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://atlas.example.test', 'Access-Control-Request-Method': 'GET' },
  });
  assert(preflight.status === 204, 'Test 7b: preflight passes for allowed origin');
  assert(preflight.headers.get('access-control-allow-origin') === 'https://atlas.example.test', 'Test 7c: CORS header echoed');

  // Rate limiting on /v1/pair/claim (no auth needed) — 10 attempts/window
  await stopServer();
  await startServer({ pairingAttemptLimit: 3 });
  let limited = false;
  for (let i = 0; i < 4; i += 1) {
    const res = await fetch(`${baseUrl}/v1/pair/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '00000000', deviceId: 'device-ratelimit' }),
    });
    if (res.status === 429) limited = true;
  }
  assert(limited, 'Test 7d: pairing attempts are rate limited');
  console.log('✓ Test 7: CORS allowlist + rate limit');
}

await stopServer();
console.log('\n✅ All Stage C1 sync-server tests passed.');
