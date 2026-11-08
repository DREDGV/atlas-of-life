// DOM counterpart of the Canvas readout: same snapshot, keyboard accessible.
let signature = '';
export function renderAttention(host, entries, { openArea, openTask }) {
  if (!host) return;
  const next = JSON.stringify([...entries]);
  if (signature === next && host.childElementCount) return;
  signature = next;
  const expanded = new Set([...host.querySelectorAll('details[open]')].map(el => el.dataset.area));
  const active = host.contains(document.activeElement) ? document.activeElement.dataset.nav : null;
  host.replaceChildren();
  const make = (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text !== undefined) el.textContent = text;
    return el;
  };
  host.append(make('h3', '', 'Куда направить внимание'));
  host.append(make('p', 'attention-intro', 'Все сферы · независимо от фильтров карты'));
  const domains = [...entries.values()].filter(e => e.type === 'domain');
  if (!domains.length) host.append(make('p', 'attention-intro', 'Добавьте сферу жизни — здесь появятся её ориентиры.'));
  const areaButton = (area, label) => {
    const button = make('button', 'attention-open', label);
    button.type = 'button';
    button.dataset.nav = `${area.type}:${area.id}`;
    button.onclick = () => openArea(area);
    return button;
  };
  for (const area of domains) {
    const details = make('details', `attention-area attention-${area.primary.kind}`);
    details.dataset.area = area.id;
    details.open = expanded.has(area.id);
    const summary = make('summary');
    summary.dataset.nav = `summary:${area.id}`;
    summary.append(make('span', 'attention-name', area.title), make('span', 'attention-state', area.primary.label));
    details.append(summary);
    details.append(areaButton(area, 'Показать сферу на карте ↗'));
    const children = [...entries.values()].filter(e => e.type === 'project' && e.domainId === area.id);
    const renderReasons = (entry) => {
      const body = make('div', 'attention-reasons');
      for (const signal of entry.signals) {
        const line = make('p', `attention-reason attention-${signal.kind}`);
        line.append(make('strong', '', signal.label), document.createTextNode(`. ${signal.reason}`));
        body.append(line);
        if (signal.taskIds.length) {
          const button = make('button', 'attention-task', signal.taskIds.length > 1 ? 'Открыть первую задачу →' : 'Открыть задачу →');
          button.type = 'button';
          button.dataset.nav = `${entry.type}:${entry.id}:${signal.kind}`;
          button.onclick = () => openTask(signal.taskIds[0]);
          body.append(button);
        }
      }
      if (!entry.signals.length) body.append(make('p', 'attention-intro', 'Нет просрочек и старых открытых задач; одновременно начато меньше четырёх.'));
      return body;
    };
    details.append(renderReasons(area));
    for (const child of children) {
      const row = make('details', 'attention-project');
      row.dataset.area = `project:${child.id}`;
      row.open = expanded.has(row.dataset.area);
      const heading = make('summary');
      heading.dataset.nav = `summary:project:${child.id}`;
      heading.append(make('span', 'attention-name', `◇ ${child.title}`), make('span', `attention-state attention-${child.primary.kind}`, child.primary.label));
      row.append(heading, areaButton(child, 'Показать проект ↗'), renderReasons(child));
      details.append(row);
    }
    host.append(details);
  }
  const rules = make('details', 'attention-rules');
  rules.dataset.area = 'rules';
  rules.open = expanded.has('rules');
  rules.append(make('summary', '', 'Как читать карту'));
  rules.append(make('p', '', 'Цвет территории — сфера жизни. Подпись — наблюдение. Зелёная дуга — выполненные задачи, красная — просроченные; это состав задач, а не оценка жизни.'));
  rules.append(make('p', '', '«Без движения» — запись не менялась 30+ дней. «Много начатого» — 4+ задачи в работе. Пустая сфера не считается проблемой.'));
  host.append(rules);
  if (active) [...host.querySelectorAll('[data-nav]')].find(el => el.dataset.nav === active)?.focus();
}
