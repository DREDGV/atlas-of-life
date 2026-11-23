import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { startStaticServer, closeAll } from './smoke-shared.mjs';

const server = await startStaticServer();
const browser = await chromium.launch({ headless: true });
const out = 'output/first-task-screens';
mkdirSync(out, { recursive: true });

const purchase = 'Купить батарейки для походного фонаря';
const captureText = 'Сделать и напечатать шарниры для скрытого люка';
const projectStep = 'Снять размеры крепления скрытого люка';

const cases = [
  { viewport: { width: 319, height: 892 }, narrow: true, title: purchase },
  { viewport: { width: 319, height: 700 }, narrow: true, title: projectStep, project: true },
  { viewport: { width: 1440, height: 900 }, title: purchase },
  { viewport: { width: 1440, height: 900 }, title: projectStep, project: true },
];

try {
  for (const { viewport, narrow, title, project } of cases) {
    const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const screenshot = phase => page.screenshot({
      path: `${out}/${viewport.width}-${project ? 'project' : 'purchase'}-${phase}.png`,
    });
    const button = name => page.getByRole('button', { name, exact: true });
    const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('atlas_v2_data')));
    const layout = async () => {
      const sizes = await page.evaluate(() => ({
        width: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        canvasWidth: Math.round(document.querySelector('#canvas').getBoundingClientRect().width),
      }));
      assert.equal(sizes.width, viewport.width);
      assert.equal(sizes.scrollWidth, viewport.width);
      if (narrow) assert.equal(sizes.canvasWidth, viewport.width);
    };
    await page.goto(server.origin);
    await button('Записать первое дело').waitFor();
    await layout();
    if (narrow) await screenshot('start');
    await button('Записать первое дело').click();
    await page.locator('#inboxCaptureText').fill(project ? captureText : purchase);
    if (project) {
      await button('Оставить во Входящих').click();
      await page.reload();
      await button('Разобрать запись').click();
    } else {
      await button('Сохранить и разобрать').click();
      assert.equal(await page.locator('#inboxCaptureText').count(), 0);
    }
    await page.locator('[data-item-type=task]').click();
    assert.equal(await page.getByLabel('Сфера назначения').count(), 0);
    assert.match(await page.locator('.inbox-route-destination').innerText(), /Карта → Без сферы/);
    if (project) {
      await page.getByText('+ Создать сферу', { exact: true }).click();
      await page.getByLabel('Название сферы', { exact: true }).fill('Дом и ремонт');
      await button('Создать сферу').click();
      await page.getByText('+ Создать проект', { exact: true }).click();
      await page.getByLabel('Название проекта', { exact: true }).fill('Скрытый люк');
      await button('Создать проект').click();
      await page.getByText('Уточнить название задачи', { exact: true }).click();
      await page.getByLabel('Название задачи', { exact: true }).fill(projectStep);
      assert.match(await page.locator('.inbox-route-destination').innerText(), /Дом и ремонт → Скрытый люк/);
    }
    assert.ok(await page.locator('.inbox-dialog').evaluate(el => el.scrollWidth === el.clientWidth));
    await button('Создать и показать на карте').click();
    assert.equal(await page.locator('#inboxOverlay').isVisible(), false);
    assert.equal(await page.locator('#atlasNavigator .atlas-selection-title').innerText(), title);
    assert.ok(await page.locator('#atlasNavigator .atlas-selection-title').evaluate(el => el.scrollWidth === el.clientWidth));
    await layout();
    if (narrow) {
      assert.equal(await page.locator('#studioDetails').isVisible(), false);
      await screenshot('task');
      await button('Детали').click();
      assert.match(await page.locator('#inspector').innerText(), project ? /Скрытый люк/ : /Без сферы/);
      await button('Закрыть детали').click();
      await button('Настройки').click();
      await page.locator('#btnCenter').waitFor();
      await button('Закрыть настройки').press('Escape');
      assert.equal(await page.locator('#studioTools').isVisible(), false);
    } else {
      assert.match(await page.locator('#inspector').innerText(), project ? /Скрытый люк/ : /Без сферы/);
      await screenshot('task');
    }
    const store = await saved();
    assert.equal(store.tasks.length, 1);
    const [task] = store.tasks;
    assert.equal(store.inbox[0].resultRef.id, task.id);
    assert.equal(store.inbox[0].rawText, project ? captureText : purchase);
    if (project) {
      assert.equal(task.projectId, store.projects[0].id);
      assert.equal(store.projects[0].domainId, store.domains[0].id);
      await button('Сделать следующим шагом').click();
    } else {
      assert.equal(task.domainId, null);
      assert.equal(task.projectId, null);
    }
    await page.reload();
    if (narrow) await button('Список').click();
    if (project) await page.locator('#mapDay').getByRole('button', { name: title, exact: true }).click();
    else {
      await page.locator('#mapUnassigned summary').click();
      await page.locator('#mapUnassigned').getByRole('button', { name: title, exact: true }).click();
    }
    assert.equal(await page.locator('#atlasNavigator .atlas-selection-title').innerText(), title);
    await page.locator('#atlasNavigator').getByRole('button', { name: 'На сегодня', exact: true }).click();
    await button('Открыть в «Сегодня»').click();
    assert.ok(await page.locator('#viewToday').getByRole('button', { name: title, exact: true }).isVisible());
    assert.deepEqual(errors, []);
    console.log(`PASS ${viewport.width}×${viewport.height}: ${project ? 'new project' : 'purchase without sphere'}, map, reload and Today`);
    await page.close();
  }
} finally {
  await browser.close();
  await closeAll(server);
}
