// Object card and territory rings (0.13.x, visual pass): the map must report the
// state of an object, not only its name.
//
// The rules under test:
//   1. hovering a task shows the card, with its place in the atlas and its age;
//   2. hovering a Project shows counts (in progress / done / overdue) and the
//      share finished — the same numbers the progress ring draws;
//   3. hovering a Domain reports the Domain's own load, not one Project's;
//   4. moving off the map hides the card, so a stale card never floats over
//      empty space;
//   5. the ring math is exposed and consistent with the card (done share).
// Runs a real Chromium against the real app.
//
// Opt-in: needs the Playwright browser package, which is not a dependency of this
// repository (there is no package.json by design); it skips rather than fails
// when the browser is unavailable.
import assert from 'node:assert/strict';
import { startStaticServer, closeAll } from '../tools/smoke-shared.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('⏭  map card tests skipped: playwright is not installed');
  process.exit(0);
}

const { server, origin } = await startStaticServer();
let browser = null;
try {
  browser = await chromium.launch({ headless: true });
} catch (error) {
  console.log(`⏭  map card tests skipped: headless Chromium unavailable (${error.message.split('\n')[0]})`);
  await closeAll({ server });
  process.exit(0);
}

const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: 'ru-RU' });
const page = await context.newPage();
const failures = [];
page.on('pageerror', error => failures.push(error.message));

