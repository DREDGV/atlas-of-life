// Map hit hierarchy regression (0.13.x, M-04b): a click must resolve to the
// object the user sees, not to whichever node the layout happened to push last.
//
// A task orb inside a Project inside a Domain is three nested territories at one
// point. The rules under test:
//   1. a click on an orb selects that task, never its Project or Domain;
//   2. a click on empty Project territory selects the Project;
//   3. a click on an orb of the "Без проекта" group selects the task;
//   4. a click on empty space selects nothing.
// Runs a real Chromium against the real app.
//
// Opt-in: needs the Playwright browser package, which is not a dependency of
// this repository (there is no package.json by design). It reports itself as
// skipped rather than failing when the browser is unavailable, so
// `tools/verify-baseline.ps1` and CI stay green without it.
import assert from 'node:assert/strict';
import { startStaticServer, closeAll } from '../tools/smoke-shared.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('⏭  map hit hierarchy tests skipped: playwright is not installed');
  process.exit(0);
}

const { server, origin } = await startStaticServer();
let browser = null;
try {
  browser = await chromium.launch({ headless: true });
} catch (error) {
  console.log(`⏭  map hit hierarchy tests skipped: headless Chromium unavailable (${error.message.split('\n')[0]})`);
  await closeAll({ server });
  process.exit(0);
}

const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
const page = await context.newPage();
const failures = [];
page.on('pageerror', error => failures.push(error.message));

