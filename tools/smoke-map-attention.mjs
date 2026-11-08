import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { startStaticServer, closeAll } from './smoke-shared.mjs';
const fixture = await startStaticServer();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'ru-RU' });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
mkdirSync('output/map-attention', { recursive: true });
try {
  await page.goto(fixture.origin);
  const ids = await page.evaluate(async () => {
    const c = await import('/js/core/commands.js');
    const { localDay, shiftDay } = await import('/js/features/today/model.js');
    const home = c.createDomain({ title: 'Дом и семья', color: '#2dd4bf' }).id;
    const work = c.createDomain({ title: 'Работа', color: '#60a5fa' }).id;
    const health = c.createDomain({ title: 'Здоровье', color: '#c084fc' }).id;
    const rest = c.createDomain({ title: 'Отдых', color: '#f59e0b' }).id;
    const repair = c.createProject({ title: 'Ремонт кухни', domainId: home }).id;
    const product = c.createProject({ title: 'Запуск продукта', domainId: work }).id;
    const late = c.createTask({ title: 'Согласовать смету', projectId: repair, due: { date: shiftDay(localDay(), -3) } }).id;
    c.createTask({ title: 'Выбрать освещение', projectId: repair });
    for (const title of ['Прототип', 'Переговоры', 'Презентация', 'Исследование']) c.createTask({ title, projectId: product, status: 'doing' });
    c.createTask({ title: 'Записаться к стоматологу', domainId: health, updatedAt: Date.now() - 40 * 86400000 });
    const map = await import('/js/view_map.js');
    map.layoutMap(); map.fitAll();
    return { home, work, health, rest, late, repair };
  });
  await page.waitForTimeout(400);
  const overview = page.locator('#mapAttention');
  assert.match(await overview.innerText(), /1 просрочено/);
  assert.match(await overview.innerText(), /4 начато/);
  assert.match(await overview.innerText(), /1 без движения/);
  assert.match(await overview.innerText(), /Нет следующего шага/);
  await page.screenshot({ path: 'output/map-attention/overview-dark.png', animations: 'disabled' });
  // Hidden domain + filtering must not make an attention destination unreachable.
  await page.evaluate(async id => {
    const { state } = await import('/js/state.js');
    const session = await import('/js/ui/map-session.js');
    session.setDomainVisible(id, false, state.domains);
    (await import('/js/view_map.js')).setMapFilter({ lens: 'done', query: 'missing' });
  }, ids.home);
  const home = overview.locator(`details[data-area="${ids.home}"]`);
  await home.locator(':scope > summary').focus();
  await page.keyboard.press('Enter');
  await home.getByRole('button', { name: 'Показать сферу на карте' }).click();
  assert.match(await page.locator('#inspector').innerText(), /Дом и семья/);
  assert.equal(await page.locator('[data-map-lens="all"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#mapSearch').inputValue(), '');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'output/map-attention/explained.png', animations: 'disabled' });
  assert.equal(await page.evaluate(async id => (await import('/js/view_map.js')).getLayoutSnapshot().nodes.some(n => n.id === id), ids.home), true);
  await home.locator(':scope > .attention-reasons').getByRole('button', { name: 'Открыть задачу' }).click();
  assert.match(await page.locator('#inspector').innerText(), /Согласовать смету/);
  await page.evaluate(async id => (await import('/js/core/commands.js')).updateTask(id, { status: 'done' }), ids.late);
  assert.doesNotMatch(await home.locator(':scope > summary').innerText(), /просрочено/);
  await page.reload();
  assert.doesNotMatch(await page.locator(`#mapAttention details[data-area="${ids.home}"] > summary`).innerText(), /просрочено/);
  await page.evaluate(async () => { document.documentElement.dataset.theme = 'light'; (await import('/js/view_map.js')).fitAll(); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'output/map-attention/overview-light.png', animations: 'disabled' });
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.evaluate(async () => (await import('/js/view_map.js')).fitAll());
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'output/map-attention/compact.png', animations: 'disabled' });
  const fitting = await page.evaluate(async () => {
    const s = (await import('/js/view_map.js')).getLayoutSnapshot();
    const wrap = document.getElementById('canvasWrap').getBoundingClientRect();
    return { height: wrap.height, canvasHeight: s.size.height / s.size.dpr,
      inside: s.nodes.filter(n => n._type === 'domain').every(n =>
        (n.y + n.r) * s.scale + s.ty + 26 * s.size.dpr <= s.size.height &&
        (n.y - n.r) * s.scale + s.ty - 20 * s.size.dpr >= 0) };
  });
  assert.ok(fitting.inside, `overview territories must fit: ${JSON.stringify(fitting)}`);
  await page.getByRole('button', { name: 'Сегодня', exact: true }).click();
  assert.equal(await overview.isVisible(), false);
  assert.deepEqual(errors, []);
  console.log('PASS map attention browser: signals, hidden destination, Inspector, Core completion, reload, themes, Today');
} finally { await browser.close(); await closeAll(fixture); }
