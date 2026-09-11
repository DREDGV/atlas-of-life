// Единый язык интерфейса Atlas: как называются статусы задачи и как читаются
// календарные дни и сроки.
//
// Эти функции чистые и не зависят ни от состояния карты, ни от DOM, поэтому
// один и тот же текст видят карта, инспектор, Today и мобильный Capture.
// Раньше карта печатала сырые значения модели (`backlog`, `doing`), а Today —
// русские подписи, и одинаковые задачи описывались разными словами.

export const TASK_STATUS_LABELS = {
  today: 'Сегодня',
  doing: 'В работе',
  done: 'Готово',
  backlog: 'Бэклог',
};

export function statusLabel(status){
  return TASK_STATUS_LABELS[status] || 'Бэклог';
}

export const MONTHS_SHORT = [
  'янв', 'фев', 'мар', 'апр', 'мая', 'июн',
  'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
];

export function isDayKey(value){
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

// Calendar-day distance without timezone drift: ISO days are compared as UTC
// midnights, so DST and partial days cannot skew the result.
export function daysBetween(fromISO, toISO){
  if (!fromISO || !toISO) return null;
  const from = Date.parse(`${fromISO}T00:00:00Z`);
  const to = Date.parse(`${toISO}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / 86400000);
}

// Human day label: «Сегодня», «Завтра», «5 сен». Beyond the current year the
// year is kept, so a distant deadline is not silently ambiguous.
export function formatDay(iso, today){
  if (!isDayKey(iso) || !isDayKey(today)) return null;
  const delta = daysBetween(today, iso);
  if (delta === 0) return 'Сегодня';
  if (delta === 1) return 'Завтра';
  if (delta === -1) return 'Вчера';
  const [year, month, day] = iso.split('-').map(Number);
  const label = `${day} ${MONTHS_SHORT[month - 1]}`;
  return year === Number(today.slice(0, 4)) ? label : `${label} ${year}`;
}

// «Задача», «2 задачи», «5 задач» — форма числительного для счётчиков.
export function plural(count, one, few, many){
  const n = Math.abs(Number(count) || 0) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return many;
  if (n1 > 1 && n1 < 5) return few;
  if (n1 === 1) return one;
  return many;
}

// Срок из persisted-модели: структурный { date, time } либо легаси-timestamp.
export function taskDueDay(task){
  if (task?.due?.date) return task.due.date;
  if (typeof task?.due === 'number') {
    const date = new Date(task.due);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  return null;
}

// Срочность срока как визуальный канал, а не предложение:
//   overdue — срок истёк | today — срок сегодня | soon — ≤ 3 дня | later
export function deadlineState(task, today){
  const due = taskDueDay(task);
  if (!due || task?.status === 'done') return { kind: 'none', day: null, days: null };
  const days = daysBetween(today, due);
  if (days === null) return { kind: 'none', day: null, days: null };
  if (days < 0) return { kind: 'overdue', day: due, days };
  if (days === 0) return { kind: 'today', day: due, days: 0 };
  if (days <= 3) return { kind: 'soon', day: due, days };
  return { kind: 'later', day: due, days };
}

// «Срок истёк: 9 сен · 3 дня назад» / «Срок: Сегодня · 18:00» — единственное
// место, где срок становится фразой: ни один экран больше не печатает ISO.
export function deadlineLabel(task, today){
  const state = deadlineState(task, today);
  if (state.kind === 'none') return null;
  const day = formatDay(state.day, today);
  const time = task.due?.time ? ` · ${task.due.time}` : '';
  if (state.kind === 'overdue') {
    const late = Math.abs(state.days);
    return `Срок истёк: ${day} · ${late} ${plural(late, 'день', 'дня', 'дней')} назад`;
  }
  if (state.kind === 'today') return `Срок: Сегодня${time}`;
  return `Срок: ${day}${time}`;
}
