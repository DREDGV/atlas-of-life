// tools/smoke-c1.mjs — Stage C1 two-browser live smoke.
//
// Proves the real Phone ↔ Remote ↔ Desktop loop with two INDEPENDENT
// browser clients (separate storage) talking over real HTTP to the Atlas
// Sync service:
//
//   browser A (capture PWA)   : pairs, captures via the real UI
//   sync service (server/)    : stores + orders operations
//   browser B (Atlas Studio)  : pairs, pulls, processes the item
//   sync service              : delivers the update back
//   browser A                 : sees the processed state
//
// Usage: node tools/smoke-c1.mjs
// Requires: playwright (installed), Chromium + Firefox browsers.
import { chromium, firefox } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { createSyncServer } from '../server/sync-server.js';

const ROOT = join(import.meta.dirname, '..');
const DB_PATH = join(ROOT, 'output', '.smoke-c1.sqlite');
const ADMIN_TOKEN = `smoke-admin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

function mimeFor(file){
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
  };
  return map[extname(file).toLowerCase()] || 'application/octet-stream';
}

// Minimal static file server for the apps (no directory listing, no dotfiles).
function createStaticServer(){
  return createServer((request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://localhost');
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === '/') pathname = '/index.html';
      if (pathname.endsWith('/')) pathname += 'index.html';
      const file = normalize(join(ROOT, pathname));
      if (!file.startsWith(ROOT) || pathname.includes('..') || pathname.split('/').some(part => part.startsWith('.'))) {
        response.writeHead(403).end('forbidden');
        return;
      }
      const body = readFileSync(file);
      response.writeHead(200, { 'Content-Type': mimeFor(file), 'Cache-Control': 'no-store' });
      response.end(body);
    } catch (_) {
      response.writeHead(404).end('not found');
    }
  });
}

function assert(condition, message){
  if (!condition) throw new Error(message);
}

function log(step, message){
  console.log(`  [smoke] ${step}: ${message}`);
}

async function waitFor(fn, { timeout = 20000, interval = 300, label = 'condition' } = {}){
  const start = Date.now();
  let lastError = null;
  while (Date.now() - start < timeout) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? ` (${lastError.message})` : ''}`);
}

// ---------------------------------------------------------------------------

if (existsSync(DB_PATH)) rmSync(DB_PATH, { force: true });

const staticServer = createStaticServer();
await new Promise(resolve => staticServer.listen(0, '127.0.0.1', resolve));
const staticPort = staticServer.address().port;
const appOrigin = `http://127.0.0.1:${staticPort}`;

const syncServer = createSyncServer({
  token: ADMIN_TOKEN,
  dbPath: DB_PATH,
  allowedOrigins: [appOrigin],
});
await new Promise(resolve => syncServer.listen(0, '127.0.0.1', resolve));
const syncPort = syncServer.address().port;
const syncEndpoint = `http://127.0.0.1:${syncPort}`;

let browserA = null;
let browserB = null;
let failure = null;
let liveSyncServer = syncServer;
let restarted = null;

