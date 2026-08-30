// tools/smoke-c3.mjs — Stage C3 two-browser live smoke: conflicts & recovery.
//
// Chromium (phone, Capture PWA) and Firefox (desktop, Atlas Studio), separate
// storage, real HTTP sync service:
//
//   phone captures → desktop processes → phone deletes its local copy
//   (W2) → the desktop's earlier update arrives at the phone as a
//   deleted_race conflict → the phone shows it in the Sync panel → the user
//   chooses «Восстановить и применить» → the record comes back (processed)
//   and the restore propagates back to the desktop → both sides converge.
//
// Also proves sync deletion: the desktop's record disappears when the phone
// deletes it.
//
// Usage: node tools/smoke-c3.mjs
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

const DB_PATH = join(ROOT, 'output', '.smoke-c3.sqlite');
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

  await pageA.goto(`${staticEntry.origin}/capture/`, { waitUntil: 'domcontentloaded' });
  await pageA.waitForSelector('#btnSave', { timeout: 15000 });
  await pageB.goto(`${staticEntry.origin}/`, { waitUntil: 'domcontentloaded' });
  await pageB.waitForSelector('#btnInbox', { timeout: 15000 });
  log('open', 'capture PWA (Chromium) + Studio (Firefox) loaded');

  await pairDevice(pageA, syncEntry.endpoint, ADMIN_TOKEN, 'Smoke Phone A');
  await pairDevice(pageB, syncEntry.endpoint, ADMIN_TOKEN, 'Smoke Desktop B');
  log('pair', 'both devices paired');

  // --- 1. Phone captures, desktop processes --------------------------------
  await pageA.fill('#captureText', 'Конфликтная запись');
  await pageA.click('#btnSave');
  await waitFor(async () => {
    const s = await pageA.evaluate(() => window.atlasSync.getStatus());
    return s.pending === 0 && !s.lastError;
  }, { label: 'A outbox drained after capture' });
  log('capture', 'phone captured');

  await waitFor(async () => {
    return await pageB.evaluate(() => window.state?.inbox?.length === 1);
  }, { timeout: 45000, label: 'B received the capture' });

  // Desktop processes it and pushes BEFORE the phone deletes — server order:
  // update (seq k) < delete (seq k+1), so the phone gets the update while its
  // record is already gone → deleted_race.
  await pageB.evaluate(async () => {
    const { updateInbox } = await import('/js/core/commands.js');
    updateInbox(window.state.inbox[0].id, { status: 'processed', itemType: 'thought' });
    window.atlasSync.requestSync();
  });
  await waitFor(async () => {
    const s = await pageB.evaluate(() => window.atlasSync.getStatus());
    return s.pending === 0 && !s.lastError;
  }, { label: 'B pushed the processed update' });
  log('process', 'desktop processed the item');

  // --- 2. Phone deletes its local copy via the real UI (W2) ------------------
  await pageA.click('#navInbox');
  await waitFor(async () => {
    return await pageA.evaluate(() => document.querySelectorAll('.inbox-delete-btn').length === 1);
  }, { label: 'A shows the inbox row with delete button' });
  await pageA.click('.inbox-delete-btn');
  await waitFor(async () => {
    return await pageA.evaluate(() => window.state?.inbox?.length === 0);
  }, { label: 'A removed the record locally' });
  await waitFor(async () => {
    const s = await pageA.evaluate(() => window.atlasSync.getStatus());
    return s.pending === 0 && !s.lastError;
  }, { label: 'A pushed the delete' });
  log('delete', 'phone deleted the record; the desktop will classify the raced delete (W2)');

  // B had already processed the record (newer version) → the delete is a
  // delete_restore_race on B. The user keeps the processed record.
  await pageB.evaluate(() => window.atlasSync.syncNow());
  await waitFor(async () => {
    return await pageB.evaluate(() => window.atlasSync.getStatus().conflicts === 1);
  }, { timeout: 45000, label: 'B quarantined the raced delete (act 1)' });
  await pageB.click('.atlas-sync-badge');
  await waitFor(async () => {
    return await pageB.evaluate(() => {
      const buttons = [...document.querySelectorAll('.atlas-sync-conflict-actions .atlas-sync-btn')];
      return buttons.some(button => button.textContent === 'Оставить запись');
    });
  }, { label: 'B panel offers «Оставить запись» for the raced delete' });
  await pageB.evaluate(() => {
    const button = [...document.querySelectorAll('.atlas-sync-conflict-actions .atlas-sync-btn')]
      .find(el => el.textContent === 'Оставить запись');
    button.click();
  });
  await waitFor(async () => {
    return await pageB.evaluate(() => window.atlasSync.getStatus().conflicts === 0);
  }, { label: 'B resolved the raced delete (kept the processed record)' });
  log('keep-record', 'desktop kept its processed record (delete_restore_race resolved)');

  // --- 3. The desktop's earlier update hits the phone as deleted_race ---------
  await pageA.evaluate(() => window.atlasSync.syncNow());
  await waitFor(async () => {
    return await pageA.evaluate(() => window.atlasSync.getStatus().conflicts === 1);
  }, { timeout: 45000, label: 'A quarantined the update as a conflict' });
  log('conflict', 'phone detected deleted_race (update for deleted record)');

  // --- 4. The phone user resolves it in the Sync panel -------------------------
  await pageA.click('#navInbox'); // back to inbox: the record is gone
  await pageA.click('#btnInfo');  // sync panel lives in the info view
  await waitFor(async () => {
    return await pageA.evaluate(() => {
      const buttons = [...document.querySelectorAll('.atlas-sync-conflict-actions .atlas-sync-btn')];
      return buttons.some(button => button.textContent === 'Восстановить и применить');
    });
  }, { label: 'A sync panel shows the resolution actions' });
  log('panel', 'phone panel offers «Восстановить и применить»');

  await pageA.evaluate(() => {
    const button = [...document.querySelectorAll('.atlas-sync-conflict-actions .atlas-sync-btn')]
      .find(el => el.textContent === 'Восстановить и применить');
    button.click();
  });
  await waitFor(async () => {
    return await pageA.evaluate(() => window.atlasSync.getStatus().conflicts === 0);
  }, { label: 'A resolved the conflict' });
  log('resolve', 'phone restored the record and applied the remote state');

  const restored = await pageA.evaluate(() => ({
    inbox: window.state.inbox.length,
    status: window.state.inbox[0]?.status,
    rawText: window.state.inbox[0]?.rawText,
  }));
  assert(restored.inbox === 1 && restored.status === 'processed' && restored.rawText === 'Конфликтная запись',
    `restore_apply result mismatch: ${JSON.stringify(restored)}`);
  log('restored', 'phone shows the restored, processed record');

  // --- 5. The restoration converges back to the desktop -------------------------
  await waitFor(async () => {
    const s = await pageA.evaluate(() => window.atlasSync.getStatus());
    return s.pending === 0;
  }, { label: 'A pushed the restore' });
  await pageB.evaluate(() => window.atlasSync.syncNow());
  await waitFor(async () => {
    return await pageB.evaluate(() => window.state?.inbox?.length === 1);
  }, { timeout: 45000, label: 'B converged (record restored from the phone)' });
  const bState = await pageB.evaluate(() => ({
    inbox: window.state.inbox.length,
    status: window.state.inbox[0]?.status,
  }));
  assert(bState.inbox === 1 && bState.status === 'processed', `B divergence: ${JSON.stringify(bState)}`);
  log('converged', 'both devices agree on the restored processed record');

  // --- 6. Hygiene -----------------------------------------------------------------
  const aState = await pageA.evaluate(() => ({
    inbox: window.state.inbox.length,
    conflicts: window.atlasSync.getStatus().conflicts,
  }));
  assert(aState.inbox === 1 && aState.conflicts === 0, `A hygiene mismatch: ${JSON.stringify(aState)}`);
  const fatal = pageErrors.filter(message => !message.includes('favicon'));
  assert(fatal.length === 0, `page errors: ${fatal.join(' | ')}`);
  log('clean', 'no duplicates, no lingering conflicts, no page errors');

  // === Act 2 (review): delete ↔ restore race — the OTHER delivery order ======
  // A captures, B edits the record (newer version), A deletes (older base) →
  // B receives the raced delete → delete_restore_race on B → user picks
  // «Удалить» → both sides converge (record gone everywhere).
  log('act2', 'second scenario: delete vs newer local version');

  await pageA.click('#navCapture');
  await pageA.waitForSelector('#captureText:visible', { timeout: 15000 });
  await pageA.fill('#captureText', 'Гонка версий');
  await pageA.click('#btnSave');
  await waitFor(async () => {
    const s = await pageA.evaluate(() => window.atlasSync.getStatus());
    return s.pending === 0 && !s.lastError;
  }, { label: 'A pushed the second capture' });

  await waitFor(async () => {
    return await pageB.evaluate(() => window.state?.inbox?.length === 2);
  }, { timeout: 45000, label: 'B received the second capture' });

  // B edits the record → updatedAt moves ahead (v2)
  await pageB.evaluate(async () => {
    const { updateInbox } = await import('/js/core/commands.js');
    const item = window.state.inbox.find(entry => entry.rawText === 'Гонка версий');
    updateInbox(item.id, { status: 'reviewed' });
    window.atlasSync.requestSync();
  });
  await waitFor(async () => {
    const s = await pageB.evaluate(() => window.atlasSync.getStatus());
    return s.pending === 0 && !s.lastError;
  }, { label: 'B pushed the edit (v2)' });

  // A deletes based on its OLDER version (v1)
  await pageA.click('#navInbox');
  await waitFor(async () => {
    return await pageA.evaluate(() => document.querySelectorAll('.inbox-delete-btn').length === 2);
  }, { label: 'A shows both rows' });
  await pageA.evaluate(() => {
    // delete the row whose text is «Гонка версий» — the delete buttons are in
    // row order; the newest record is first in the list.
    document.querySelectorAll('.inbox-row').forEach(row => {
      if (row.querySelector('.inbox-row-text')?.textContent === 'Гонка версий') {
        row.querySelector('.inbox-delete-btn').click();
      }
    });
  });
  await waitFor(async () => {
    const s = await pageA.evaluate(() => window.atlasSync.getStatus());
    return s.pending === 0 && !s.lastError;
  }, { label: 'A pushed the delete (baseVersion v1)' });

  // B receives the raced delete → delete_restore_race (record is v2 locally)
  await pageB.evaluate(() => window.atlasSync.syncNow());
  try {
    await waitFor(async () => {
      return await pageB.evaluate(() => window.atlasSync.getStatus().conflicts === 1);
    }, { timeout: 45000, label: 'B quarantined the raced delete' });
  } catch (error) {
    const diag = await pageB.evaluate(() => ({
      status: window.atlasSync.getStatus(),
      conflicts: window.atlasSync.getConflicts().map(c => ({ id: c.operation?.id, type: c.operation?.type, entity: c.operation?.entityId, baseVersion: c.operation?.baseVersion, status: c.conflictStatus, resolution: c.resolution, seq: c.serverSequence })),
      inbox: window.state.inbox.map(i => ({ id: i.id, status: i.status, updatedAt: i.updatedAt })),
    }));
    console.error('B diagnostics:', JSON.stringify(diag, null, 2));
    throw error;
  }
  log('race', 'B detected delete_restore_race (delete based on older version)');

  // B resolves with «Удалить» → convergence (both sides deleted)
  await pageB.evaluate(() => {
    const button = [...document.querySelectorAll('.atlas-sync-conflict-actions .atlas-sync-btn')]
      .find(el => el.textContent === 'Удалить');
    if (button) button.click();
  });
  await waitFor(async () => {
    return await pageB.evaluate(() => window.atlasSync.getStatus().conflicts === 0);
  }, { label: 'B resolved the delete race' });
  await waitFor(async () => {
    return await pageB.evaluate(() => window.state?.inbox?.length === 1);
  }, { label: 'B removed the raced record' });

  // A receives B's earlier edit → deleted_race (A deleted locally) → keep_deleted
  await pageA.evaluate(() => window.atlasSync.syncNow());
  await waitFor(async () => {
    return await pageA.evaluate(() => window.atlasSync.getStatus().conflicts === 1);
  }, { timeout: 45000, label: 'A quarantined the edit for its deleted record' });
  await pageA.click('#btnInfo');
  await pageA.evaluate(() => {
    const button = [...document.querySelectorAll('.atlas-sync-conflict-actions .atlas-sync-btn')]
      .find(el => el.textContent === 'Оставить удалённой');
    if (button) button.click();
  });
  await waitFor(async () => {
    return await pageA.evaluate(() => window.atlasSync.getStatus().conflicts === 0);
  }, { label: 'A resolved its deleted_race' });

  const finalA = await pageA.evaluate(() => ({
    inbox: window.state.inbox.length,
    conflicts: window.atlasSync.getStatus().conflicts,
    pending: window.atlasSync.getStatus().pending,
  }));
  const finalB = await pageB.evaluate(() => ({
    inbox: window.state.inbox.length,
    conflicts: window.atlasSync.getStatus().conflicts,
  }));
  assert(finalA.inbox === 1 && finalA.conflicts === 0 && finalA.pending === 0, `A final mismatch: ${JSON.stringify(finalA)}`);
  assert(finalB.inbox === 1 && finalB.conflicts === 0, `B final mismatch: ${JSON.stringify(finalB)}`);
  const fatal2 = pageErrors.filter(message => !message.includes('favicon'));
  assert(fatal2.length === 0, `page errors (act 2): ${fatal2.join(' | ')}`);
  log('act2-done', 'delete_restore_race resolved; both devices converged without duplicates');

  console.log('\n✅ C3 two-browser smoke passed: delete sync + deleted_race + delete_restore_race + convergence.');
} catch (error) {
  failure = error;
  console.error('\n❌ C3 two-browser smoke failed:', error.message);
} finally {
  if (browserA) await browserA.close().catch(() => {});
  if (browserB) await browserB.close().catch(() => {});
  try { await closeAll(staticEntry, syncEntry); } catch (_) {}
  if (existsSync(DB_PATH)) rmSync(DB_PATH, { force: true });
}

process.exit(failure ? 1 : 0);
