import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { closeAll, startStaticServer } from './smoke-shared.mjs';

const server = await startStaticServer();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport:{ width:1440, height:960 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const out = 'output/task-drag';
await mkdir(out, { recursive:true });
const feedback = page.locator('#mapTaskMove');
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('atlas_v2_data')));

async function drag(task, destination, emptySphere = false) {
  await page.evaluate(() => window.mapApi.fitAll());
  await page.waitForTimeout(320);
  const points = await page.evaluate(async ({ task, destination, emptySphere }) => {
    const { getLayoutSnapshot, resolveHit } = await import('/js/view_map.js');
    const { containsTerritory } = await import('/js/features/map/geometry.js');
    const s = getLayoutSnapshot();
    const rect = document.getElementById('canvas').getBoundingClientRect();
    const source = s.nodes.find(node => node.id === task);
    const target = s.nodes.find(node => node.id === destination);
    const at = ({ x, y }) => ({ x:rect.x + (x * s.scale + s.tx) / s.size.dpr, y:rect.y + (y * s.scale + s.ty) / s.size.dpr });
    let point = target;
    if (emptySphere) {
      for (let i = 0; i < 32; i++) {
        const angle = i * Math.PI / 16;
        const candidate = { x:target.x + Math.cos(angle)*target.r*.8, y:target.y + Math.sin(angle)*target.r*.8 };
        const screen = at(candidate);
        if (screen.y < rect.y + 160 || screen.y > rect.bottom - 80) continue;
        if (s.nodes.some(node => node._type === 'project' && containsTerritory(node, candidate.x, candidate.y, s.size.dpr))) continue;
        point = candidate;
        break;
      }
      if (point === target) throw new Error('No empty space in target sphere');
    }
    if (resolveHit(source.x, source.y)?.id !== task) throw new Error('Task hit target is missing');
    return { start:at(source), end:at(point) };
  }, { task, destination, emptySphere });
  await page.mouse.move(points.start.x, points.start.y);
  await page.mouse.down();
  await page.mouse.move(points.end.x, points.end.y, { steps:18 });
  await feedback.getByText('Отпустите, чтобы перенести', { exact:true }).waitFor({ timeout:5000 });
}

try {
  await page.goto(server.origin);
  const ids = await page.evaluate(async () => {
    const c = await import('/js/core/commands.js');
    const home = c.createDomain({ title:'Дом', color:'#2dd4bf' });
    const shop = c.createDomain({ title:'Мастерская', color:'#a78bfa' });
    const before = c.createProject({ title:'Скрытый люк', domainId:home.id });
    const after = c.createProject({ title:'Печать деталей', domainId:shop.id });
    const [source] = c.captureInbox('Подобрать петли', { itemType:'task' });
    const { task } = c.routeInboxToTask(source.id, { projectId:before.id, due:{ date:'2030-04-06', time:'17:00' } });
    const [noteSource] = c.captureInbox('Маркировка петли 34 мм', { itemType:'note' });
    const { material } = c.routeInboxToKnowledge(noteSource.id, { projectId:before.id });
    const linked = c.createTaskFromKnowledge(material.id, { title:'Измерить посадку' });
    const neighbour = c.createTask({ title:'Подобрать цвет', projectId:after.id });
    return { home:home.id, shop:shop.id, before:before.id, after:after.id, source:source.id, note:material.id,
      task:task.id, neighbour:neighbour.id, linked:linked.id };
  });

  await drag(ids.task, ids.neighbour);
  assert.equal(await feedback.getAttribute('data-domain-id'), ids.shop);
  assert.equal(await feedback.getAttribute('data-project-id'), ids.after);
  assert.match(await feedback.innerText(), /Мастерская → Печать деталей/);
  await page.screenshot({ path:`${out}/destination.png` });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.equal((await stored()).tasks.find(item => item.id === ids.task).projectId, ids.before);
  assert.equal(await feedback.isVisible(), false);

  await drag(ids.task, ids.neighbour);
  await page.mouse.up();
  assert.match(await feedback.innerText(), /Было\s+Дом → Скрытый люк\s+Стало\s+Мастерская → Печать деталей/);
  assert.equal((await stored()).tasks.find(item => item.id === ids.task).projectId, ids.after);
  await page.waitForTimeout(320);
  await page.screenshot({ path:`${out}/moved.png` });
  await feedback.getByRole('button', { name:'Отменить', exact:true }).click();
  assert.match(await feedback.innerText(), /Перенос отменён/);
  assert.equal((await stored()).tasks.find(item => item.id === ids.task).projectId, ids.before);

  await drag(ids.linked, ids.shop, true);
  assert.match(await feedback.innerText(), /Мастерская → Без проекта/);
  await page.mouse.up();
  await drag(ids.task, ids.neighbour);
  await page.mouse.up();
  await page.reload();
  const state = await stored();
  assert.equal(state.tasks.find(item => item.id === ids.task).projectId, ids.after);
  assert.equal(state.tasks.find(item => item.id === ids.task).sourceInboxId, ids.source);
  assert.equal(state.tasks.find(item => item.id === ids.task).due.time, '17:00');
  assert.equal(state.inbox.find(item => item.id === ids.source).resultRef.id, ids.task);
  assert.equal(state.inbox.find(item => item.id === ids.source).rawText, 'Подобрать петли');
  assert.equal(state.tasks.find(item => item.id === ids.linked).domainId, ids.shop);
  assert.equal(state.tasks.find(item => item.id === ids.linked).projectId, null);
  assert.equal(state.tasks.find(item => item.id === ids.linked).sourceKnowledgeId, ids.note);
  assert.equal(state.knowledge.find(item => item.id === ids.note).projectId, ids.before);
  assert.ok(state.operationLog.some(item => item.type === 'task.move.undo'));
  assert.deepEqual(errors, []);
  console.log('PASS task drag: target over neighbour, project + domain, escape, visible undo, empty sphere and links after reload');
} finally {
  await browser.close();
  await closeAll(server);
}