try {
  // Pairing codes created with the admin token (what the operator does on the VDS).
  async function createCode(){
    const response = await fetch(`${syncEndpoint}/v1/pair/codes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert(response.ok, 'pairing code request failed');
    return (await response.json()).code;
  }

  browserA = await chromium.launch({ headless: true });
  browserB = await firefox.launch({ headless: true });

  const contextA = await browserA.newContext();
  const contextB = await browserB.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  const errors = [];
  pageA.on('pageerror', error => errors.push(`A: ${error.message}`));
  pageB.on('pageerror', error => errors.push(`B: ${error.message}`));

  // --- 1. Open both apps --------------------------------------------------
  await pageA.goto(`${appOrigin}/capture/`, { waitUntil: 'domcontentloaded' });
  await pageA.waitForSelector('#btnSave', { timeout: 15000 });
  log('open', 'capture PWA loaded in Chromium');

  await pageB.goto(`${appOrigin}/`, { waitUntil: 'domcontentloaded' });
  await pageB.waitForSelector('#btnInbox', { timeout: 15000 });
  log('open', 'Atlas Studio loaded in Firefox');

  // --- 2. Pair both devices through the real runtime API -------------------
  const codeA = await createCode();
  await pageA.evaluate(async ({ endpoint, code }) => {
    await window.atlasSync.pair({ endpoint, code, deviceName: 'Smoke Phone A' });
  }, { endpoint: syncEndpoint, code: codeA });
  log('pair', 'browser A paired (Chromium)');

  const codeB = await createCode();
  await pageB.evaluate(async ({ endpoint, code }) => {
    await window.atlasSync.pair({ endpoint, code, deviceName: 'Smoke Desktop B' });
  }, { endpoint: syncEndpoint, code: codeB });
  log('pair', 'browser B paired (Firefox)');

  await waitFor(async () => {
    const s = await pageA.evaluate(() => window.atlasSync.getStatus());
    return s.configured && !s.lastError;
  }, { label: 'A sync configured and healthy' });
  await waitFor(async () => {
    const s = await pageB.evaluate(() => window.atlasSync.getStatus());
    return s.configured && !s.lastError;
  }, { label: 'B sync configured and healthy' });

  // --- 3. Phone captures through the real UI --------------------------------
  await pageA.fill('#captureText', 'Позвонить бабушке про сливу');
  await pageA.click('#btnSave');
  await waitFor(async () => {
    const s = await pageA.evaluate(() => window.atlasSync.getStatus());
    return s.pending === 0 && !s.lastError;
  }, { label: 'A outbox drained' });
  log('capture', 'browser A captured via UI and pushed');

  // --- 4. Desktop receives it automatically (30 s poll) and processes -----
  await waitFor(async () => {
    return await pageB.evaluate(() => window.state?.inbox?.length === 1);
  }, { timeout: 45000, label: 'B applied the remote item via its poll' });
  const received = await pageB.evaluate(() => window.state.inbox[0].rawText);
  assert(received === 'Позвонить бабушке про сливу', `rawText mismatch: ${received}`);
  log('receive', 'browser B received the item via remote');

  await pageB.evaluate(async () => {
    const { updateInbox } = await import('/js/core/commands.js');
    const id = window.state.inbox[0].id;
    // No deviceId passed — like the real UI, the command uses this device's id.
    updateInbox(id, { status: 'processed', itemType: 'task' });
    window.atlasSync.requestSync();
  });
  await waitFor(async () => {
    const s = await pageB.evaluate(() => window.atlasSync.getStatus());
    return s.pending === 0 && !s.lastError;
  }, { label: 'B outbox drained after processing' });
  log('process', 'browser B processed the item and pushed the result');

  // --- 5. Phone sees the processed state -----------------------------------
  // The next poll on A (up to 30 s) is the real mechanism; the explicit
  // trigger below only accelerates it (identical code path).
  await pageA.evaluate(() => window.atlasSync.syncNow());
  try {
    await waitFor(async () => {
      return await pageA.evaluate(() => window.state?.inbox?.[0]?.status === 'processed');
    }, { timeout: 45000, label: 'A sees the processed state' });
  } catch (error) {
    const diag = await pageA.evaluate(() => ({
      status: window.atlasSync.getStatus(),
      conflicts: window.atlasSync.getConflicts().slice(-5),
      inbox: window.state.inbox,
      outbox: JSON.parse(localStorage.getItem('atlas-sync-outbox-v1') || '{"entries":[]}').entries.slice(-5),
    }));
    console.error('A diagnostics:', JSON.stringify(diag, null, 2));
    throw error;
  }
  const processed = await pageA.evaluate(() => ({
    status: window.state.inbox[0].status,
    itemType: window.state.inbox[0].itemType,
    rawText: window.state.inbox[0].rawText,
  }));
  assert(processed.status === 'processed' && processed.itemType === 'task', `processed state mismatch: ${JSON.stringify(processed)}`);
  log('sync-back', 'browser A sees the processed result (full round trip)');

  // --- 6. Idempotency: extra sync cycles create no duplicates ---------------
  await pageA.evaluate(() => window.atlasSync.syncNow());
  await pageB.evaluate(() => window.atlasSync.syncNow());
  await new Promise(resolve => setTimeout(resolve, 1500));
  const counts = await Promise.all([
    pageA.evaluate(() => window.state.inbox.length),
    pageB.evaluate(() => window.state.inbox.length),
  ]);
  assert(counts[0] === 1 && counts[1] === 1, `duplicate after re-sync: A=${counts[0]} B=${counts[1]}`);
  log('idempotency', 're-sync produced no duplicates on either device');

  // --- 7. Offline first: capture while the sync service is down --------------
  await new Promise(resolve => syncServer.close(resolve));
  await pageA.fill('#captureText', 'Запись без сервера');
  await pageA.click('#btnSave');
  await waitFor(async () => {
    const s = await pageA.evaluate(() => window.atlasSync.getStatus());
    return s.pending === 1;
  }, { label: 'A outbox holds the offline capture' });
  assert(await pageA.evaluate(() => window.state.inbox.length) === 2, 'offline capture still stored locally');
  log('offline', 'capture during server outage kept locally + queued');

  // Server comes back; the 30s poll would deliver it — trigger manually.
  restarted = createSyncServer({ token: ADMIN_TOKEN, dbPath: DB_PATH, allowedOrigins: [appOrigin] });
  await new Promise(resolve => restarted.listen(syncPort, '127.0.0.1', resolve));
  liveSyncServer = restarted;
  await pageA.evaluate(() => window.atlasSync.syncNow());
  await waitFor(async () => {
    const s = await pageA.evaluate(() => window.atlasSync.getStatus());
    return s.pending === 0 && !s.lastError;
  }, { label: 'A delivered the queued capture after restart' });
  await pageB.evaluate(() => window.atlasSync.syncNow());
  await waitFor(async () => {
    return await pageB.evaluate(() => window.state?.inbox?.length === 2);
  }, { label: 'B received the delayed capture' });
  log('retry', 'queued capture delivered after service restart');

  const fatal = errors.filter(message => !message.includes('favicon'));
  assert(fatal.length === 0, `page errors: ${fatal.join(' | ')}`);
  log('clean', 'no page errors on either client');

  console.log('\n✅ C1 two-browser smoke passed: Chromium (phone) ↔ HTTP service ↔ Firefox (desktop).');
} catch (error) {
  failure = error;
  console.error('\n❌ C1 two-browser smoke failed:', error.message);
} finally {
  if (browserA) await browserA.close().catch(() => {});
  if (browserB) await browserB.close().catch(() => {});
  await new Promise(resolve => staticServer.close(resolve));
  try { await new Promise(resolve => liveSyncServer.close(resolve)); } catch (_) {}
  if (existsSync(DB_PATH)) rmSync(DB_PATH, { force: true });
}

process.exit(failure ? 1 : 0);
