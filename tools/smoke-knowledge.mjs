// Isolated real-browser vertical slice. No user profile, storage or live relay.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startStaticServer, startSyncServer, makeAdminToken, pairDevice, waitFor } from './smoke-shared.mjs';

const server = await startStaticServer();
let browser;
let relay;
try {
  browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:1440, height:1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.origin);
  const token = makeAdminToken();
  relay = await startSyncServer({ token, allowedOrigins:[server.origin] });
  await pairDevice(page, relay.endpoint, token, 'Knowledge Studio');
  const phoneContext = await browser.newContext({ viewport:{ width:390, height:844 } });
  const phone = await phoneContext.newPage();
  phone.on('pageerror', error => errors.push(error.message));
  await phone.goto(`${server.origin}/capture/`);
  await pairDevice(phone, relay.endpoint, token, 'Knowledge Capture');
  const capture = async text => {
    await page.locator('#quickAdd').fill(text);
    await page.locator('#quickSubmit').click();
    await page.locator('#btnInbox').click();
    await page.locator('[data-queue-filter="review"]').click();
  };
  await capture('Идея: тенистая зона отдыха');
  await page.getByRole('button', { name:'💭 Мысль', exact:true }).click();
  await page.locator('.inbox-route select').nth(0).selectOption('d2');
  await page.locator('.inbox-route select').nth(1).selectOption('p3');
  await page.getByRole('button', { name:'Сохранить как мысль', exact:true }).click();
  assert.match(await page.locator('.inbox-result').innerText(), /Дача \/ Сад и огород/);
  await waitFor(async () => {
    await page.evaluate(() => window.atlasSync.syncNow());
    await phone.evaluate(() => window.atlasSync.syncNow());
    return phone.evaluate(async () => (await import('/js/state.js')).state.inbox[0]?.resultRef?.type === 'knowledge');
  }, { label:'knowledge receipt over HTTP' });
  await phone.locator('#navInbox').click();
  assert.match(await phone.locator('#inboxList').innerText(), /Сохранено в Studio/);
  await phone.screenshot({ path:'output/playwright/knowledge-phone-receipt.png' });
  await page.screenshot({ path:'output/playwright/knowledge-result.png' });
  await page.getByRole('button', { name:'Открыть результат', exact:true }).click();
  assert.match(await page.locator('#inspector').innerText(), /Мысль/);
  await page.locator('#materialContext').click();
  assert.equal(await page.locator('#inspector [data-knowledge-id]').count(), 1);
  await page.locator('#inspector [data-knowledge-id]').click();
  await page.screenshot({ path:'output/playwright/knowledge-inspector.png' });
  // Persistence and rediscovery without returning to the processed Inbox.
  await page.reload();
  await page.locator('#btnKnowledge').click();
  await page.locator('#inspector [data-knowledge-id]').click();
  await page.locator('#materialRevert').click();
  await page.getByRole('button', { name:'Сохранить как мысль', exact:true }).waitFor();
  assert.equal(await page.evaluate(async () => (await import('/js/state.js')).state.knowledge.length), 0);
  await waitFor(async () => {
    await page.evaluate(() => window.atlasSync.syncNow());
    await phone.evaluate(() => window.atlasSync.syncNow());
    return phone.evaluate(async () => !(await import('/js/state.js')).state.inbox[0]?.resultRef);
  }, { label:'knowledge revert receipt over HTTP' });
  // Same source can be routed again as a Note, including no context.
  await page.getByRole('button', { name:'📝 Заметка', exact:true }).click();
  await page.locator('.inbox-route select').nth(0).selectOption('');
  await page.getByRole('button', { name:'Сохранить как заметку', exact:true }).click();
  assert.match(await page.locator('.inbox-result').innerText(), /Без контекста/);
  await page.getByRole('button', { name:'Открыть результат', exact:true }).click();
  assert.match(await page.locator('#inspector').innerText(), /Заметка/);
  await page.locator('#materialRevert').click();
  await page.getByRole('button', { name:'Сохранить как заметку', exact:true }).waitFor();
  // Domain-only destination, then Processing's own revert button.
  await page.locator('.inbox-route select').nth(0).selectOption('d1');
  await page.locator('.inbox-route select').nth(1).selectOption('');
  await page.getByRole('button', { name:'Сохранить как заметку', exact:true }).click();
  await page.getByRole('button', { name:'Вернуть в разбор', exact:true }).click();
  await page.getByRole('button', { name:'✓ Задача', exact:true }).click();
  await page.locator('.inbox-route select').nth(0).selectOption('d2');
  await page.locator('.inbox-route select').nth(1).selectOption('p2');
  await page.getByRole('button', { name:'Создать задачу', exact:true }).click();
  await page.locator('[data-queue-filter="done"]').click();
  await page.getByRole('button', { name:'Открыть задачу', exact:true }).click();
  assert.match(await page.locator('#inspector').innerText(), /Идея: тенистая зона отдыха/);
  const links = await page.evaluate(async () => {
    const { state } = await import('/js/state.js');
    const item = state.inbox[0];
    return { type:item.resultRef.type, source:state.tasks.find(t => t.id === item.resultRef.id)?.sourceInboxId, id:item.id, raw:item.rawText };
  });
  assert.equal(links.type, 'task');
  assert.equal(links.source, links.id);
  assert.equal(links.raw, 'Идея: тенистая зона отдыха');
  assert.deepEqual(errors, []);
  console.log('Browser PASS: capture, Thought/project, open/context/map, reload/library, revert, Note/no context/domain, Processing revert, Task route/open, original source, HTTP receipt and revert on Capture.');
} finally {
  await browser?.close();
  server.server.close();
  relay?.server.close();
}
