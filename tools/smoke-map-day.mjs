import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { startStaticServer, closeAll } from './smoke-shared.mjs';

const server = await startStaticServer();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(8000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const out = 'output/map-day';
mkdirSync(out, { recursive: true });
const map = () => page.locator('.chip[data-view=map]').click();
const row = title => page.locator('#mapDay .map-day-row').filter({ has: page.getByRole('button', { name: title, exact: true }) });
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('atlas_v2_data')));

try {
  await page.goto(server.origin);
  await page.locator('#mapDay').waitFor();
  assert.match(await page.locator('#mapDay').innerText(), /0 задач/);
  const { day, tomorrow } = await page.evaluate(async () => {
    const c = await import('/js/core/commands.js');
    const { localDay, shiftDay } = await import('/js/features/today/model.js');
    const day = localDay(), tomorrow = shiftDay(day, 1);
    c.createTask({ id: 'buy', title: 'Купить продукты', due: { date: day, time: '10:00' } });
    const home = c.createDomain({ title: 'Дом', color: '#73b6a8' });
    const repair = c.createProject({ title: 'Ремонт велосипеда', domainId: home.id });
    c.createTask({ id: 'part', title: 'Заменить крепление', projectId: repair.id });
    c.setProjectNextAction(repair.id, 'part');
    c.createTask({ id: 'receipt', title: 'Отправить квитанцию', domainId: home.id, due: { date: day, time: '17:00' }, plannedDay: tomorrow });
    const waiting = c.createProject({ title: 'Ремонт окна', domainId: home.id });
    c.createTask({ id: 'glass', title: 'Замерить стекло', projectId: waiting.id });
    c.setProjectNextAction(waiting.id, 'glass');
    c.reviewProject(waiting.id, { lifecycle:'paused', pauseReason:'Жду мастера' });
    await import('/js/view_map.js').then(m => { m.layoutMap(); m.fitAll(); });
    return { day, tomorrow };
  });
  assert.equal(await row('Замерить стекло').count(), 0);
  await row('Заменить крепление').getByRole('button', { name:'Заменить крепление', exact:true }).click();
  assert.match(await page.locator('#atlasNavigator').innerText(), /Ремонт велосипеда/);
  assert.match(await page.locator('#atlasNavigator').innerText(), /Следующий шаг проекта/);
  await page.screenshot({ path: out + '/suggested-step.png' });
  const buy = row('Купить продукты').getByRole('button', { name:'На сегодня', exact:true });
  await page.evaluate(async () => {
    const a = (await import('/js/storageAdapter.js')).default;
    window.originalSave = a.save;
    a.save = () => { throw Error('Запись временно недоступна'); };
  });
  await buy.click();
  assert.match(await page.locator('#mapDay [role=alert]').innerText(), /недоступна/);
  assert.equal((await saved()).tasks.find(t => t.id === 'buy').plannedDay ?? null, null);
  await page.evaluate(async () => { (await import('/js/storageAdapter.js')).default.save = window.originalSave; });
  await buy.click();
  const buying = page.locator('#viewToday .todo[data-id=buy]');
  assert.ok(await buying.getByRole('button', { name:'Купить продукты' }).evaluate(el => el === document.activeElement));
  await buying.getByRole('button', { name:'Выполнено', exact:true }).click();
  await page.reload(); await map();
  await page.locator('#mapReviewEntry button').click();
  assert.match(await page.locator('.review-events').innerText(), /Задача выполнена\s+Купить продукты/);
  await page.screenshot({ path: out + '/review-after-reload.png' });
  await page.getByRole('button', { name:'Закрыть', exact:true }).click();
  const conflict = row('Отправить квитанцию');
  assert.match(await conflict.innerText(), /сегодня.*завтра/is);
  assert.equal((await saved()).tasks.find(t => t.id === 'receipt').plannedDay, tomorrow);
  await conflict.getByRole('button', { name:/Перенести · завтра → сегодня/ }).click();
  await page.reload();
  const data = await saved();
  const receipt = data.tasks.find(t => t.id === 'receipt');
  assert.equal(receipt.plannedDay, day);
  assert.deepEqual(receipt.due, { date: day, time:'17:00' });
  assert.equal(data.tasks.find(t => t.id === 'buy').status, 'done');
  await map();
  await row('Заменить крепление').getByRole('button', { name:'На сегодня', exact:true }).click();
  await page.locator('#viewToday [data-id=part]').getByRole('button', { name:'В фокус', exact:true }).click();
  await map();
  assert.match(await page.locator('#mapDay').innerText(), /Фокус дня/);
  await page.setViewportSize({ width:1024, height:768 });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; window.mapApi.drawMap(); });
  await page.screenshot({ path: out + '/focus-light.png' });
  assert.ok(await page.locator('#mapDay').evaluate(el => el.scrollWidth <= el.clientWidth));
  const before = (await saved()).operationLog.length;
  await row('Заменить крепление').getByRole('button', { name:'Открыть в «Сегодня»' }).click();
  assert.equal((await saved()).operationLog.length, before);
  await page.evaluate(async () => {
    const c = await import('/js/core/commands.js');
    for (const id of ['one','two']) {
      c.createTask({ id, title:id, status:'today' });
      c.updateTask(id, { focus:true });
    }
  });
  await page.locator('#viewToday [data-id=receipt]').getByRole('button', { name:'В фокус', exact:true }).click();
  assert.match(await page.locator('#viewToday [role=alert]').innerText(), /Фокус дня заполнен/);
  assert.equal((await saved()).tasks.filter(task => task.focus && task.plannedDay === day).length, 3);
  assert.deepEqual(errors, []);
  console.log('PASS browser map day: map selection, failure/retry, Today focus, completion, review after reload, explicit tomorrow transfer and original deadline');
} finally { await browser.close(); await closeAll(server); }
