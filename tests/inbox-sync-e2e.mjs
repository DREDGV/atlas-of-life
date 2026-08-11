import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInboxHttpTransport } from '../js/sync/http-transport.js';
import { runInboxSyncCycle } from '../js/sync/inbox-sync.js';
import { createInboxSyncServer } from '../server/inbox-sync-server.js';

function assert(condition, message){
  if (!condition) throw new Error(message);
}

function item(id, deviceId, text, createdAt){
  return {
    id,
    text,
    rawText: text,
    inputType: 'text',
    source: deviceId === 'phone-1' ? 'mobile-capture' : 'desktop-capture',
    status: 'new',
    userHint: null,
    deviceId,
    createdAt,
    updatedAt: createdAt,
  };
}

function operation(value, deviceId = value.deviceId){
  return {
    id: `op-${value.id}`,
    deviceId,
    timestamp: value.createdAt,
    type: 'inbox.capture',
    entityType: 'inbox',
    entityId: value.id,
    payload: value,
    syncStatus: 'pending',
  };
}

async function cycle(device, transport){
  return runInboxSyncCycle({
    inbox: device.inbox,
    operationLog: device.operations,
    deviceId: device.id,
    cursor: device.cursor,
    transport,
    async persist({ nextCursor }){
      device.cursor = nextCursor;
      device.persisted += 1;
    },
  });
}

const directory = await mkdtemp(join(tmpdir(), 'atlas-e2e-'));
const token = 'atlas-e2e-token-with-more-than-24-chars';
const server = createInboxSyncServer({
  token,
  dbPath: join(directory, 'sync.sqlite'),
  allowedOrigins: ['*'],
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${server.address().port}`;
const transport = createInboxHttpTransport({ endpoint, token });

try {
  const phoneCapture = item('inbox-phone-1', 'phone-1', 'Phone capture', 1000);
  const phone = { id: 'phone-1', inbox: [phoneCapture], operations: [operation(phoneCapture)], cursor: '0', persisted: 0 };
  const desktop = { id: 'desktop-1', inbox: [], operations: [], cursor: '0', persisted: 0 };

  const phonePush = await cycle(phone, transport);
  assert(phonePush.acknowledged === 1, 'Phone capture must reach durable server storage');
  assert(phone.operations[0].syncStatus === 'synced', 'Phone operation must be acknowledged locally');

  const desktopPull = await cycle(desktop, transport);
  assert(desktopPull.received === 1, 'Desktop must receive the phone capture');
  assert(desktop.inbox[0].text === 'Phone capture', 'Desktop must preserve phone text');
  assert(desktop.cursor === '1', 'Desktop cursor must advance after pull');

  const desktopCapture = item('inbox-desktop-1', null, 'Desktop capture', 2000);
  desktopCapture.source = 'desktop-capture';
  desktop.inbox.push(desktopCapture);
  desktop.operations.push(operation(desktopCapture, 'desktop-1'));
  const desktopPush = await cycle(desktop, transport);
  assert(desktopPush.acknowledged === 1, 'Desktop capture must reach durable server storage');

  const phonePull = await cycle(phone, transport);
  assert(phonePull.received === 1, 'Phone must receive the desktop capture');
  assert(phone.inbox.some(entry => entry.text === 'Desktop capture'), 'Phone must contain the desktop text');
  assert(phone.cursor === '2', 'Phone cursor must advance to the second server record');

  const repeated = await cycle(phone, transport);
  assert(repeated.received === 0, 'Repeated sync must not duplicate records');
  assert(phone.inbox.length === 2, 'Phone Inbox must remain deduplicated');
  assert(phone.persisted >= 3, 'Successful sync contacts must persist their cursors');
} finally {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  await rm(directory, { recursive: true, force: true });
}

console.log('Inbox sync end-to-end test passed.');
