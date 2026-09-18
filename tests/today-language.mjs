// 0.13.x — deadline language regressions: one source of truth for how a
// deadline reads («Сегодня» / «5 сен» / «Просрочено») and how urgent it is
// (overdue / today / soon / later), shared by Today, the map and the Inspector.
import assert from 'node:assert/strict';
import { formatDay, daysBetween, plural, statusLabel, deadlineLabel as dueLabel } from '../js/ui/status-language.js';
import { dueState } from '../js/features/today/model.js';

let passed = 0;
const check = (label, fn) => { fn(); passed++; console.log(`✓ ${label}`); };

check('formatDay: today and adjacent days are named, not numbered', () => {
  assert.equal(formatDay('2026-09-11', '2026-09-11'), 'Сегодня');
  assert.equal(formatDay('2026-09-12', '2026-09-11'), 'Завтра');
  assert.equal(formatDay('2026-09-10', '2026-09-11'), 'Вчера');
});

check('formatDay: a plain date reads as day + short month', () => {
  assert.equal(formatDay('2026-09-05', '2026-09-11'), '5 сен');
});

check('formatDay: same day-of-month in another year keeps the year', () => {
  assert.equal(formatDay('2027-09-05', '2026-09-11'), '5 сен 2027');
});

check('formatDay: month boundary is not a string comparison', () => {
  // 30 сен → 1 окт is one day apart, even though '1' < '3' as text.
  assert.equal(daysBetween('2026-09-30', '2026-10-01'), 1);
  assert.equal(formatDay('2026-10-01', '2026-09-30'), 'Завтра');
});

check('formatDay: malformed input is refused instead of guessed', () => {
  assert.equal(formatDay(null, '2026-09-11'), null);
  assert.equal(formatDay('11.09.2026', '2026-09-11'), null);
  assert.equal(formatDay(undefined, '2026-09-11'), null);
});

check('dueState: overdue / today / soon / later', () => {
  const today = '2026-09-11';
  const task = (date) => ({ due: date ? { date, time: null } : null, status: 'backlog' });
  assert.equal(dueState(task('2026-09-09'), today).kind, 'overdue');
  assert.equal(dueState(task('2026-09-09'), today).days, -2);
  assert.equal(dueState(task('2026-09-11'), today).kind, 'today');
  assert.equal(dueState(task('2026-09-13'), today).kind, 'soon');
  assert.equal(dueState(task('2026-09-20'), today).kind, 'later');
  assert.equal(dueState(task(null), today).kind, 'none');
});

check('dueState: a completed task is never overdue', () => {
  const state = dueState({ due: { date: '2026-09-01', time: null }, status: 'done' }, '2026-09-11');
  assert.equal(state.kind, 'none');
});

check('dueState: legacy numeric due still reads as a deadline', () => {
  const legacyTs = Date.parse('2026-09-01T12:00:00');
  const state = dueState({ due: legacyTs, status: 'backlog' }, '2026-09-11');
  assert.equal(state.kind, 'overdue');
});

check('dueState: refuses nothing, but reports nothing for garbage', () => {
  assert.equal(dueState({ due: { date: 'не дата', time: null } }).kind, 'none');
  assert.equal(dueState({}).kind, 'none');
});

check('plural: Russian count forms', () => {
  assert.equal(plural(1, 'задача', 'задачи', 'задач'), 'задача');
  assert.equal(plural(2, 'задача', 'задачи', 'задач'), 'задачи');
  assert.equal(plural(5, 'задача', 'задачи', 'задач'), 'задач');
  assert.equal(plural(11, 'задача', 'задачи', 'задач'), 'задач');
  assert.equal(plural(21, 'задача', 'задачи', 'задач'), 'задача');
  assert.equal(plural(0, 'задача', 'задачи', 'задач'), 'задач');
});

check('dueLabel: overdue reads as lateness, not as an ISO string', () => {
  const today = '2026-09-11';
  assert.equal(
    dueLabel({ due: { date: '2026-09-09', time: null }, status: 'backlog' }, today),
    'Срок истёк: 9 сен · 2 дня назад',
  );
  assert.equal(
    dueLabel({ due: { date: '2026-09-06', time: null }, status: 'backlog' }, today),
    'Срок истёк: 6 сен · 5 дней назад',
  );
});

check('dueLabel: upcoming deadline keeps the time', () => {
  const today = '2026-09-11';
  assert.equal(dueLabel({ due: { date: '2026-09-11', time: '18:00' }, status: 'backlog' }, today), 'Срок: Сегодня · 18:00');
  assert.equal(dueLabel({ due: { date: '2026-09-12', time: null }, status: 'backlog' }, today), 'Срок: Завтра');
  assert.equal(dueLabel({ due: { date: '2026-09-20', time: null }, status: 'backlog' }, today), 'Срок: 20 сен');
});

check('dueLabel: no deadline yields no sentence', () => {
  assert.equal(dueLabel({ due: null, status: 'backlog' }, '2026-09-11'), null);
  assert.equal(dueLabel({ due: { date: '2026-09-01', time: null }, status: 'done' }, '2026-09-11'), null);
});

check('statusLabel: one vocabulary for map, Inspector and Today', () => {
  assert.equal(statusLabel('backlog'), 'Бэклог');
  assert.equal(statusLabel('today'), 'Сегодня');
  assert.equal(statusLabel('doing'), 'В работе');
  assert.equal(statusLabel('done'), 'Готово');
  assert.equal(statusLabel(undefined), 'Бэклог');
  assert.equal(statusLabel('что-то'), 'Бэклог');
});

console.log(`\n✅ All deadline language tests passed (${passed}).`);
