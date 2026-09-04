// Focused real-browser smoke for the Inbox-first Quick Dock and sparse map.
// ATTACH-ONLY: Chromium with CDP and the static server are launched separately.
import { chromium } from 'playwright';
import { join } from 'node:path';

const CDP_PORT = process.env.ALF_SMOKE_CDP_PORT || '9234';
const APP_URL = process.env.ALF_SMOKE_URL || 'http://127.0.0.1:4173/';
const OUTPUT = join(process.cwd(), 'output', 'smoke-map-dock-product.png');

function assert(condition, message){
  if (!condition) throw new Error(`SMOKE FAIL: ${message}`);
}

const fixture = {
  schema: 4,
  domains: [
    { id: 'd-home', title: 'Дом', color: '#f59e0b', createdAt: 1, updatedAt: 1 },
    { id: 'd-dacha', title: 'Дача', color: '#2dd4bf', createdAt: 1, updatedAt: 1 },
  ],
  projects: [],
  tasks: [
    { id: 't-home-1', projectId: null, domainId: 'd-home', title: 'Купить лампу', tags: [], status: 'backlog', priority: 2, createdAt: 1, updatedAt: 1 },
    { id: 't-home-2', projectId: null, domainId: 'd-home', title: 'Разобрать шкаф', tags: [], status: 'today', priority: 2, createdAt: 2, updatedAt: 2 },
    { id: 't-dacha-1', projectId: null, domainId: 'd-dacha', title: 'Проверить полив', tags: [], status: 'backlog', priority: 2, createdAt: 3, updatedAt: 3 },
  ],
  inbox: [],
  operationLog: [],
  maxEdges: 300,
  showLinks: true,
  showAging: true,
  showGlow: true,
  view: 'map',
  settings: { layoutMode: 'auto' },
};

