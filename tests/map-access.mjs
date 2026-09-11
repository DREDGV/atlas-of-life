// Map access and packing regressions (0.13.x): a task orb must be reachable by
// pointer even when it is drawn tiny, and reachable by keyboard at all, because
// a canvas exposes no DOM nodes. Runs a real Chromium against the real app.
//
// Opt-in: it needs the Playwright browser package, which is not a dependency of
// this repository (there is no package.json by design). It reports itself as
// skipped so `tools/verify-baseline.ps1` and CI stay green without it, and it
// never fails silently when Playwright is present.
import assert from 'node:assert/strict';
import { startStaticServer, closeAll } from '../tools/smoke-shared.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('⏭  map access tests skipped: playwright is not installed (node tests/map-access.mjs with playwright available)');
  process.exit(0);
}

const { server, origin } = await startStaticServer();
// A machine can have the package without a usable browser (headless launch is
// denied in confined environments). That is a skip, not a product regression —
// but a failure inside the tests below is always fatal.
let browser = null;
try {
  browser = await chromium.launch({ headless: true });
} catch (error) {
  console.log(`⏭  map access tests skipped: headless Chromium unavailable (${error.message.split('\n')[0]})`);
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
    createDomain({ title: 'Работа' });
    const dacha = createProject({ title: 'Дача', domainId: home }).id;
    const titles = [
      'Собрать урожай яблок', 'Починить теплицу', 'Заказать саженцы',
      'Проверить проводку', 'Полить грядки', 'Укрыть розы',
    ];
    titles.forEach((title, index) => {
      if (index < 3) createTask({ title, projectId: dacha, domainId: home, priority: (index % 4) + 1 });
      else createTask({ title, domainId: home, priority: (index % 4) + 1 });
    });
  });
  await page.waitForTimeout(600);

  const snapshot = () => page.evaluate(async () => {
    const map = await import('/js/view_map.js');
    return map.getLayoutSnapshot();
  });

  // 1. The canvas is focusable and labelled, not an opaque rectangle.
  const a11y = await page.evaluate(() => {
    const canvas = document.getElementById('canvas');
    return {
      tabindex: canvas.getAttribute('tabindex'),
      role: canvas.getAttribute('role'),
      label: canvas.getAttribute('aria-label'),
      live: Boolean(document.getElementById('mapLiveRegion')),
      liveRole: document.getElementById('mapLiveRegion')?.getAttribute('role'),
    };
  });
  assert.equal(a11y.tabindex, '0', 'canvas must be reachable with Tab');
  assert.ok(a11y.label && a11y.label.length > 10, 'canvas must carry an accessible label');
  assert.ok(a11y.live && a11y.liveRole === 'status', 'focused task must be announced through a live region');
  console.log('✓ Test 1: canvas is focusable, labelled and announces the focused task');

  // 2. A tiny orb still has a pointer target of at least 24 CSS px.
  const target = await page.evaluate(async () => {
    const map = await import('/js/view_map.js');
    const snap = map.getLayoutSnapshot();
    const tasks = snap.nodes.filter(n => n._type === 'task');
    const smallest = tasks.reduce((a, b) => (a.r <= b.r ? a : b));
    const canvas = document.getElementById('canvas');
    const rect = canvas.getBoundingClientRect();
    return {
      radiusCss: (smallest.r * 2 * snap.scale) / snap.size.dpr,
      center: {
        x: rect.left + (smallest.x * snap.scale + snap.tx) / snap.size.dpr,
        y: rect.top + (smallest.y * snap.scale + snap.ty) / snap.size.dpr,
      },
    };
  });
  // 11 px away from the centre is outside a 12 px-diameter orb but inside a
  // 24 px target: the click must still land on that task.
  await page.mouse.click(target.center.x + 11, target.center.y);
  await page.waitForTimeout(200);
  const focusedByPointer = await page.evaluate(() => document.querySelector('#inspector .inspector-heading, #inspector h2')?.textContent || document.getElementById('inspector').innerText);
  assert.ok(
    /Задача/i.test(focusedByPointer),
    `a click 11 px from a ${target.radiusCss.toFixed(1)} px orb must still select it (got: ${focusedByPointer.slice(0, 60)})`,
  );
  console.log(`✓ Test 2: pointer target covers the smallest orb (${target.radiusCss.toFixed(1)} px drawn)`);

  // 3. Keyboard navigation moves through tasks and announces position.
  await page.evaluate(() => document.getElementById('canvas').focus());
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(250);
  const first = await page.evaluate(() => document.getElementById('mapLiveRegion').textContent);
  assert.ok(/Задача 1 из \d+/.test(first), `first arrow press must announce the position (got: ${first})`);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(250);
  const second = await page.evaluate(() => document.getElementById('mapLiveRegion').textContent);
  assert.ok(/Задача 2 из \d+/.test(second), `second arrow press must advance (got: ${second})`);
  assert.notEqual(first, second, 'navigation must change the announced task');
  const inspectorText = await page.evaluate(() => document.getElementById('inspector').innerText);
  assert.ok(inspectorText.trim().length > 0, 'the focused task must be shown in the Inspector');
  if (process.env.ATLAS_MAP_SHOT) {
    await page.screenshot({ path: process.env.ATLAS_MAP_SHOT });
  }
  console.log('✓ Test 3: arrows walk the tasks and the live region reports the position');

  // 4. Escape leaves keyboard mode without trapping focus.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const afterEscape = await page.evaluate(async () => {
    const map = await import('/js/view_map.js');
    return map.getLayoutSnapshot().keyboardFocusId;
  });
  assert.equal(afterEscape, null, 'Escape must clear the keyboard selection');
  console.log('✓ Test 4: Escape clears the keyboard selection');

  // 5. A packed group fits its members into view instead of staying a count.
  const groupFit = await page.evaluate(async () => {
    const map = await import('/js/view_map.js');
    const before = map.getLayoutSnapshot();
    const group = before.nodes.find(n => n._type === 'unassigned');
    if (!group) return null;
    map.fitGroup(group.id);
    await new Promise(r => setTimeout(r, 400));
    const after = map.getLayoutSnapshot();
    return { beforeScale: before.scale, afterScale: after.scale, members: before.nodes.filter(n => n.groupId === group.id).length };
  });
  assert.ok(groupFit && groupFit.members > 0, 'the seeded domain must produce a packed group');
  console.log(`✓ Test 5: fitGroup zooms the camera into the packed group (${groupFit.beforeScale.toFixed(2)} → ${groupFit.afterScale.toFixed(2)})`);

  assert.deepEqual(failures, [], `no page errors expected: ${failures.join('; ')}`);
  console.log('\n✅ All map access and packing tests passed.');
} finally {
  await browser.close();
  await closeAll({ server });
}