try {
  await page.goto(origin, { waitUntil: 'networkidle' });
  const seeded = await page.evaluate(async () => {
    const { createDomain, createProject, createTask, updateTask } = await import('/js/core/commands.js');
    const { localDay, shiftDay } = await import('/js/features/today/model.js');
    const today = localDay();
    const home = createDomain({ title: 'Дом' }).id;
    const dacha = createProject({ title: 'Дача', domainId: home }).id;
    const make = (title, extra = {}) => createTask({ title, projectId: dacha, domainId: home, ...extra }).id;
    const early = make('Заказать саженцы', { priority: 2 });
    const late = make('Полить грядки', { priority: 2, due: { date: shiftDay(today, -4), time: null } });
    const open = make('Починить теплицу', { priority: 1 });
    updateTask(early, { status: 'done' });
    updateTask(open, { status: 'doing' });
    return { home, dacha, early, late, open };
  });

  // Hover a point that no orb covers, so the card describes the territory.
  const emptyPointOf = (kind, match) => page.evaluate(async ({ kind, match }) => {
    const map = await import('/js/view_map.js');
    const snap = map.getLayoutSnapshot();
    const node = snap.nodes.find(n => n._type === kind && (!match || (n.title || '').includes(match)));
    if (!node) return null;
    const others = snap.nodes.filter(n => n.id !== node.id && n._type !== 'domain');
    const target = (n) => (n._type === 'task' ? n.r + 30 : n.r + 14);
    let point = { x: node.x, y: node.y };
    outer: for (let step = 0; step < 48; step++) {
      const angle = (step / 48) * Math.PI * 2;
      for (let fraction = 0.9; fraction >= 0.2; fraction -= 0.05) {
        const px = node.x + Math.cos(angle) * node.r * fraction;
        const py = node.y + Math.sin(angle) * node.r * fraction;
        if (others.every(other => Math.hypot(px - other.x, py - other.y) > target(other))) {
          point = { x: px, y: py };
          break outer;
        }
      }
    }
    const rect = document.getElementById('canvas').getBoundingClientRect();
    return {
      x: rect.left + (point.x * snap.scale + snap.tx) / snap.size.dpr,
      y: rect.top + (point.y * snap.scale + snap.ty) / snap.size.dpr,
    };
  }, { kind, match });

  const centerOf = (type, title) => page.evaluate(async ({ type, title }) => {
    const map = await import('/js/view_map.js');
    const snap = map.getLayoutSnapshot();
    const node = snap.nodes.find(n => n._type === type && (n.title || '').includes(title));
    if (!node) return null;
    const rect = document.getElementById('canvas').getBoundingClientRect();
    return {
      x: rect.left + (node.x * snap.scale + snap.tx) / snap.size.dpr,
      y: rect.top + (node.y * snap.scale + snap.ty) / snap.size.dpr,
    };
  }, { type, title });

  const card = () => page.evaluate(() => {
    const host = document.getElementById('mapHud');
    return host.hidden ? null : { text: host.innerText.replace(/\s+/g, ' ').trim() };
  });

  await page.waitForTimeout(500);

  // 1. A task reports its place and its age.
  const taskPoint = await centerOf('task', 'Починить теплицу');
  assert.ok(taskPoint, 'the seeded task must be on the map');
  await page.mouse.move(taskPoint.x, taskPoint.y, { steps: 6 });
  await page.waitForTimeout(350);
  const taskCard = await card();
  assert.ok(taskCard, 'hovering a task must show the object card');
  assert.ok(taskCard.text.includes('ЗАДАЧА'), `the card must name the object type (got: ${taskCard.text.slice(0, 60)})`);
  assert.ok(taskCard.text.includes('Починить теплицу'), 'the card must name the object');
  assert.ok(taskCard.text.includes('Дом') && taskCard.text.includes('Дача'), 'the card must show where the task lives');
  assert.ok(/без движения/.test(taskCard.text), 'the card must report how long the task has been quiet');
  console.log('✓ Test 1: hovering a task shows where it lives and how long it has been quiet');

  // 2. A Project reports the load, matching the ring's numbers.
  const projectPoint = await emptyPointOf('project', 'Дача');
  assert.ok(projectPoint, 'the Project must have territory of its own to hover');
  await page.mouse.move(projectPoint.x, projectPoint.y, { steps: 6 });
  await page.waitForTimeout(350);
  const projectCard = await card();
  assert.ok(projectCard, 'hovering a Project must show the object card');
  assert.ok(projectCard.text.includes('ПРОЕКТ'), `the card must name the Project (got: ${projectCard.text.slice(0, 60)})`);
  assert.ok(projectCard.text.includes('Дача'), 'the card must name the Project it describes');
  assert.ok(/в работе/.test(projectCard.text) && /готово/.test(projectCard.text) && /просрочено/.test(projectCard.text),
    'the card must report open, done and overdue counts');
  assert.ok(/33% выполнено/.test(projectCard.text),
    `one of three tasks is finished, so the share must read 33% (got: ${projectCard.text})`);
  const stats = await page.evaluate(async (projectId) => {
    const map = await import('/js/view_map.js');
    const node = map.getLayoutSnapshot().nodes.find(n => n.id === projectId);
    return map.areaStats(node);
  }, seeded.dacha);
  assert.equal(stats.total, 3, 'the Project holds three tasks');
  assert.equal(stats.done, 1, 'one task is finished');
  assert.equal(stats.overdue, 1, 'one task missed its deadline');
  assert.equal(Math.round(stats.doneRatio * 100), 33, 'the ring draws the same share the card reports');
  console.log('✓ Test 2: a Project reports 3 tasks, 1 done, 1 overdue, 33% — and the ring agrees');

  // 3. A Domain reports its own load.
  const domainPoint = await emptyPointOf('domain', 'Дом');
  assert.ok(domainPoint, 'the Domain must have territory to hover');
  await page.mouse.move(domainPoint.x, domainPoint.y, { steps: 6 });
  await page.waitForTimeout(350);
  const domainCard = await card();
  assert.ok(domainCard && domainCard.text.includes('ДОМЕН'), 'hovering a Domain must describe the Domain');
  assert.ok(/3 задачи всего|3 задач всего/.test(domainCard.text) || /3 задач/.test(domainCard.text),
    `the Domain must count the work it holds (got: ${domainCard.text})`);
  console.log('✓ Test 3: a Domain reports the work it holds');

  // 4. Leaving the map hides the card.
  await page.mouse.move(10, 880, { steps: 6 });
  await page.waitForTimeout(350);
  assert.equal(await card(), null, 'the card must disappear when the pointer leaves the map');
  console.log('✓ Test 4: the card never lingers over empty space');

  assert.deepEqual(failures, [], `no page errors expected: ${failures.join('; ')}`);
  console.log('\n✅ All map card and ring tests passed.');
} finally {
  await browser.close();
  await closeAll({ server });
}