let browser;
let page;
const errors = [];
try {
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  const context = browser.contexts()[0] || await browser.newContext();
  page = await context.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(APP_URL, { waitUntil: 'load' });
  await page.evaluate(data => localStorage.setItem('atlas_v2_data', JSON.stringify(data)), fixture);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.domain-row');
  await page.waitForTimeout(900);

  const domainRows = page.locator('.domain-row');
  assert(await domainRows.count() === 2, 'two domain rows must render');
  assert(await page.locator('.domain-visibility:checked').count() === 2, 'all domains must be visible by default');
  assert(await page.locator('[data-quick-mode="inbox"]').getAttribute('aria-pressed') === 'true', 'Inbox must be the default Quick Dock mode');
  assert((await page.locator('#qaPreview').innerText()).includes('без разбора'), 'Inbox preview must promise literal capture');
  const rowText = await domainRows.allInnerTexts();
  assert(rowText.every(text => text.includes('0 пр')), 'project counts must be zero');
  assert(rowText.some(text => text.includes('2 зад')) && rowText.some(text => text.includes('1 зад')), 'task counts must include unassigned tasks');

  const geometry = await page.evaluate(() => {
    const nodes = window.mapApi.getNodes();
    return {
      domains: nodes.filter(node => node._type === 'domain'),
      groups: nodes.filter(node => node._type === 'unassigned'),
      tasks: nodes.filter(node => node._type === 'task'),
    };
  });
  assert(geometry.domains.length === 2, 'both visible domains must be in map nodes');
  assert(geometry.groups.length === 2, 'each sparse domain must have an unassigned group');
  assert(geometry.domains.every(node => node.r <= 170 * 2), 'sparse domain radius must stay compact');
  for (const task of geometry.tasks) {
    const group = geometry.groups.find(item => {
      const domain = fixture.tasks.find(source => source.id === task.id)?.domainId;
      return item.domainId === domain;
    });
    assert(group && Math.hypot(task.x - group.x, task.y - group.y) <= group.r, `task ${task.id} must be inside its unassigned group`);
  }

  const packedLayout = await page.evaluate(() => {
    window.state.projects.push(
      { id: 'p-pack-1', domainId: 'd-home', title: 'Ремонт', tags: [], createdAt: 4, updatedAt: 4 },
      { id: 'p-pack-2', domainId: 'd-home', title: 'Покупки', tags: [], createdAt: 5, updatedAt: 5 },
    );
    window.state.tasks.push(
      { id: 't-pack-1', projectId: 'p-pack-1', title: 'Замерить стену', tags: [], status: 'backlog', priority: 2, createdAt: 4, updatedAt: 4 },
      { id: 't-pack-2', projectId: 'p-pack-2', title: 'Выбрать краску', tags: [], status: 'backlog', priority: 2, createdAt: 5, updatedAt: 5 },
    );
    window.mapApi.layoutMap();
    const nodes = window.mapApi.getNodes();
    return {
      domain: nodes.find(node => node._type === 'domain' && node.id === 'd-home'),
      containers: nodes.filter(node =>
        (node._type === 'project' && node.parent === 'd-home') ||
        (node._type === 'unassigned' && node.domainId === 'd-home')
      ),
    };
  });
  const packed = packedLayout.containers;
  assert(packed.length === 3, 'two projects and the unassigned group must share the domain layout');
  for (let left = 0; left < packed.length; left += 1) {
    for (let right = left + 1; right < packed.length; right += 1) {
      const distance = Math.hypot(packed[left].x - packed[right].x, packed[left].y - packed[right].y);
      assert(
        distance + 1 >= packed[left].r + packed[right].r,
        `project and unassigned containers must not overlap: ${packed[left]._type}:${packed[left].id} + ${packed[right]._type}:${packed[right].id}, distance=${distance.toFixed(1)}, radii=${packed[left].r}+${packed[right].r}, domain=${JSON.stringify(packedLayout.domain)}`
      );
    }
  }
  await page.evaluate(tasks => {
    window.state.projects = [];
    window.state.tasks = tasks;
    window.mapApi.layoutMap();
    window.mapApi.drawMap();
    window.renderSidebar();
  }, fixture.tasks);

  await domainRows.nth(0).locator('.domain-visibility').uncheck();
  await page.waitForTimeout(250);
  assert((await page.evaluate(() => window.mapApi.getNodes().filter(node => node._type === 'domain').length)) === 1, 'checkbox must hide one domain without modifiers');
  await domainRows.nth(1).locator('.domain-visibility').click();
  assert(await domainRows.nth(1).locator('.domain-visibility').isChecked(), 'last visible domain must stay checked');

  await domainRows.nth(0).locator('.domain-name').click();
  assert(await domainRows.nth(0).locator('.domain-visibility').isChecked(), 'choosing context must reveal a hidden domain');
  assert((await domainRows.nth(0).innerText()).toLocaleLowerCase('ru-RU').includes('контекст'), 'context must be labeled independently');

  const literal = 'Мысль #тег @Проект !сегодня 10:00 ~30м p2';
  await page.locator('[data-quick-mode="inbox"]').click();
  await page.locator('#quickAdd').fill(literal);
  await page.locator('#quickSubmit').click();
  const inboxItem = await page.evaluate(() => window.state.inbox.at(-1));
  assert(inboxItem.rawText === literal && inboxItem.text === literal, 'Inbox mode must preserve literal text');
  assert(inboxItem.userHint === null && inboxItem.itemType === null, 'Inbox mode must not classify tokens');

  await page.locator('[data-quick-mode="task"]').click();
  await page.locator('#quickAdd').fill('Позвонить мастеру !сегодня 10:00 #дом ~30м p3');
  await page.locator('#quickSubmit').click();
  const task = await page.evaluate(() => window.state.tasks.at(-1));
  assert(task.domainId === 'd-home' && task.projectId == null, 'direct task must use the active domain context');
  assert(task.status === 'today' && task.due?.time === '10:00', 'direct task must persist Today and due');
  assert(task.tags.includes('дом') && task.estimateMin === 30 && task.priority === 3, 'direct task metadata must persist');

  const invalid = 'Проверить отчёт @Несуществующий';
  await page.locator('#quickAdd').fill(invalid);
  await page.locator('#quickSubmit').click();
  assert(await page.locator('#quickAdd').inputValue() === invalid, 'failed task must retain input');
  assert((await page.locator('#qaPreview').innerText()).includes('не найден'), 'failed task must explain the destination error');
  assert((await page.locator('#qaResult').innerText()) === '', 'failed task must not duplicate the preview error');

  await page.screenshot({ path: OUTPUT, fullPage: true });
  assert(errors.length === 0, `browser errors: ${errors.join('; ')}`);
  console.log(`MAP + QUICK DOCK PRODUCT SMOKE PASSED\nScreenshot: ${OUTPUT}`);
} catch (error) {
  console.error(error.message);
  if (page) await page.screenshot({ path: join(process.cwd(), 'output', 'smoke-map-dock-product-fail.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
}
