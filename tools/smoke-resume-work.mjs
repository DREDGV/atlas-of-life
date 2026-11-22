import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { startStaticServer, closeAll } from './smoke-shared.mjs';

const server = await startStaticServer();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, reducedMotion: 'reduce' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(8000);
const out = 'output/atlas-life-guide';
mkdirSync(out, { recursive: true });
const shot = name => page.screenshot({ path: `${out}/${name}.png`, animations: 'disabled' });
const button = name => page.getByRole('button', { name, exact: true });
const inbox = page.locator('.inbox-dialog');
const route = inbox.locator('.inbox-route');
const nav = page.locator('#atlasNavigator');
const resume = nav.getByRole('button', { name: 'Продолжить работу' });
const inspector = page.locator('#inspector');
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('atlas_v2_data')));
const purchase = 'Купить батарейки для фонаря';
const repair = 'Снять размеры крепления скрытого люка';
const note = 'Размеры люка 320 × 460 мм. Крепление М4';
const part = 'Купить крепёж М4 для люка';
const draft = 'Сверить размеры уплотнителя';
const otherDraft = 'Записать марку герметика';

async function capture(text) {
  await page.locator('#btnInbox').click();
  await inbox.getByRole('button', { name: '+ Записать', exact: true }).click();
  await page.locator('#inboxCaptureText').fill(text);
  await button('Сохранить и разобрать').click();
}

async function createPlace(sphere, project) {
  await route.getByText('+ Создать сферу', { exact: true }).click();
  await route.getByLabel('Название сферы').fill(sphere);
  await route.getByRole('button', { name: 'Создать сферу', exact: true }).click();
  await route.getByText('+ Создать проект', { exact: true }).click();
  await route.getByLabel('Название проекта').fill(project);
  await route.getByRole('button', { name: 'Создать проект', exact: true }).click();
}

async function addProjectTask(sphere, project, text) {
  await capture(text);
  await inbox.locator('[data-item-type=task]').click();
  await createPlace(sphere, project);
  await route.getByRole('button', { name: 'Создать задачу', exact: true }).click();
  await inbox.getByRole('button', { name: 'Открыть задачу', exact: true }).click();
  await inspector.getByRole('heading', { name: text, exact: true }).waitFor();
}

