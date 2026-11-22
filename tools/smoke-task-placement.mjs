import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { startStaticServer, closeAll } from './smoke-shared.mjs';

const server = await startStaticServer();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(8000);
const out = 'output/task-placement';
mkdirSync(out, { recursive: true });
const nav = page.locator('#atlasNavigator');
const inspector = page.locator('#inspector');
const receipt = inspector.locator('.task-move-receipt');
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('atlas_v2_data')));
const title = 'Купить крепёж М4';
const updatedTitle = 'Заказать крепёж М4';

async function action(name) {
  await nav.getByText('Действия', { exact: true }).click();
  await nav.getByRole('button', { name, exact: true }).click();
}

async function move(sphere, project) {
  await action('Перенести задачу');
  const sphereField = inspector.getByLabel('Сфера', { exact: true });
  assert.equal(await sphereField.evaluate(element => document.activeElement === element), true);
  const save = inspector.getByRole('button', { name: 'Сохранить место', exact: true });
  assert.equal(await save.isEnabled(), false);
  await sphereField.selectOption({ label: sphere });
  await inspector.getByLabel('Проект', { exact: true }).selectOption({ label: project });
  await save.click();
  await receipt.waitFor();
}

try {
  await page.goto(server.origin);
  const ids = await page.evaluate(async taskTitle => {
    const c = await import('/js/core/commands.js');
    const { localDay } = await import('/js/features/today/model.js');
    const home = c.createDomain({ title: 'Дом' });
    const workshop = c.createDomain({ title: 'Мастерская', color: '#60a5fa' });
    const hatch = c.createProject({ title: 'Скрытый люк', domainId: home.id });
    const assembly = c.createProject({ title: 'Сборка', domainId: workshop.id });
    const [source] = c.captureInbox(taskTitle, { itemType: 'task' });
    const { task } = c.routeInboxToTask(source.id, { projectId: hatch.id, due: { date: '2030-04-06', time: '17:00' } });
    c.updateTask(task.id, { plannedDay: localDay() });
    window.mapApi.openTask(task.id);
    return { home: home.id, workshop: workshop.id, from: hatch.id, to: assembly.id, task: task.id, source: source.id };
  }, title);
  const task = async () => (await saved()).tasks.find(item => item.id === ids.task);
  const before = await task();
  await move('Мастерская', 'Сборка');
  assert.match(await receipt.innerText(), /Было\s+Дом → Скрытый люк\s+Стало\s+Мастерская → Сборка/);
  assert.equal((await task()).projectId, ids.to);
  const moveOperation = (await saved()).operationLog.findLast(operation => operation.type === 'task.move');
  assert.equal(moveOperation.payload.from.domainId, ids.home);
  assert.equal(moveOperation.payload.to.domainId, ids.workshop);
  await page.screenshot({ path: `${out}/desktop.png` });

  await action('Править задачу');
  await inspector.getByLabel('Название', { exact: true }).fill(updatedTitle);
  await inspector.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
  assert.equal((await task()).title, updatedTitle);
  await page.evaluate(async () => {
    const adapter = (await import('/js/storageAdapter.js')).default;
    window.placementSave = adapter.save;
    adapter.save = () => { throw Error('Не удалось записать Atlas'); };
  });
  await receipt.getByRole('button', { name: 'Отменить', exact: true }).click();
  assert.match(await receipt.getByRole('alert').innerText(), /Не удалось записать Atlas/);
  assert.equal((await task()).projectId, ids.to);
  await page.evaluate(async () => { (await import('/js/storageAdapter.js')).default.save = window.placementSave; });
  await receipt.getByRole('button', { name: 'Отменить', exact: true }).click();
  assert.match(await inspector.locator('#taskMoveMessage').innerText(), /Перенос отменён/);
  assert.equal((await task()).projectId, ids.from);
  assert.equal((await task()).title, updatedTitle);
  assert.equal((await saved()).operationLog.findLast(operation => operation.type === 'task.move.undo').payload.sourceOperationId, moveOperation.id);

  await page.reload();
  await nav.getByRole('button', { name: 'Продолжить работу' }).click();
  assert.match(await nav.locator('.atlas-path').innerText(), /Дом.*Скрытый люк/s);
  assert.equal((await task()).projectId, ids.from);
  await page.setViewportSize({ width: 390, height: 830 });
  await move('Мастерская', 'Сборка');
  await page.screenshot({ path: `${out}/narrow.png` });
  await receipt.getByRole('button', { name: 'Отменить', exact: true }).press('Control+z');
  assert.equal((await task()).projectId, ids.from);
  await page.getByRole('button', { name: 'Закрыть детали', exact: true }).click();
  await move('Мастерская', 'Сборка');
  await page.reload();
  await nav.getByRole('button', { name: 'Продолжить работу' }).click();
  assert.match(await nav.locator('.atlas-path').innerText(), /Мастерская.*Сборка/s);
  assert.equal((await task()).projectId, ids.to);
  assert.deepEqual((await task()).due, before.due);
  assert.equal((await task()).plannedDay, before.plannedDay);
  assert.equal((await saved()).inbox.find(item => item.id === ids.source).resultRef.id, ids.task);

  await nav.locator('[data-action=project]').click();
  await action('Переименовать проект');
  await inspector.getByLabel('Название проекта').fill('Сборка люка');
  await inspector.getByRole('button', { name: 'Сохранить название', exact: true }).click();
  assert.equal((await saved()).projects.find(item => item.id === ids.to).title, 'Сборка люка');
  await page.getByRole('button', { name: 'Закрыть детали', exact: true }).click();
  await action('Перенести проект');
  assert.equal(await inspector.getByLabel('Перенести проект в сферу').inputValue(), ids.workshop);
  await page.getByRole('button', { name: 'Закрыть детали', exact: true }).click();
  page.once('dialog', dialog => dialog.accept('Временная задача'));
  await nav.getByRole('button', { name: '+ Задача', exact: true }).click();
  const temporary = (await saved()).tasks.find(item => item.title === 'Временная задача').id;
  page.once('dialog', dialog => dialog.dismiss());
  await action('Удалить задачу…');
  assert.ok((await saved()).tasks.some(item => item.id === temporary));
  await page.getByRole('button', { name: 'Закрыть детали', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await action('Удалить задачу…');
  assert.ok(!(await saved()).tasks.some(item => item.id === temporary));
  assert.equal(await page.evaluate(taskId => window.mapApi.getNodes().some(node => node.id === taskId), temporary), false);
  assert.deepEqual(errors, []);
  console.log('PASS task placement: receipt, Undo button, Ctrl+Z, retry, both reload states, task edit/delete and project rename from the map');
} catch (error) {
  await page.screenshot({ path: `${out}/error.png` });
  throw error;
} finally {
  await browser.close();
  await closeAll(server);
}
