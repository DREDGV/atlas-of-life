// 0.13.0-alpha.1 — Today 2.0 / Day Plan Foundation vertical slice.
// Real browser, fresh profile, loopback static server, Core-seeded test data.
// DoD: backlog → select today → focus → complete another → reload →
// next-day rollover (leftover, not auto-today) → carry → due unchanged.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startStaticServer } from './smoke-shared.mjs';
import { localDay } from '../js/features/today/model.js';

const dayOffset = (offset = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return localDay(date);
};
const today = dayOffset(0);
const yesterday = dayOffset(-1);

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

  assert.deepEqual(errors, []);
  await page.screenshot({ path: 'output/playwright/today-plan.png' });
  console.log('Browser PASS: backlog → today → focus → complete → reload → rollover leftover → carry, due unchanged.');
} finally {
  await browser?.close();
  server.server.close();
}
