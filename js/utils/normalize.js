// @ts-check
/** Приводим тип к единственной форме, без множественного числа и синонимов */
export function normalizeType(t) {
  const x = String(t ?? '').toLowerCase().trim();
  if (x === 'ideas') return 'idea';
  if (x === 'notes' || x === 'thought' || x === 'thoughts') return 'note';
  if (x === 'checklists') return 'checklist';
  return x;
}

/** Все id храним строками, чтобы не терять ведущие нули и не путать типы */
export function normalizeId(id) {
  return id == null ? null : String(id).trim();
}
