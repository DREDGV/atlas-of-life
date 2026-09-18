// Map lenses and search (0.13.x, M-09/M-10): a lens answers one question about
// the whole map, and search names the task the user is looking for.
//
// The rules under test:
//   1. a lens never deletes or moves work — it changes emphasis and the count;
//   2. "Срок" finds what is due today or already overdue, and ignores done tasks;
//   3. "Фокус" finds exactly today's Focus and nothing else;
//   4. "Застой" finds tasks with no movement for a month;
//   5. "Готово" finds finished tasks, which every other lens excludes;
//   6. search matches title, tag and project name, and can find a task by a
//      half-remembered word;
//   7. the choice lives for the session only: it is not written to storage.
// Runs a real Chromium against the real app.
//
// Opt-in: needs the Playwright browser package, which is not a dependency of
// this repository (there is no package.json by design). It reports itself as
// skipped rather than failing when the browser is unavailable.
import assert from 'node:assert/strict';
import { startStaticServer, closeAll } from '../tools/smoke-shared.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('⏭  map lens tests skipped: playwright is not installed');
  process.exit(0);
}

const { server, origin } = await startStaticServer();
let browser = null;
try {
  browser = await chromium.launch({ headless: true });
} catch (error) {
  console.log(`⏭  map lens tests skipped: headless Chromium unavailable (${error.message.split('\n')[0]})`);
  await closeAll({ server });
  process.exit(0);
}

const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: 'ru-RU' });
const page = await context.newPage();
const failures = [];
page.on('pageerror', error => failures.push(error.message));

const emphasis = () => page.evaluate(async () => {
  const map = await import('/js/view_map.js');
  return map.getTaskEmphasisList();
});
const filterState = () => page.evaluate(async () => {
  const map = await import('/js/view_map.js');
  return map.getMapFilterState();
});
const applyFilter = (options) => page.evaluate(async (opts) => {
  const map = await import('/js/view_map.js');
  return map.setMapFilter(opts);
}, options);

try {
  await page.goto(origin, { waitUntil: 'networkidle' });
  const seeded = await page.evaluate(async () => {
    const { createDomain, createProject, createTask, updateTask } = await import('/js/core/commands.js');
    const { localDay, shiftDay } = await import('/js/features/today/model.js');
    const today = localDay();
    const home = createDomain({ title: 'Дом' }).id;
    const dacha = createProject({ title: 'Дача', domainId: home }).id;
    const make = (title, extra) => createTask({ title, projectId: dacha, domainId: home, ...extra }).id;
    const overdue = make('Купить плитку', { due: { date: shiftDay(today, -2), time: null }, tags: ['ремонт'] });
    const dueToday = make('Полить грядки', { due: { date: today, time: null } });
    const planned = make('Собрать урожай', { tags: ['сад'] });
    const focus = make('Починить теплицу', { tags: ['сад'] });
    const stale = make('Разобрать старый ящик', {});
    const done = make('Заказать саженцы', {});
    updateTask(focus, { status: 'today', focus: true, plannedDay: today });
    updateTask(planned, { plannedDay: today });
    updateTask(done, { status: 'done' });
    // 45 days without movement: older than the 30-day stale threshold.
    const { state } = await import('/js/state.js');
    const staleTask = state.tasks.find(task => task.id === stale);
    staleTask.updatedAt = Date.now() - 45 * 86400000;
    return { overdue, dueToday, planned, focus, stale, done, today };
  });
  await page.waitForTimeout(400);

  // 0. No lens, no search: everything is drawn at full strength.
  await applyFilter({ lens: 'all', query: '' });
  const clean = await filterState();
  assert.equal(clean.active, false, 'the default view has no filter active');
  assert.equal(clean.total, 6, `all six tasks are on the map (got ${clean.total})`);
  assert.equal(clean.matching, 6, 'without a lens every task matches');
  console.log('✓ Test 0: without a lens every task is emphasised and counted');

  // 1/2. "Срок" — due today or overdue, and never a finished task. A task with a
  // plan for today counts as due today; that is what the plan means.
  await applyFilter({ lens: 'due' });
  const due = await filterState();
  assert.equal(due.matching, 4,
    `Срок finds the overdue, the due-today and both tasks planned for today (got ${due.matching})`);
  const dueEmphasis = await emphasis();
  const faded = dueEmphasis.filter(item => item.alpha < 1).map(item => item.id).sort();
  assert.deepEqual(faded.sort(), [seeded.stale, seeded.done].sort(),
    'a lens recedes the tasks it did not ask about, and never deletes them');
  console.log('✓ Test 1/2: "Срок" emphasises 4 tasks, recedes the rest, removes nothing');

  // 3. "Фокус" — exactly today's Focus.
  await applyFilter({ lens: 'focus' });
  assert.equal((await filterState()).matching, 1, '"Фокус" finds exactly one task');
  const focusEmphasis = await emphasis();
  assert.equal(focusEmphasis.find(item => item.id === seeded.focus).alpha, 1, 'the Focus task is emphasised');
  assert.equal(focusEmphasis.find(item => item.id === seeded.dueToday).alpha < 1, true, 'a due task is not the Focus');
  console.log('✓ Test 3: "Фокус" finds the Focus task and recedes the rest');

  // 4. "Застой" — no movement for 30+ days.
  await applyFilter({ lens: 'stale' });
  assert.equal((await filterState()).matching, 1, '"Застой" finds the task that went quiet');
  const staleEmphasis = await emphasis();
  assert.equal(staleEmphasis.find(item => item.id === seeded.stale).alpha, 1, 'the quiet task is emphasised');
  console.log('✓ Test 4: "Застой" finds the task untouched for 45 days');

  // 5. "Готово" — finished work, excluded by every other lens.
  await applyFilter({ lens: 'done' });
  assert.equal((await filterState()).matching, 1, '"Готово" finds the finished task');
  assert.equal((await emphasis()).find(item => item.id === seeded.done).alpha, 0.55,
    'a finished task keeps its own dimming, not the lens dimming');
  console.log('✓ Test 5: "Готово" finds finished work alone');

  // 6. Search — by word, by tag, and by project name.
  await applyFilter({ lens: 'all', query: 'теплиц' });
  assert.equal((await filterState()).matching, 1, 'search finds a half-remembered word');
  const byWord = await emphasis();
  assert.equal(byWord.find(item => item.id === seeded.focus).alpha, 1, 'the found task is emphasised');
  await applyFilter({ query: 'сад' });
  assert.equal((await filterState()).matching, 2, 'search matches a tag');
  await applyFilter({ query: 'дача' });
  assert.equal((await filterState()).matching, 6, 'search matches the project name of every task in it');
  await applyFilter({ query: '' });
  assert.equal((await filterState()).matching, 6, 'clearing the search returns the whole map');
  console.log('✓ Test 6: search matches title, tag and project name, and clears');

  // 7. The lens is a session view: it must not be persisted.
  await applyFilter({ lens: 'stale', query: 'ящик' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const afterReload = await filterState();
  assert.equal(afterReload.lens, 'all', 'a lens is not remembered across a reload');
  assert.equal(afterReload.query, '', 'a search is not remembered across a reload');
  assert.equal(afterReload.active, false, 'after a reload the map shows everything again');
  console.log('✓ Test 7: lenses and search stay in the session and are never persisted');

  assert.deepEqual(failures, [], `no page errors expected: ${failures.join('; ')}`);
  console.log('\n✅ All map lens and search tests passed.');
} finally {
  await browser.close();
  await closeAll({ server });
}