try {
  await page.goto(origin, { waitUntil: 'networkidle' });
  // Seed through Core commands, as the architecture requires.
  await page.evaluate(async () => {
    const { createDomain, createProject, createTask } = await import('/js/core/commands.js');
    const home = createDomain({ title: 'Дом' }).id;
    const dacha = createProject({ title: 'Дача', domainId: home }).id;
    ['Починить теплицу', 'Полить грядки', 'Укрыть розы'].forEach((title, index) =>
      createTask({ title, projectId: dacha, domainId: home, priority: index + 1 }));
    ['Разобрать входящие', 'Позвонить в сервис'].forEach(title =>
      createTask({ title, domainId: home, priority: 2 }));
  });
  await page.waitForTimeout(600);

  const snapshot = await page.evaluate(async () => {
    const map = await import('/js/view_map.js');
    // The map rebuilds its layout on the next frame after a Core command, so
    // the snapshot would race it. Rebuilding explicitly makes the seed visible
    // before anything is measured. Node objects keep their `_type` field, the
    // same one the renderer and the hit test use.
    map.layoutMap();
    const snap = map.getLayoutSnapshot();
    return {
      scale: snap.scale,
      size: snap.size,
      nodes: snap.nodes.map(n => ({ id: n.id, _type: n._type, title: n.title, x: n.x, y: n.y, r: n.r, parent: n.parent, domainId: n.domainId, groupId: n.groupId })),
    };
  });

  const project = snapshot.nodes.find(n => n._type === 'project');
  const domain = snapshot.nodes.find(n => n._type === 'domain');
  const projectTasks = snapshot.nodes.filter(n => n._type === 'task' && !n.groupId);
  assert.ok(project && domain, 'the seed must produce a Domain and a Project');
  assert.ok(projectTasks.length >= 3, `the seed must put tasks inside the Project (got ${projectTasks.length})`);

  const resolve = (x, y) => page.evaluate(async ({ px, py }) => {
    const map = await import('/js/view_map.js');
    return map.resolveHit(px, py);
  }, { px: x, py: y });

  // 1. The centre of an orb inside a Project must resolve to that task.
  let checked = 0;
  for (const task of projectTasks) {
    const hit = await resolve(task.x, task.y);
    assert.ok(hit, `a click at the centre of "${task.title}" must hit something`);
    assert.equal(hit.type, 'task', `a click at the centre of "${task.title}" resolved to ${hit.type} instead of the task`);
    assert.equal(hit.id, task.id, `a click at the centre of "${task.title}" resolved to a different object`);
    checked++;
  }
  console.log(`✓ Test 1: ${checked} task orbs inside a Project resolve to their task, not to the Project or Domain`);

  // 2. Empty Project territory (inside the Project circle, away from every orb)
  //    must resolve to the Project — that is what the drawn circle means.
  const emptyProjectPoints = await page.evaluate(async () => {
    const map = await import('/js/view_map.js');
    const snap = map.getLayoutSnapshot();
    const project = snap.nodes.find(n => n._type === 'project');
    const dpr = snap.size.dpr;
    // The same effective radius the hit test uses (see hitRadius in view_map.js),
    // so "empty" means empty for the pointer, not just for the eye.
    const targetRadius = (node) => {
      if (node._type === 'task') return node.r + Math.max((26 * dpr) / Math.max(0.2, snap.scale), node.r * 0.6);
      if (node._type === 'project') return node.r + 10 * dpr;
      return node.r;
    };
    // The snapshot inside this evaluate is a fresh clone, so the Project is
    // identified by id: comparing object identity would leave the Project in
    // `others`, and every sampled point would then be "occupied" by the very
    // territory under test.
    const others = snap.nodes.filter(n => n.id !== project.id && n._type !== 'domain');
    // Empty Project territory: scanned outwards along many directions, keeping
    // only points the pointer would not attribute to another object.
    const clearAt = (x, y) => others.every(other => Math.hypot(x - other.x, y - other.y) > targetRadius(other));
    const points = [];
    for (let step = 0; step < 48 && points.length < 3; step++) {
      const angle = (step / 48) * Math.PI * 2;
      for (let fraction = 0.05; fraction <= 0.95; fraction += 0.05) {
        const x = project.x + Math.cos(angle) * project.r * fraction;
        const y = project.y + Math.sin(angle) * project.r * fraction;
        if (clearAt(x, y)) { points.push({ x, y }); break; }
      }
    }
    return points;
  });
  assert.ok(emptyProjectPoints.length > 0, `the Project must have empty territory to test ${JSON.stringify({
    project: { x: Math.round(project.x), y: Math.round(project.y), r: Math.round(project.r) },
    tasks: snapshot.nodes.filter(n => n._type === 'task').map(n => ({ title: n.title, x: Math.round(n.x), y: Math.round(n.y), r: Math.round(n.r) })),
    scale: snapshot.scale,
    size: snapshot.size,
  })}`);
  for (const point of emptyProjectPoints) {
    const hit = await resolve(point.x, point.y);
    assert.ok(hit, 'empty Project territory must still belong to the Project');
    assert.equal(hit.type, 'project', `empty Project territory resolved to ${hit.type} instead of the Project`);
    assert.equal(hit.id, project.id, 'empty Project territory resolved to another Project');
  }
  console.log(`✓ Test 2: empty Project territory resolves to the Project (${emptyProjectPoints.length} sampled points)`);

  // 3. Group orbs ("Без проекта") resolve to their task, not to the group.
  const groupOrbs = snapshot.nodes.filter(n => n._type === 'task' && n.groupId && n.groupId.startsWith('unassigned:'));
  assert.ok(groupOrbs.length > 0, 'the seed must produce a packed group');
  for (const task of groupOrbs) {
    const hit = await resolve(task.x, task.y);
    assert.ok(hit, `a click at the centre of "${task.title}" must hit something`);
    assert.equal(hit.type, 'task', `a click at the centre of a group orb resolved to ${hit.type}`);
    assert.equal(hit.id, task.id, 'a click at the centre of a group orb resolved to another object');
  }
  console.log(`✓ Test 3: ${groupOrbs.length} orbs of the "Без проекта" group resolve to their task`);

  // 4. Far outside every territory nothing is selected: clicking the void must
  //    clear the selection rather than pick a distant object.
  const voidPoint = { x: domain.x + domain.r + 2000, y: domain.y + domain.r + 2000 };
  const miss = await resolve(voidPoint.x, voidPoint.y);
  assert.equal(miss, null, `empty space must resolve to nothing, got ${miss && miss.type}`);
  console.log('✓ Test 4: empty space resolves to nothing, so a click there clears the selection');

  // 5. The same question through a real click: the Inspector must show a task,
  //    not a Project, when the pointer lands on an orb inside a Project.
  const target = projectTasks[0];
  const screen = await page.evaluate(async ({ x, y }) => {
    const map = await import('/js/view_map.js');
    const snap = map.getLayoutSnapshot();
    const rect = document.getElementById('canvas').getBoundingClientRect();
    return {
      x: rect.left + (x * snap.scale + snap.tx) / snap.size.dpr,
      y: rect.top + (y * snap.scale + snap.ty) / snap.size.dpr,
    };
  }, { x: target.x, y: target.y });
  await page.mouse.click(screen.x, screen.y);
  await page.waitForTimeout(250);
  const inspectorText = await page.evaluate(() => document.getElementById('inspector').innerText);
  assert.ok(
    inspectorText.includes(target.title),
    `a real click on the orb must open that task in the Inspector (got: ${inspectorText.slice(0, 80)})`,
  );
  console.log('✓ Test 5: a real click on an orb opens that task in the Inspector');

  assert.deepEqual(failures, [], `no page errors expected: ${failures.join('; ')}`);
  console.log('\n✅ All map hit hierarchy tests passed.');
} finally {
  await browser.close();
  await closeAll({ server });
}
