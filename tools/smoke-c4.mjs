// tools/smoke-c4.mjs — Stage C4 two/three-browser live smoke: product closure.
//
// Three independent browser clients (Chromium ×2, Firefox), separate storage,
// real HTTP sync service:
//
//   phone captures twice, desktop processes one → a THIRD brand-new browser
//   pairs and syncs ONCE → it reconstructs the whole state (bootstrap, no
//   manual JSON import) → the Sync panel shows all three devices under
//   «Мои устройства» → the new device renames itself.
//
// Usage: node tools/smoke-c4.mjs
import { chromium, firefox } from 'playwright';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  ROOT,
  assert,
  closeAll,
  log,
  makeAdminToken,
  pairDevice,
  startStaticServer,
  startSyncServer,
  waitFor,
} from './smoke-shared.mjs';

const DB_PATH = join(ROOT, 'output', '.smoke-c4.sqlite');
const ADMIN_TOKEN = makeAdminToken();

let browserA = null;
let browserB = null;
let failure = null;

const staticEntry = await startStaticServer();
const syncEntry = await startSyncServer({
  token: ADMIN_TOKEN,
  dbPath: DB_PATH,
  allowedOrigins: [staticEntry.origin],
});

try {
  browserA = await chromium.launch({ headless: true });
  browserB = await firefox.launch({ headless: true });

  const pageA = await browserA.newContext().then(context => context.newPage());
  const pageB = await browserB.newContext().then(context => context.newPage());
  const contextC = await browserA.newContext(); // independent storage = new device
  const pageC = await contextC.newPage();
  const pageErrors = [];
  for (const [label, page] of [['A', pageA], ['B', pageB], ['C', pageC]]) {
    page.on('pageerror', error => pageErrors.push(`${label}: ${error.message}`));
  }

  for (const [page, path] of [[pageA, '/capture/'], [pageB, '/'], [pageC, '/capture/']]) {
    await page.goto(`${staticEntry.origin}${path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(path === '/' ? '#btnInbox' : '#btnSave', { timeout: 15000 });
  }
  log('open', 'three independent clients loaded');

  await pairDevice(pageA, syncEntry.endpoint, ADMIN_TOKEN, 'Телефон');
  await pairDevice(pageB, syncEntry.endpoint, ADMIN_TOKEN, 'ПК');
  log('pair', 'phone + desktop paired');

  // --- 1. Phone builds a history; desktop processes one record --------------
  await pageA.fill('#captureText', 'Купить семена');
  await pageA.click('#btnSave');
  await pageA.fill('#captureText', 'Позвонить электрику');
  await pageA.click('#btnSave');
  await waitFor(async () => {
    const s = await pageA.evaluate(() => window.atlasSync.getStatus());
    return s.pending === 0 && !s.lastError;
  }, { label: 'A pushed both captures' });
  log('capture', 'phone captured two records');

  await waitFor(async () => {
    return await pageB.evaluate(() => window.state?.inbox?.length === 2);
  }, { timeout: 45000, label: 'B received both records' });
  await pageB.evaluate(async () => {
    const { updateInbox } = await import('/js/core/commands.js');
    updateInbox(window.state.inbox.find(item => item.rawText === 'Купить семена').id, {
      status: 'processed', itemType: 'thought',
    });
    window.atlasSync.requestSync();
  });
  await waitFor(async () => {
    const s = await pageB.evaluate(() => window.atlasSync.getStatus());
    return s.pending === 0 && !s.lastError;
  }, { label: 'B processed one record' });
  log('process', 'desktop processed one record');

  // --- 2. A brand-new third device bootstraps from one sync ------------------
  await pairDevice(pageC, syncEntry.endpoint, ADMIN_TOKEN, 'Планшет');
  await pageC.evaluate(() => window.atlasSync.syncNow());
  await waitFor(async () => {
    return await pageC.evaluate(() => window.state?.inbox?.length === 2);
  }, { timeout: 45000, label: 'C bootstrapped both records from zero' });
  const cState = await pageC.evaluate(() => ({
    inbox: window.state.inbox.length,
    processed: window.state.inbox.filter(item => item.status === 'processed').length,
    rawTexts: window.state.inbox.map(item => item.rawText).sort(),
  }));
  assert(cState.inbox === 2 && cState.processed === 1, `bootstrap mismatch: ${JSON.stringify(cState)}`);
  assert(cState.rawTexts.join('|') === 'Купить семена|Позвонить электрику', `rawTexts mismatch: ${cState.rawTexts}`);
  log('bootstrap', 'third device reconstructed the full state in one sync (no JSON import)');

  // --- 3. Device management UI: three devices, rename self --------------------
  await pageC.click('#btnInfo');
  await waitFor(async () => {
    return await pageC.evaluate(() => document.querySelectorAll('.atlas-sync-device').length === 3);
  }, { label: 'C panel lists three devices' });
  const deviceNames = await pageC.evaluate(() =>
    [...document.querySelectorAll('.atlas-sync-device-name')].map(node => node.textContent));
  log('devices', `panel shows: ${deviceNames.join(' | ')}`);

  await pageC.evaluate(() => {
    const button = [...document.querySelectorAll('.atlas-sync-device .atlas-sync-btn')]
      .find(el => el.textContent === 'Переименовать');
    window.prompt = () => 'Планшет пользователя';
    button.click();
  });
  await waitFor(async () => {
    return await pageC.evaluate(() => window.atlasSync.getConfig()?.deviceName === 'Планшет пользователя');
  }, { label: 'C renamed itself (server + local config)' });
  const serverNames = await pageC.evaluate(async () => (await window.atlasSync.listDevices()).map(d => d.deviceName));
  assert(serverNames.includes('Планшет пользователя'), `rename not on the server: ${serverNames}`);
  log('rename', 'device renamed through the panel; server and config agree');

  // --- 4. Hygiene -------------------------------------------------------------
  const aState = await pageA.evaluate(() => ({
    inbox: window.state.inbox.length,
    pending: window.atlasSync.getStatus().pending,
  }));
  assert(aState.inbox === 2 && aState.pending === 0, `A hygiene mismatch: ${JSON.stringify(aState)}`);
  const fatal = pageErrors.filter(message => !message.includes('favicon'));
  assert(fatal.length === 0, `page errors: ${fatal.join(' | ')}`);
  log('clean', 'no duplicates, nothing pending, no page errors');

  console.log('\n✅ C4 two/three-browser smoke passed: bootstrap from zero + device management UI.');
} catch (error) {
  failure = error;
  console.error('\n❌ C4 two/three-browser smoke failed:', error.message);
} finally {
  if (browserA) await browserA.close().catch(() => {});
  if (browserB) await browserB.close().catch(() => {});
  try { await closeAll(staticEntry, syncEntry); } catch (_) {}
  if (existsSync(DB_PATH)) rmSync(DB_PATH, { force: true });
}

process.exit(failure ? 1 : 0);
