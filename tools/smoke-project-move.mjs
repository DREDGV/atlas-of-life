import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { startStaticServer, closeAll } from './smoke-shared.mjs';
const server = await startStaticServer();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
try {
  await page.goto(server.origin);
  const ids = await page.evaluate(async () => {
    const c = await import('/js/core/commands.js');
    const a = c.createDomain({ title: 'Личное', color: '#2dd4bf' });
    const b = c.createDomain({ title: 'Работа', color: '#60a5fa' });
    const p = c.createProject({ title: 'Фотопроект', domainId: a.id });
    c.createTask({ title: 'Собрать портфолио', projectId: p.id });
    const [source] = c.captureInbox('Идея для съёмки', { itemType: 'thought' });
    c.routeInboxToKnowledge(source.id, { projectId: p.id });
    (await import('/js/inspector.js')).openInspectorFor({ ...p, _type: 'project' });
    (await import('/js/view_map.js')).fitAll();
    return { a:a.id, b:b.id, p:p.id };
  });
  const domain = () => page.evaluate(async id => (await import('/js/state.js')).state.projects.find(p => p.id === id).domainId, ids.p);
  await page.getByRole('combobox', { name: 'Перенести проект в сферу' }).selectOption(ids.b);
  await page.getByRole('button', { name: 'Перенести проект', exact: true }).click();
  assert.equal(await domain(), ids.b);
  assert.match(await page.locator('#inspector').innerText(), /Все связи сохранены/);
  assert.match(await page.locator('.inspector-materials').innerText(), /Работа.*Фотопроект/);
  assert.match(await page.locator('.inspector-materials').innerText(), /Идея для съёмки/);
  await page.getByRole('button', { name: 'Отменить перенос', exact: true }).click();
  assert.equal(await domain(), ids.a);
  await page.evaluate(async () => (await import('/js/view_map.js')).fitAll());
  await page.waitForTimeout(350);
  const points = await page.evaluate(async ids => {
    const map = await import('/js/view_map.js');
    const s = map.getLayoutSnapshot();
    const rect = document.getElementById('canvas').getBoundingClientRect();
    const at = id => { const n = s.nodes.find(n => n.id === id); return { x:rect.x+(n.x*s.scale+s.tx)/s.size.dpr, y:rect.y+(n.y*s.scale+s.ty)/s.size.dpr }; };
    const project = s.nodes.find(n => n.id === ids.p);
    let point;
    for (let i = 0; i < 32; i++) {
      const angle = i * Math.PI / 16;
      const x = project.x + Math.cos(angle) * project.r * .85;
      const y = project.y + Math.sin(angle) * project.r * .85;
      if (map.resolveHit(x,y)?.id === ids.p) { point = { x, y }; break; }
    }
    if (!point) throw new Error('No project hit target');
    return { start:{ x:rect.x+(point.x*s.scale+s.tx)/s.size.dpr, y:rect.y+(point.y*s.scale+s.ty)/s.size.dpr }, end:at(ids.b) };
  }, ids);
  await page.mouse.move(points.start.x, points.start.y);
  await page.mouse.down();
  await page.mouse.move(points.end.x, points.end.y, { steps: 15 });
  await page.mouse.up();
  assert.equal(await domain(), ids.b, 'real project drag moves the project');
  assert.match(await page.locator('#inspector').innerText(), /Фотопроект/);
  await page.locator('#toast').getByRole('button', { name: 'Отменить перенос' }).click();
  assert.equal(await domain(), ids.a);
  await page.getByRole('combobox', { name: 'Перенести проект в сферу' }).selectOption(ids.b);
  await page.getByRole('button', { name: 'Перенести проект', exact: true }).click();
  await page.waitForTimeout(350);
  mkdirSync('output/map-attention', { recursive: true });
  await page.screenshot({ path: 'output/map-attention/project-transfer.png', animations: 'disabled' });
  await page.reload();
  assert.equal(await domain(), ids.b);
  assert.deepEqual(errors, []);
  console.log('PASS project browser: Inspector, related material, real drag, undo, reload');
} finally { await browser.close(); await closeAll(server); }
