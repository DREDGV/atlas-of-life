import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { closeAll, startStaticServer } from './smoke-shared.mjs';

const server = await startStaticServer();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport:{ width:1440, height:900 }, reducedMotion:'reduce' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const out = 'output/domain-signals';
await mkdir(out, { recursive:true });
const signals = page.getByRole('region', { name:'Сигналы на карте' });
const home = () => signals.getByRole('button', { name:/^Дом\./ });
const health = () => signals.getByRole('button', { name:/^Здоровье\./ });
const shop = () => signals.getByRole('button', { name:/^Мастерская\./ });
const inspector = page.locator('#inspector');
const overview = page.locator('#atlasNavigator [data-action=overview]');
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('atlas_v2_data')));
const settle = async () => {
  await page.waitForTimeout(280); // camera animation moves the DOM anchors with the canvas
};

try {
  await page.goto(server.origin);
  await page.evaluate(async () => {
    const core = await import('/js/core/commands.js');
    const { localDay, shiftDay } = await import('/js/features/today/model.js');
    const old = Date.now() - 15 * 86400000;
    const home = core.createDomain({ title:'Дом', color:'#2dd4bf' }, { now:old });
    const health = core.createDomain({ title:'Здоровье', color:'#c084fc' }, { now:old });
    const shop = core.createDomain({ title:'Мастерская', color:'#60a5fa' });
    core.createDomain({ title:'Отдых', color:'#f59e0b' });
    core.saveDomainAttention(home.id, { reviewEveryDays:7 }, { now:old });
    core.saveDomainAttention(health.id, { intention:'Ходить пешком', reviewEveryDays:7 }, { now:old });
    core.createTask({ title:'Оплатить счёт', domainId:home.id, due:{ date:shiftDay(localDay(), -2) } });
    const project = core.createProject({ title:'Ремонт велосипеда', domainId:shop.id });
    core.createTask({ title:'Замерить ось', projectId:project.id });
    window.mapApi.fitAll();
  });
  await settle();
  assert.equal(await signals.getByRole('button').count(), 3);
  assert.match(await home().innerText(), /просрочено\s+Оплатить счёт/);
  assert.match(await health().innerText(), /Пора провести обзор/);
  assert.match(await shop().innerText(), /Нет следующего шага\s+Ремонт велосипеда/);
  await page.screenshot({ path:`${out}/desktop-overview.png` });
  await page.locator('[data-view=today]').click();
  assert.equal(await home().isVisible(), false);
  await page.locator('[data-view=map]').click();
  const beforeZoom = await page.evaluate(() => window.mapApi.getScale());
  await home().hover();
  await page.mouse.wheel(0, -100);
  await page.waitForFunction(before => window.mapApi.getScale() > before, beforeZoom);
  await overview.click();
  await settle();

  await home().press('Enter');
  assert.match(await inspector.innerText(), /Оплатить счёт/);
  assert.ok(await inspector.locator('.inspector-heading').evaluate(element => element === document.activeElement));
  await inspector.getByRole('button', { name:'Готово', exact:true }).click();
  await overview.click();
  await settle();
  assert.match(await home().innerText(), /Пора провести обзор/);
  assert.equal((await saved()).tasks.find(task => task.title === 'Оплатить счёт').status, 'done');

  await page.setViewportSize({ width:390, height:844 });
  await overview.click();
  await settle();
  await page.screenshot({ path:`${out}/narrow-overview.png` });
  await health().click();
  const mark = inspector.getByRole('button', { name:'Отметить обзор', exact:true });
  assert.ok(await mark.evaluate(element => element === document.activeElement));
  await mark.click();
  await page.getByRole('button', { name:'Закрыть детали', exact:true }).click();
  await overview.click();
  await settle();
  assert.equal(await health().count(), 0);

  await shop().click();
  const next = inspector.getByLabel('Следующий шаг', { exact:true });
  assert.ok(await next.evaluate(element => element === document.activeElement));
  await next.selectOption({ label:'Замерить ось' });
  await inspector.getByRole('button', { name:'Сохранить решение', exact:true }).click();
  await page.reload();
  await overview.click();
  await settle();
  assert.equal(await signals.getByRole('button').count(), 1);
  assert.match(await home().innerText(), /Пора провести обзор/);
  const data = await saved();
  assert.equal(data.projects[0].nextActionId, data.tasks.find(task => task.title === 'Замерить ось').id);
  assert.ok(data.domains.find(domain => domain.title === 'Здоровье').attentionReviewedAt);
  assert.deepEqual(errors, []);
  console.log('PASS domain signals: map → overdue completion, domain review, project next step, priority, keyboard, narrow screen and reload');
} finally {
  await browser.close();
  await closeAll(server);
}
