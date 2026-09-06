// 0.12.0-alpha.2 — Material Usability vertical slice.
// Real browser, fresh profile (demo data), loopback static + sync server.
// Verifies: edit text in Inspector, move context (project/domain/none),
// library search, "Без контекста" filter, and reload with the same material id
// and sourceInboxId.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startStaticServer, startSyncServer, makeAdminToken, pairDevice, waitFor } from './smoke-shared.mjs';

const server = await startStaticServer();
let browser;
let relay;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.origin);
  // Seed the old demo explicitly as a test fixture; real startup stays empty.
  await page.evaluate(async () => {
    const { initDemoData } = await import('/js/state.js');
    const { saveState } = await import('/js/storage.js');
    initDemoData(); saveState();
  });
  const token = makeAdminToken();
  relay = await startSyncServer({ token, allowedOrigins: [server.origin] });
  await pairDevice(page, relay.endpoint, token, 'Usability Studio');

  const knowledge = () => page.evaluate(async () => (await import('/js/state.js')).state.knowledge);

  // --- Thought: capture, route into a project, open the Inspector. ---
  await page.locator('#quickAdd').fill('Мысль про теплицу');
  await page.locator('#quickSubmit').click();
  await page.locator('#btnInbox').click();
  await page.locator('[data-queue-filter="review"]').click();
  await page.getByRole('button', { name: '💭 Мысль', exact: true }).click();
  await page.locator('.inbox-route select').nth(0).selectOption('d2');
  await page.locator('.inbox-route select').nth(1).selectOption('p3');
  await page.getByRole('button', { name: 'Сохранить как мысль', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть результат', exact: true }).click();
  await page.locator('#knowledgeText').waitFor();

  const [thought] = await knowledge();
  assert.equal(thought.kind, 'thought');
  assert.equal(thought.projectId, 'p3');

  // --- Edit text and move to another project, all from the Inspector. ---
  await page.locator('#knowledgeText').fill('Мысль про теплицу обновлена\nНовый текст');
  await page.locator('#knowledgeDomain').selectOption('d1');
  await page.locator('#knowledgeProject').selectOption('p1');
  await page.locator('#saveKnowledge').click();

  const editedThought = (await knowledge()).find(k => k.id === thought.id);
  assert.ok(editedThought, 'material keeps the same id after edit');
  assert.equal(editedThought.sourceInboxId, thought.sourceInboxId, 'sourceInboxId preserved');
  assert.equal(editedThought.projectId, 'p1', 'moved to project p1');
  assert.equal(editedThought.text, 'Мысль про теплицу обновлена\nНовый текст');

  // --- Library search finds the edited material. ---
  await page.locator('#btnKnowledge').click();
  await page.getByLabel('Поиск по мыслям и заметкам').fill('обновлена');
  await waitFor(async () => (await page.locator('#inspector [data-knowledge-id]').count()) === 1, { label: 'search finds one material' });
  await page.locator('#inspector [data-knowledge-id]').click();
  assert.match(await page.locator('#inspector').innerText(), /Мысль про теплицу обновлена/);

  // --- Reload: the same object with the same id persists. ---
  await page.reload();
  await page.locator('#btnKnowledge').click();
  const persisted = (await knowledge()).find(k => k.id === thought.id);
  assert.ok(persisted, 'material survives reload with the same id');
  assert.equal(persisted.text, 'Мысль про теплицу обновлена\nНовый текст');
  assert.equal(persisted.projectId, 'p1');

  // --- Note: create with no context, then move it to a domain in Inspector. ---
  await page.locator('#quickAdd').fill('Заметка для проверки');
  await page.locator('#quickSubmit').click();
  await page.locator('#btnInbox').click();
  await page.locator('[data-queue-filter="review"]').click();
  await page.getByRole('button', { name: '📝 Заметка', exact: true }).click();
  await page.locator('.inbox-route select').nth(0).selectOption('');
  await page.getByRole('button', { name: 'Сохранить как заметку', exact: true }).click();
  await page.getByRole('button', { name: 'Открыть результат', exact: true }).click();
  await page.locator('#knowledgeText').waitFor();
  const note = (await knowledge()).find(k => k.kind === 'note');
  assert.ok(note);
  assert.equal(note.projectId, null);
  assert.equal(note.domainId, null);
  await page.locator('#knowledgeDomain').selectOption('d1');
  await page.locator('#saveKnowledge').click();
  const noteMoved = (await knowledge()).find(k => k.id === note.id);
  assert.equal(noteMoved.id, note.id, 'note keeps the same id after move');
  assert.equal(noteMoved.domainId, 'd1', 'note moved to domain d1');

  // --- "Без контекста": move the thought there, then the filter shows it. ---
  await page.locator('#btnKnowledge').click();
  await page.getByLabel('Поиск по мыслям и заметкам').fill('обновлена');
  await waitFor(async () => (await page.locator('#inspector [data-knowledge-id]').count()) === 1, { label: 'search thought again' });
  await page.locator('#inspector [data-knowledge-id]').click();
  await page.locator('#knowledgeDomain').selectOption('');
  await page.locator('#saveKnowledge').click();
  await page.locator('#btnKnowledge').click();
  await page.getByRole('button', { name: 'Без контекста', exact: true }).click();
  await waitFor(async () => (await page.locator('#inspector [data-knowledge-id]').count()) === 1, { label: 'no-context filter shows one' });
  assert.match(await page.locator('#inspector').innerText(), /Без контекста · 1/);

  assert.deepEqual(errors, []);
  await page.screenshot({ path: 'output/playwright/knowledge-usability.png' });
  console.log('Browser PASS: edit text, move thought/note (project/domain/none), library search, Без контекста filter, reload with same id and sourceInboxId.');
} finally {
  await browser?.close();
  server.server.close();
  relay?.server.close();
}
