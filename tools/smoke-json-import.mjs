import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { closeAll, startStaticServer } from './smoke-shared.mjs';

const server = await startStaticServer();
const browser = await chromium.launch();
const context = await browser.newContext({ viewport:{ width:1440, height:900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const out = 'output/json-import';
await mkdir(out, { recursive:true });
const more = page.locator('.header-popover-secondary summary');
const replacement = page.getByRole('dialog');
const confirm = replacement.getByRole('button', { name:'Заменить данные', exact:true });
const cancel = replacement.getByRole('button', { name:'Отмена', exact:true });
const readStorage = () => page.evaluate(() => [
  localStorage.getItem('atlas_v2_data'), localStorage.getItem('atlas_v2_recovery_original'),
]);
const file = {
  name:'переезд.json', mimeType:'application/json',
  buffer:Buffer.from(JSON.stringify({
    schema:13, domains:[{ id:'move', title:'Переезд' }],
    projects:[{ id:'boxes', domainId:'move', title:'Упаковать вещи' }],
    tasks:[{ id:'labels', projectId:'boxes', title:'Подписать коробки' }],
  })),
};

try {
  await page.goto(server.origin);
  await page.evaluate(async () => {
    const core = await import('/js/core/commands.js');
    const domain = core.createDomain({ title:'Дом' });
    const project = core.createProject({ title:'Скрытый люк', domainId:domain.id });
    const [source] = core.captureInbox('Купить петли', { itemType:'task' });
    core.routeInboxToTask(source.id, { projectId:project.id });
    const [material] = core.captureInbox('Размер петли 34 мм', { itemType:'note' });
    core.routeInboxToKnowledge(material.id, { projectId:project.id });
  });
  const original = await readStorage();
  await page.screenshot({ path:`${out}/map-before-import.png` });
  await more.click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name:'Импорт JSON', exact:true }).press('Enter');
  await (await chooser).setFiles(file);
  await replacement.getByRole('table').waitFor();
  assert.match(await replacement.innerText(), /переезд\.json[\s\S]*Сферы в снимке: Переезд/);
  assert.deepEqual(await replacement.getByRole('row', { name:/Материалы/ }).getByRole('cell').allTextContents(), ['1','0']);
  assert.ok(await cancel.evaluate(el => el === document.activeElement));
  await page.screenshot({ path:`${out}/desktop-preview.png` });
  await cancel.press('Escape');
  await replacement.waitFor({ state:'detached' });
  await page.reload();
  assert.deepEqual(await readStorage(), original);

  await page.setViewportSize({ width:390, height:844 });
  await page.locator('#fileImport').setInputFiles(file);
  await confirm.waitFor();
  await replacement.getByRole('table').waitFor();
  assert.ok(await replacement.evaluate(el => el.scrollWidth <= el.clientWidth));
  await page.screenshot({ path:`${out}/narrow-preview.png` });
  const other = await context.newPage();
  await other.goto(server.origin);
  await other.evaluate(async () => (await import('/js/core/commands.js')).createTask({ title:'Запись из соседней вкладки' }));
  const updated = await readStorage();
  await confirm.click();
  assert.match(await replacement.getByRole('alert').innerText(), /Данные Atlas изменились/);
  assert.deepEqual(await readStorage(), updated);
  await cancel.click();
  await other.close();

  await page.reload();
  await page.locator('#fileImport').setInputFiles(file);
  await page.evaluate(() => {
    const originalWrite = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'atlas_v2_recovery_original') throw new Error('Тестовый сбой записи копии');
      return originalWrite.call(this, key, value);
    };
    window.restoreStorageWrite = () => { Storage.prototype.setItem = originalWrite; };
  });
  await confirm.click();
  assert.match(await replacement.getByRole('alert').innerText(), /Замена не выполнена/);
  assert.deepEqual(await readStorage(), updated);
  await page.evaluate(() => window.restoreStorageWrite());
  await confirm.click();
  await replacement.waitFor({ state:'detached' });
  await page.waitForFunction(() => window.state?.tasks.some(task => task.id === 'labels'));
  assert.equal((await readStorage())[1], updated[0]);
  await page.evaluate(async () => (await import('/js/core/commands.js')).createTask({ title:'Дело уже после импорта' }));
  await page.reload();
  assert.equal((await readStorage())[1], updated[0]);

  await page.getByRole('button', { name:'Настройки', exact:true }).click();
  await more.click();
  await page.getByRole('button', { name:'Резервные данные', exact:true }).click();
  await page.getByRole('button', { name:'Вернуть данные до замены', exact:true }).click();
  await replacement.getByRole('table').waitFor();
  assert.match(await replacement.innerText(), /Сферы в снимке: Дом/);
  await page.screenshot({ path:`${out}/restore-after-reload.png` });
  await replacement.getByRole('button', { name:'Восстановить данные', exact:true }).click();
  await replacement.waitFor({ state:'detached' });
  await page.reload();
  const [current, recovery] = (await readStorage()).map(JSON.parse);
  assert.equal(current.tasks[0].title, 'Купить петли');
  assert.equal(current.tasks[1].title, 'Запись из соседней вкладки');
  assert.equal(current.inbox[0].rawText, 'Купить петли');
  assert.equal(current.tasks[0].sourceInboxId, current.inbox[0].id);
  assert.equal(current.knowledge[0].projectId, current.projects[0].id);
  assert.equal(current.operationLog.at(-1).type, 'state.restore');
  assert.ok(recovery.tasks.some(task => task.id === 'labels'));
  assert.deepEqual(errors, []);
  console.log('PASS JSON import: native picker, preview, cancel and reload, stale tab, backup write failure and retry, durable replacement and restore');
} finally {
  await browser.close();
  await closeAll(server);
}
