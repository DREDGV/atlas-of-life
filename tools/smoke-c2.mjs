// tools/smoke-c2.mjs — Stage C2 two-browser live smoke: Task Result Bridge.
//
// Chromium (phone, Capture PWA) and Firefox (desktop, Atlas Studio) with
// separate storage talk over real HTTP to the Atlas Sync service:
//
//   phone captures → desktop routes the item to a Task → phone shows a
//   readable result card → desktop edits the Task → phone follows →
//   desktop deletes the Task → phone shows the honest fallback.
//
// Asserts on the phone that NO Task copy exists (no Task CRUD replication).
//
// Usage: node tools/smoke-c2.mjs
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

const DB_PATH = join(ROOT, 'output', '.smoke-c2.sqlite');
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
  const pageErrors = [];
  pageA.on('pageerror', error => pageErrors.push(`A: ${error.message}`));
  pageB.on('pageerror', error => pageErrors.push(`B: ${error.message}`));

  // --- 1. Open both apps and pair -------------------------------------------
  await pageA.goto(`${staticEntry.origin}/capture/`, { waitUntil: 'domcontentloaded' });
  await pageA.waitForSelector('#btnSave', { timeout: 15000 });
  await pageB.goto(`${staticEntry.origin}/`, { waitUntil: 'domcontentloaded' });
  await pageB.waitForSelector('#btnInbox', { timeout: 15000 });
  log('open', 'capture PWA (Chromium) + Studio (Firefox) loaded');

  await pairDevice(pageA, syncEntry.endpoint, ADMIN_TOKEN, 'Smoke Phone A');
  await pairDevice(pageB, syncEntry.endpoint, ADMIN_TOKEN, 'Smoke Desktop B');
  log('pair', 'both devices paired through the app runtime');

  // --- 2. Phone captures via the real UI --------------------------------------
  await pageA.fill('#captureText', 'Починить калитку');
  await pageA.click('#btnSave');
  await waitFor(async () => {
    const s = await pageA.evaluate(() => window.atlasSync.getStatus());
    return s.pending === 0 && !s.lastError;
  }, { label: 'A outbox drained' });
  log('capture', 'phone captured via UI and pushed');

  // --- 3. Desktop routes the item to a Task (real Core commands) -------------
  await waitFor(async () => {
    return await pageB.evaluate(() => window.state?.inbox?.length === 1);
  }, { timeout: 45000, label: 'B received the capture' });

  await pageB.evaluate(async () => {
    const { updateInbox, routeInboxToTask } = await import('/js/core/commands.js');
    const item = window.state.inbox[0];
    updateInbox(item.id, { itemType: 'task' });
    routeInboxToTask(item.id, { projectId: 'p3', priority: 3, due: { date: '2026-08-24', time: '10:00' } });
    window.atlasSync.requestSync();
  });
  await waitFor(async () => {
    const s = await pageB.evaluate(() => window.atlasSync.getStatus());
    return s.pending === 0 && !s.lastError;
  }, { label: 'B outbox drained after routing' });
  log('route', 'desktop routed the item into project «Сад и огород» (Дача)');

  // --- 4. Phone shows the readable result card --------------------------------
  await pageA.evaluate(() => window.atlasSync.syncNow());
  await pageA.click('#navInbox');
  await waitFor(async () => {
    return await pageA.evaluate(() => {
      const title = document.querySelector('.inbox-result-title');
      return title && title.textContent === 'Починить калитку';
    });
  }, { timeout: 45000, label: 'A renders the routed result card' });

  const card = await pageA.evaluate(() => ({
    title: document.querySelector('.inbox-result-title')?.textContent,
    lines: [...document.querySelectorAll('.inbox-result-line')].map(node => node.textContent),
    done: document.querySelector('.inbox-result-done')?.textContent || null,
    badge: document.querySelector('.inbox-row-status')?.textContent,
    tasks: window.state.tasks.length,
    projections: window.state.taskProjections.length,
  }));
  assert(card.title === 'Починить калитку', `result title mismatch: ${card.title}`);
  assert(card.lines.some(line => line.includes('Сад и огород') && line.includes('Дача')), `location line missing: ${JSON.stringify(card.lines)}`);
  assert(card.lines.some(line => line.includes('Высокий') && line.includes('24 августа')), `priority/due line missing: ${JSON.stringify(card.lines)}`);
  assert(card.badge === '✓ Разобрана', `badge mismatch: ${card.badge}`);
  assert(card.tasks === 0, 'phone must not hold a Task copy (no Task CRUD replication)');
  assert(card.projections === 1, 'phone holds exactly one projection');
  log('result-card', 'phone renders: ✓ Разобрана · Починить калитку · Сад и огород · Дача · Высокий · 24 августа');

  // --- 5. Desktop edits the Task → phone follows -------------------------------
  await pageB.evaluate(async () => {
    const { updateTask } = await import('/js/core/commands.js');
    const task = window.state.tasks.find(t => t.sourceInboxId);
    updateTask(task.id, { title: 'Починить калитку до выходных', status: 'done' });
    window.atlasSync.requestSync();
  });
  await waitFor(async () => {
    const s = await pageB.evaluate(() => window.atlasSync.getStatus());
    return s.pending === 0 && !s.lastError;
  }, { label: 'B pushed the task update' });

  await pageA.evaluate(() => window.atlasSync.syncNow());
  await waitFor(async () => {
    return await pageA.evaluate(() => {
      const title = document.querySelector('.inbox-result-title');
      const done = document.querySelector('.inbox-result-done');
      return title && title.textContent === 'Починить калитку до выходных' && done && done.textContent === '✓ Выполнено';
    });
  }, { timeout: 45000, label: 'A follows the task update' });
  log('update-follows', 'phone shows the renamed, completed Task');

  // --- 6. Desktop deletes the Task → phone shows the defined fallback ----------
  await pageB.evaluate(async () => {
    const { deleteTask } = await import('/js/core/commands.js');
    const task = window.state.tasks.find(t => t.sourceInboxId);
    deleteTask(task.id);
    window.atlasSync.requestSync();
  });
  await waitFor(async () => {
    const s = await pageB.evaluate(() => window.atlasSync.getStatus());
    return s.pending === 0 && !s.lastError;
  }, { label: 'B pushed the task deletion' });

  await pageA.evaluate(() => window.atlasSync.syncNow());
  await waitFor(async () => {
    return await pageA.evaluate(() => {
      const missing = document.querySelector('.inbox-result-missing');
      return missing && missing.textContent === 'Результат недоступен на этом устройстве';
    });
  }, { timeout: 45000, label: 'A shows the fallback after deletion' });
  log('delete-follows', 'phone shows the honest fallback after task deletion');

  // --- 7. No page errors, no duplicate inbox items -----------------------------
  const stateA = await pageA.evaluate(() => ({
    inbox: window.state.inbox.length,
    projections: window.state.taskProjections.length,
    tasks: window.state.tasks.length,
  }));
  assert(stateA.inbox === 1, `phone inbox must stay 1 item: ${stateA.inbox}`);
  assert(stateA.tasks === 0 && stateA.projections === 0, 'phone holds no task copy and no stale projection');
  const fatal = pageErrors.filter(message => !message.includes('favicon'));
  assert(fatal.length === 0, `page errors: ${fatal.join(' | ')}`);
  log('clean', 'no duplicates, no task copies, no page errors');

  console.log('\n✅ C2 two-browser smoke passed: routed result visible on the phone, follows updates/deletes.');
} catch (error) {
  failure = error;
  console.error('\n❌ C2 two-browser smoke failed:', error.message);
} finally {
  if (browserA) await browserA.close().catch(() => {});
  if (browserB) await browserB.close().catch(() => {});
  await closeAll(staticEntry, syncEntry);
  if (existsSync(DB_PATH)) rmSync(DB_PATH, { force: true });
}

process.exit(failure ? 1 : 0);