try {
  await page.goto(server.origin);
  await button('Записать первое дело').waitFor();
  await shot('01-start');
  await button('Записать первое дело').click();
  await page.locator('#inboxCaptureText').fill(purchase);
  await shot('02-capture');
  await button('Сохранить и разобрать').click();
  await inbox.locator('[data-item-type=task]').click();
  assert.match(await route.innerText(), /Карта → Без сферы/);
  await shot('03-route');
  await button('Создать и показать на карте').click();
  await inspector.getByRole('heading', { name: purchase, exact: true }).waitFor();
  await page.reload();
  assert.match(await nav.innerText(), /Задача · Купить батарейки для фонаря/);
  await shot('04-resume-task');
  const beforeResume = (await saved()).operationLog.length;
  await resume.click();
  await inspector.getByRole('heading', { name: purchase, exact: true }).waitFor();
  assert.equal((await saved()).operationLog.length, beforeResume);
  await nav.getByRole('button', { name: 'На сегодня', exact: true }).click();
  await nav.getByRole('button', { name: 'Открыть в «Сегодня»', exact: true }).click();
  const today = page.locator('#viewToday .todo').filter({ hasText: purchase });
  await today.getByRole('button', { name: 'В фокус', exact: true }).click();
  await shot('05-today');
  await today.getByRole('button', { name: 'Выполнено', exact: true }).click();
  await page.getByRole('button', { name: 'Карта', exact: true }).click();
  assert.equal(await resume.isVisible(), false);

  await addProjectTask('Дом', 'Скрытый люк', repair);
  await nav.getByRole('button', { name: 'Сделать следующим шагом', exact: true }).click();
  await inspector.locator('#planTomorrow').click();
  await shot('06-project-step');
  await capture(note);
  await inbox.locator('[data-item-type=note]').click();
  await button('Прошлое назначение · Дом → Скрытый люк').click();
  await button('Сохранить как заметку').click();
  await button('Открыть результат').click();
  await inspector.getByRole('heading', { name: note, exact: true }).waitFor();
  await shot('07-note');

  await addProjectTask('Мастерская', 'Обслуживание велосипеда', 'Проверить износ цепи');
  await addProjectTask('Личное', 'Неделя движения', 'Уточнить расписание бассейна');
  await capture(part);
  await inbox.locator('[data-item-type=task]').click();
  await route.getByLabel('Сфера назначения').selectOption({ label: 'Дом' });
  await button('Создать задачу').click();
  await button('Открыть задачу').click();

  await page.locator('#mapSearch').fill('Скрытый люк');
  await page.locator('#mapSearch').press('Enter');
  await inspector.getByRole('heading', { name: 'Скрытый люк', exact: true }).waitFor();
  await inspector.getByRole('combobox', { name: 'Перенести проект в сферу' }).selectOption({ label: 'Мастерская' });
  await inspector.locator('.project-placement').scrollIntoViewIfNeeded();
  await shot('08-transfer');
  await button('Перенести проект').click();
  assert.match(await inspector.innerText(), /Проект перенесён: Мастерская/);
  await button('Отменить перенос').click();
  assert.match(await inspector.innerText(), /Сфера: Дом/);
  await inspector.getByRole('combobox', { name: 'Перенести проект в сферу' }).selectOption({ label: 'Мастерская' });
  await button('Перенести проект').click();
  await page.reload();
  const moved = await saved();
  const hatch = moved.projects.find(project => project.title === 'Скрытый люк');
  const workshop = moved.domains.find(sphere => sphere.title === 'Мастерская');
  const step = moved.tasks.find(task => task.title === repair);
  assert.equal(hatch.domainId, workshop.id);
  assert.equal(hatch.nextActionId, step.id);
  assert.equal(moved.knowledge.find(material => material.title === note).projectId, hatch.id);
  assert.ok(step.plannedDay);

  await resume.click();
  await inspector.getByRole('heading', { name: part, exact: true }).waitFor();
  await inspector.locator('#taskPlace summary').click();
  await inspector.locator('#taskPlaceDomain').selectOption({ label: 'Мастерская' });
  await inspector.locator('#taskPlaceProject').selectOption({ label: 'Скрытый люк' });
  await shot('09-task-placement');
  await button('Сохранить место').click();
  assert.equal((await saved()).tasks.find(task => task.title === part).projectId, hatch.id);

  await capture(`${draft}\n${otherDraft}`);
  await inbox.locator('[data-item-type=task]').click();
  await inbox.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.reload();
  assert.match(await nav.innerText(), /Разбор · Сверить размеры уплотнителя/);
  await shot('10-resume-inbox');
  await page.setViewportSize({ width: 390, height: 840 });
  await shot('10-mobile');
  const beforeInboxResume = (await saved()).operationLog.length;
  await resume.click();
  const record = inbox.locator('.inbox-row--active');
  assert.match(await record.innerText(), /Сверить размеры уплотнителя/);
  assert.equal(await record.locator('[data-item-type=task]').getAttribute('aria-pressed'), 'true');
  assert.equal((await saved()).operationLog.length, beforeInboxResume);
  await record.getByText('Действия и исходник', { exact: true }).click();
  await record.getByRole('button', { name: 'Отбросить', exact: true }).click();
  await inbox.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.reload();
  assert.match(await nav.innerText(), /Задача · Купить крепёж М4 для люка/);
  await resume.click();
  await button('Детали').click();
  assert.match(await inspector.innerText(), /Сфера: Мастерская/);
  await button('Закрыть детали').click();
  await page.setViewportSize({ width: 1440, height: 950 });

  await page.locator('#mapReviewEntry button').click();
  assert.match(await page.locator('.review-events').innerText(), /Задача выполнена\s+Купить батарейки для фонаря/);
  await shot('11-review');
  await button('Закрыть').click();
  await page.locator('#btnCenter').click();
  await page.waitForFunction(() => {
    const camera = window.mapApi.getCamera();
    const spheres = window.mapApi.getNodes().filter(node => node._type === 'domain');
    return spheres.length === 3 && spheres.every(node => {
      const x = node.x * camera.scale + camera.tx;
      const y = node.y * camera.scale + camera.ty;
      return x > 0 && x < camera.width && y > 0 && y < camera.height;
    });
  });
  await nav.locator('[data-action=overview]').click();
  await shot('12-overview');
  const final = await saved();
  assert.equal(final.domains.length, 3);
  assert.equal(final.projects.length, 3);
  assert.equal(final.tasks.length, 5);
  await page.locator('[data-view=today]').click();
  await page.locator('[data-quick-mode=task]').click();
  await page.locator('#domainsList .domain-name').filter({ hasText: 'Дом' }).click();
  await page.locator('#quickAdd').fill('Вынести коробки на переработку');
  await page.locator('#quickSubmit').click();
  await page.locator('#qaResult').getByRole('button', { name: 'Показать', exact: true }).click();
  assert.equal(await page.locator('[data-view=map]').getAttribute('aria-pressed'), 'true',
    'a direct task created in Today must open on the map');
  assert.match(await nav.innerText(), /Вынести коробки на переработку/);
  assert.deepEqual(errors, []);
  console.log('PASS resume: task and exact pending item after reload, no domain writes, stale fallback; 3 spheres, 3 projects, 5 tasks, note, project move and undo, task move, plan, focus and history');
} catch (error) {
  await shot('error');
  throw error;
} finally {
  await browser.close();
  await closeAll(server);
}
