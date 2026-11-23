import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startStaticServer, closeAll } from './smoke-shared.mjs';

const server = await startStaticServer();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(8000);
const view = name => page.locator(`[data-view="${name}"]`);
const settings = page.locator('.studio-map-view summary');
const more = page.locator('.header-popover-secondary summary');
const button = name => page.getByRole('button', { name, exact: true });
const out = 'output/studio-review';
await mkdir(out, { recursive: true });

try {
  await page.goto(server.origin);
  const ids = await page.evaluate(async () => {
    const core = await import('/js/core/commands.js');
    const sphere = core.createDomain({ title: 'Дом' });
    const project = core.createProject({ title: 'Ремонт', domainId: sphere.id });
    const task = core.createTask({ title: 'Заказать петли', projectId: project.id });
    window.mapApi.openTask(task.id);
    return { task: task.id, project: project.id };
  });
  for (const [name, selector] of [['today', '#viewToday'], ['knowledge', '#viewKnowledge'], ['map', '#canvas']]) {
    await view(name).click();
    assert.ok(await page.locator(selector).isVisible());
    assert.equal(await page.locator('#btnCenter').isVisible(), name === 'map');
  }
  for (const control of ['btnCenter', 'btnFitDomain', 'btnFitProject', 'btnReset']) {
    await page.locator('#' + control).click();
  }
  await page.locator('#zoomSlider').press('End');
  assert.equal(await page.evaluate(() => window.mapApi.getScale()), 220);
  await page.locator('#btnReset').click();
  assert.equal(await page.evaluate(() => window.mapApi.getScale()), 100);
  for (const lens of ['due', 'focus', 'stale', 'done', 'all']) {
    const filter = page.locator(`[data-map-lens="${lens}"]`);
    await filter.click();
    assert.equal(await filter.getAttribute('aria-pressed'), 'true');
  }
  await page.locator('#mapSearch').fill('Заказать петли');
  await page.locator('#mapSearch').press('Enter');
  assert.match(await page.locator('#mapLensCount').innerText(), /1 из 1/);
  await page.locator('#mapSearch').press('Escape');
  assert.equal(await page.locator('#mapLensCount').isVisible(), false);

  await settings.click();
  for (const id of ['tgLinks', 'tgAging', 'tgGlow']) await page.locator('#' + id).uncheck();
  await settings.click();
  await more.click();
  const light = page.getByLabel('Светлая тема');
  await light.check();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await page.reload();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await settings.click();
  for (const id of ['tgLinks', 'tgAging', 'tgGlow']) assert.equal(await page.locator('#' + id).isChecked(), false);
  await settings.click();
  await more.click();
  await page.locator('#btnAbout').click();
  assert.match(await page.locator('#modal').innerText(), /0\.13\.0-alpha/);
  await page.locator('#modalOk').click();
  assert.equal(await page.locator('#modal').isVisible(), false);
  await page.locator('#btnRecovery').click();
  await page.locator('#storageRecovery').waitFor();
  await page.locator('#storageRecovery').getByRole('button', { name: 'Закрыть', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.locator('#btnExport').click();
  const bytes = await readFile(await (await download).path());
  const exported = JSON.parse(bytes);
  assert.ok(exported.tasks.some(task => task.id === ids.task));
  const second = await browser.newPage();
  await second.goto(server.origin);
  await second.locator('#fileImport').setInputFiles({ name: 'atlas.json', mimeType: 'application/json', buffer: bytes });
  const replacement = second.getByRole('dialog', { name: 'Импорт Atlas из JSON' });
  await replacement.getByRole('button', { name: 'Заменить данные', exact: true }).click();
  await replacement.waitFor({ state: 'detached' });
  await second.waitForFunction(id => window.state.tasks.some(task => task.id === id), ids.task);
  await second.locator('#fileImport').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await replacement.getByText('Файл содержит некорректный JSON.', { exact: true }).waitFor();
  await replacement.getByRole('button', { name: 'Отмена', exact: true }).click();
  assert.equal(await second.evaluate(() => window.state.tasks.length), 1);
  await second.close();

  await more.click();
  await page.locator('#btnFullscreen').click();
  await page.waitForFunction(() => Boolean(document.fullscreenElement));
  await page.locator('#btnFullscreen').click();
  await page.waitForFunction(() => !document.fullscreenElement);
  await page.locator('.atlas-sync-badge').click();
  await page.locator('.atlas-sync-modal').waitFor();
  await page.screenshot({ path: `${out}/sync.png` });
  await page.locator('.atlas-sync-modal').getByRole('button', { name: 'Закрыть', exact: true }).click();
  const experiments = page.locator('#expBadge');
  await experiments.click();
  const experimentPanel = page.locator('#expPanel');
  await experimentPanel.waitFor();
  const experiment = experimentPanel.locator('input[type=checkbox]').first();
  const enabled = await experiment.isChecked();
  await experiment.setChecked(!enabled);
  await experiment.setChecked(enabled);
  await experimentPanel.getByRole('button', { name: 'Close', exact: true }).click();
  assert.equal(await experimentPanel.isVisible(), false);

  const sphereActions = name => button('Действия сферы ' + name);
  const domainMenu = page.locator('.domenu');
  const addSphere = async title => {
    await button('+ Сфера').click();
    await page.getByRole('textbox', { name: 'Название сферы', exact: true }).fill(title);
    await page.locator('#newDomSave').click();
  };
  await addSphere('Мастерская');
  await sphereActions('Мастерская').press('Enter');
  await domainMenu.getByRole('button', { name: 'Показать на карте' }).press('Escape');
  assert.equal(await domainMenu.isVisible(), false);
  assert.equal(await sphereActions('Мастерская').getAttribute('aria-expanded'), 'false');
  await sphereActions('Мастерская').press('Enter');
  await domainMenu.getByRole('button', { name: 'Переименовать' }).press('Enter');
  const domainTitle = page.getByRole('textbox', { name: 'Название сферы', exact: true });
  assert.ok(await domainTitle.evaluate(input => input === document.activeElement));
  await domainTitle.fill('Гараж');
  await page.locator('#modalOk').click();
  await sphereActions('Гараж').click();
  await domainMenu.getByRole('button', { name: 'Цвет', exact: true }).click();
  const color = domainMenu.getByRole('button', { name: /Цвет #/ }).first();
  const colorValue = await color.getAttribute('data-col');
  await color.click();
  assert.equal(await page.evaluate(() => window.state.domains.find(domain => domain.title === 'Гараж').color), colorValue);
  const nav = page.locator('#atlasNavigator');
  await nav.getByRole('button', { name:'+ Задача', exact:true }).click();
  const looseTask = nav.getByRole('form', { name:'Новая задача' });
  assert.match(await looseTask.innerText(), /Место — Гараж → Без проекта/);
  await looseTask.getByLabel('Название задачи').fill('Купить щётку');
  await looseTask.getByRole('button', { name:'Создать задачу', exact:true }).click();
  await nav.locator('[data-action=domain]').click();
  await page.locator('#atlasNavigator').getByRole('button', { name: '+ Проект', exact: true }).click();
  const projectForm = page.locator('#atlasNavigator').getByRole('form', { name:'Новый проект' });
  assert.match(await projectForm.innerText(), /Место — Гараж/);
  await projectForm.getByLabel('Название проекта').fill('Ремонт станка');
  await projectForm.getByRole('button', { name:'Создать проект', exact:true }).click();
  assert.match(await page.locator('#inspector .inspector-heading').innerText(), /Ремонт станка/);
  await page.screenshot({ path:`${out}/project-created.png` });
  await page.locator('#inspector #addTask').click();
  const taskForm = page.locator('#inspector').getByRole('form', { name:'Новая задача' });
  assert.match(await taskForm.innerText(), /Место — Гараж → Ремонт станка/);
  await taskForm.getByLabel('Название задачи').fill('Проверить подшипник');
  await taskForm.getByRole('button', { name:'Создать задачу', exact:true }).click();
  assert.match(await page.locator('#inspector .inspector-heading').innerText(), /Проверить подшипник/);
  assert.ok(await page.evaluate(() => window.state.tasks.some(task => task.title === 'Проверить подшипник'
    && window.state.projects.find(project => project.id === task.projectId)?.title === 'Ремонт станка')));
  await sphereActions('Гараж').click();
  await domainMenu.getByRole('button', { name: 'Объединить с…', exact: true }).click();
  await page.locator('#modalOk').click();
  assert.equal(await page.evaluate(() => window.state.projects.find(project => project.title === 'Ремонт станка').domainId),
    await page.evaluate(() => window.state.domains.find(domain => domain.title === 'Дом').id));
  await addSphere('Заметки');
  const note = await page.evaluate(async () => {
    const core = await import('/js/core/commands.js');
    const domainId = window.state.domains.find(item => item.title === 'Заметки').id;
    const [source] = core.captureInbox('Маркировка станка', { itemType: 'note' });
    core.routeInboxToKnowledge(source.id, { domainId });
    return { domainId, sourceId: source.id };
  });
  await sphereActions('Заметки').click();
  await domainMenu.getByRole('button', { name: 'Удалить…', exact: true }).click();
  await page.locator('#modalOk').click();
  assert.match(await page.locator('#modalError').innerText(), /есть мысли и заметки/);
  await page.screenshot({ path: `${out}/sphere-guard.png` });
  await page.locator('#modalCancel').press('Escape');
  assert.ok(await sphereActions('Заметки').evaluate(element => element === document.activeElement));
  assert.ok(await page.evaluate(({ domainId, sourceId }) => window.state.knowledge.some(item => item.domainId === domainId && item.sourceInboxId === sourceId), note));
  await addSphere('Временная');
  await sphereActions('Временная').click();
  await domainMenu.getByRole('button', { name: 'Удалить…', exact: true }).click();
  await page.locator('#modalOk').click();
  await page.reload();
  assert.equal(await sphereActions('Временная').count(), 0);
  assert.equal(await sphereActions('Гараж').count(), 0);
  assert.ok(await sphereActions('Заметки').isVisible());
  assert.ok(await page.evaluate(() => {
    const home = window.state.domains.find(domain => domain.title === 'Дом');
    const repair = window.state.projects.find(project => project.title === 'Ремонт станка');
    const loose = window.state.tasks.find(task => task.title === 'Купить щётку');
    const attached = window.state.tasks.find(task => task.title === 'Проверить подшипник');
    return repair.domainId === home.id && loose.domainId === home.id && !loose.projectId && attached.projectId === repair.id;
  }));

  await page.setViewportSize({ width: 390, height: 830 });
  await button('Настройки').click();
  await more.click();
  assert.ok(await light.isVisible());
  await page.screenshot({ path: `${out}/narrow-tools.png` });
  await button('Закрыть настройки').click();
  assert.equal(await page.locator('#studioTools').isVisible(), false);
  assert.deepEqual(errors, []);
  console.log('PASS Studio shell: navigation, camera, filters, theme and reload, dialogs, export/import, Sync, sphere actions and safeguards, narrow settings');
} finally {
  await browser.close();
  await closeAll(server);
}
