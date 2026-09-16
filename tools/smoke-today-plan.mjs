// 0.13.0-alpha.1/alpha.2 — Today 2.0 / day plan foundation and planning ahead.
// Real browser, fresh profile, loopback static server, Core-seeded test data.
// DoD: backlog → select today → focus → complete another → reload →
// next-day rollover (leftover, not auto-today) → carry → due unchanged,
// then forward planning: plan for tomorrow → it waits as a plan →
// tomorrow shows it as its own plan → capacity follows the selected day.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startStaticServer } from './smoke-shared.mjs';
import { localDay, shiftDay } from '../js/features/today/model.js';

const dayOffset = (offset = 0) => shiftDay(localDay(), offset);
const today = dayOffset(0);
const yesterday = dayOffset(-1);
const tomorrow = dayOffset(1);

const server = await startStaticServer();
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(server.origin);

  // Seed test data through Core commands (no direct state mutation).
  await page.evaluate(async ({ yesterday }) => {
    const { state } = await import('/js/state.js');
    const { createDomain, createTask } = await import('/js/core/commands.js');
    if (!state.domains.length) createDomain({ title: 'Дом' });
    const domainId = state.domains[0].id;
    createTask({ id: 't-overdue', title: 'Просроченная задача', domainId, due: { date: yesterday, time: null } });
    createTask({ id: 't-extra', title: 'Другая задача на сегодня', domainId, status: 'today' });
  }, { yesterday });

  const gotoToday = () => page.locator('.chip[data-view="today"]').click();
  await gotoToday();

  // Backlog (overdue, unplanned) → select for today.
  const deadlines = page.locator('[data-today-group="deadlines"] .todo');
  assert.equal(await deadlines.count(), 1, 'overdue unplanned task is a deadline signal');
  await deadlines.getByRole('button', { name: 'Выбрать на сегодня' }).click();
  const planned = page.locator('[data-today-group="planned"] .todo');
  assert.equal(await planned.count(), 2, 'selected task joins today plan');

  // Focus the carried-over task.
  await planned.filter({ hasText: 'Просроченная задача' }).getByRole('button', { name: 'В фокус' }).click();
  assert.equal(await page.locator('[data-today-group="focus"] .todo').count(), 1, 'focus holds one task');

  // Complete the other task.
  await planned.filter({ hasText: 'Другая задача' }).getByRole('button', { name: 'Выполнено' }).click();
  assert.equal(await page.locator('[data-today-group="completed"] .todo').count(), 1, 'completed today');

  // Reload: state persisted.
  await page.reload();
  await gotoToday();
  const afterReload = await page.evaluate(async () => {
    const { state } = await import('/js/state.js');
    const t = state.tasks.find(item => item.id === 't-overdue');
    const extra = state.tasks.find(item => item.id === 't-extra');
    return { plannedDay: t.plannedDay, focus: t.focus, status: extra.status, completedAt: !!extra.completedAt };
  });
  assert.equal(afterReload.plannedDay, today, 'plannedDay persisted');
  assert.equal(afterReload.focus, true, 'focus persisted');
  assert.equal(afterReload.status, 'done', 'completion persisted');
  assert.equal(afterReload.completedAt, true, 'completedAt persisted');

  // Next-day rollover: move the unfinished task back to yesterday via Core.
  await page.evaluate(async ({ yesterday }) => {
    const { updateTask } = await import('/js/core/commands.js');
    updateTask('t-overdue', { plannedDay: yesterday });
  }, { yesterday });
  await gotoToday();
  assert.equal(await page.locator('[data-today-group="leftover"] .todo').count(), 1, 'yesterday task is a leftover');
  assert.equal(await page.locator('[data-today-group="planned"] .todo').count(), 0, 'leftover is not auto-planned for today');

  // Manual decision: carry it to today.
  await page.locator('[data-today-group="leftover"] .todo').getByRole('button', { name: 'Перенести на сегодня' }).click();
  assert.equal(await page.locator('[data-today-group="leftover"] .todo').count(), 0);
  assert.equal(await page.locator('[data-today-group="planned"] .todo').count(), 1, 'carried task joins today plan');

  const dueAfter = await page.evaluate(async () => {
    const { state } = await import('/js/state.js');
    return state.tasks.find(item => item.id === 't-overdue').due.date;
  });
  assert.equal(dueAfter, yesterday, 'due unchanged through the whole flow');

  // --- Forward planning (0.13.0-alpha.2) -----------------------------------
  const carriedCapacity = await page.evaluate(async () => {
    const { state } = await import('/js/state.js');
    const { dayCapacity, localDay } = await import('/js/features/today/model.js');
    return dayCapacity(state.tasks, localDay());
  });
  assert.equal(carriedCapacity.count, 1, 'today capacity counts the plan for the selected day');

  // Plan a task for tomorrow from the Inspector: it waits as a plan.
  const targets = await page.evaluate(async () => {
    const { state } = await import('/js/state.js');
    const { dayView, localDay } = await import('/js/features/today/model.js');
    return dayView(state.tasks, localDay()).planned.map(task => task.id);
  });
  assert.equal(targets.length, 1, 'one task is planned for today before planning ahead');
  await page.evaluate(async (id) => {
    const { state } = await import('/js/state.js');
    const { openInspectorFor } = await import('/js/inspector.js');
    openInspectorFor({ ...state.tasks.find(task => task.id === id), _type: 'task' });
  }, targets[0]);
  await page.locator('#inspector #planTomorrow').click();
  const plannedTomorrow = await page.evaluate(async (id) => {
    const { state } = await import('/js/state.js');
    const task = state.tasks.find(item => item.id === id);
    return { plannedDay: task.plannedDay, status: task.status, focus: task.focus, due: task.due?.date ?? null };
  }, targets[0]);
  assert.equal(plannedTomorrow.plannedDay, tomorrow, 'Inspector plans a task for tomorrow');
  assert.equal(plannedTomorrow.status, 'backlog', 'a plan for tomorrow is not today work');
  assert.equal(plannedTomorrow.focus, false, 'a future plan never holds the focus');
  assert.equal(plannedTomorrow.due, yesterday, 'planning ahead leaves the deadline exactly where it was');

  // Today sees it as a future plan, not as today's plan.
  await page.locator('.chip[data-view="map"]').click();
  await page.locator('.chip[data-view="today"]').click();
  assert.equal(await page.locator('[data-today-group="planned"] .todo').count(), 0,
    'the plan moved to tomorrow is no longer today plan');
  assert.equal(await page.locator('[data-today-group="ahead"] .todo').count(), 1,
    'today shows what is planned for the following days');
  const todayCapacity = await page.evaluate(async () => {
    const { state } = await import('/js/state.js');
    const { dayCapacity, localDay } = await import('/js/features/today/model.js');
    return dayCapacity(state.tasks, localDay());
  });
  assert.equal(todayCapacity.count, 0, 'moving the plan forward frees today capacity');

  // Tomorrow: the same task is that day's own plan, and focus is not offered.
  await page.locator('.today-nav button[aria-label="Следующий день"]').click();
  assert.equal(await page.locator('.today-day').getAttribute('data-today-day'), tomorrow);
  assert.equal(await page.locator('[data-today-group="planned"] .todo').count(), 1,
    'tomorrow shows the task planned for tomorrow');
  assert.equal(await page.locator('[data-today-group="focus"]').count(), 0,
    'a day that has not arrived has no focus group');
  assert.equal(await page.locator('.today-capacity').getAttribute('data-over'), 'false');

  // Plan for today from tomorrow's screen, and come back.
  await page.locator('[data-today-group="planned"] .todo').getByRole('button', { name: 'На сегодня' }).click();
  assert.equal(await page.locator('[data-today-group="planned"] .todo').count(), 0);
  await page.locator('.today-nav button[aria-label="Предыдущий день"]').click();
  assert.equal(await page.locator('.today-day').getAttribute('data-today-day'), today);
  assert.equal(await page.locator('[data-today-group="planned"] .todo').count(), 1,
    'the task planned back for today appears in today plan');
  assert.equal(await page.locator('[data-today-group="ahead"] .todo').count(), 0);

  // Capacity reflects the sizes that are actually known.
  const capacityLine = await page.locator('.today-capacity').textContent();
  assert.match(capacityLine, /В плане: 1 задача/, 'capacity line states the size of the plan');

  assert.deepEqual(errors, []);
  await page.screenshot({ path: 'output/playwright/today-plan.png' });
  await page.locator('.today-nav button[aria-label="Следующий день"]').click();
  await page.screenshot({ path: 'output/playwright/today-forward-plan.png' });
  console.log('Browser PASS: backlog → today → focus → complete → reload → rollover leftover → carry, due unchanged; plan for tomorrow waits as a plan, tomorrow shows it as its own plan, capacity follows the day.');
} finally {
  await browser?.close();
  server.server.close();
}
