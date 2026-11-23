import { taskDueDay } from '../../ui/status-language.js';

export function buildDomainSignals(atlas, attention, visitSuggestions) {
  const tasks = new Map(atlas.tasks.map(task => [task.id, task]));
  const visitsByDomain = new Map();
  for (const visit of visitSuggestions) {
    if (!visit.kind) continue;
    if (!visitsByDomain.has(visit.domainId)) visitsByDomain.set(visit.domainId, new Map());
    const visits = visitsByDomain.get(visit.domainId);
    if (!visits.has(visit.kind)) visits.set(visit.kind, visit);
  }
  const result = new Map();
  const order = ['overdue', 'review', 'pause', 'load', 'next', 'stale'];
  for (const area of attention.values()) {
    if (area.type !== 'domain') continue;
    const facts = new Map(area.signals.map(signal => [signal.kind, signal]));
    const visits = visitsByDomain.get(area.id) || new Map();
    const rank = order.findIndex(kind => facts.has(kind) || visits.has(kind));
    if (rank < 0) continue;
    const kind = order[rank];
    const visit = visits.get(kind);
    const fact = facts.get(kind);
    const base = { kind, rank, domain:area };
    if (kind === 'overdue' || kind === 'stale') {
      const candidates = fact.taskIds.map(id => tasks.get(id));
      if (kind === 'overdue') candidates.sort((a, b) => taskDueDay(a).localeCompare(taskDueDay(b))
        || (a.due?.time || '24:00').localeCompare(b.due?.time || '24:00') || String(a.id).localeCompare(String(b.id)));
      const task = candidates[0];
      result.set(area.id, { ...base, label:fact.label, detail:task.title, action:'Открыть задачу', target:{ type:'task', id:task.id } });
    } else if (visit) {
      const label = { review:'Пора провести обзор', pause:'Пора пересмотреть паузу', next:'Нет следующего шага' }[kind];
      result.set(area.id, { ...base, label, detail:visit.type === 'project' ? visit.title : '', action:visit.action, target:visit });
    } else {
      result.set(area.id, { ...base, label:fact.label, detail:'', action:'Открыть сферу', target:area });
    }
  }
  return result;
}

const overlaps = (a, b) => a.x < b.x + b.w + 5 && a.x + a.w + 5 > b.x
  && a.y < b.y + b.h + 5 && a.y + a.h + 5 > b.y;

export function renderDomainSignals(host, { nodes, signals, camera, dpr, width, height, open }) {
  if (!nodes.length || !signals.size) {
    if (host.childElementCount) host.replaceChildren();
    return new Set();
  }
  const existing = new Map([...host.children].map(button => [button.dataset.domain, button]));
  const visible = new Set();
  const navigator = document.getElementById('atlasNavigator');
  const mini = host.parentElement.querySelector('.atlas-minimap');
  const top = navigator.offsetTop + navigator.offsetHeight + 8;
  const w = Math.min(width < 420 ? 166 : 188, width - 16);
  const h = 56;
  const occupied = mini.offsetWidth ? [{ x:mini.offsetLeft, y:mini.offsetTop, w:mini.offsetWidth, h:mini.offsetHeight }] : [];
  const domains = nodes.filter(node => node._type === 'domain' && signals.has(node.id))
    .sort((a, b) => signals.get(a.id).rank - signals.get(b.id).rank);
  for (const node of domains) {
    const center = (node.x * camera.scale + camera.tx) / dpr;
    const north = ((node.y - node.r) * camera.scale + camera.ty) / dpr;
    const cy = (node.y * camera.scale + camera.ty) / dpr;
    if (center < 0 || center > width || cy < top || north + h / 2 >= height || w < 130) continue;
    const x = Math.round(Math.max(8, Math.min(center - w / 2, width - w - 8)));
    const y = Math.round(Math.max(top, north - 28));
    const slot = [y, y + h + 6, y - h - 6].map(row => ({ x, y:row, w, h }))
      .find(box => box.y >= top && box.y + h <= height - 8 && !occupied.some(other => overlaps(box, other)));
    if (!slot) continue;
    occupied.push(slot);
    visible.add(node.id);

    const signal = signals.get(node.id);
    let button = existing.get(node.id);
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'map-domain-signal';
      button.dataset.domain = node.id;
      button.append(document.createElement('strong'), document.createElement('span'), document.createElement('span'));
      host.append(button);
    }
    const label = [signal.label, signal.detail].filter(Boolean).join(' · ');
    const title = `${node.title}. ${label}. ${signal.action}`;
    if (button.title !== title) {
      button.firstChild.textContent = node.title;
      button.children[1].textContent = signal.label;
      button.lastChild.textContent = signal.detail;
      button.lastChild.hidden = !signal.detail;
      button.title = title;
      button.setAttribute('aria-label', title);
      button.dataset.kind = signal.kind;
    }
    button.onclick = () => open(node.id);
    button.style.width = `${w}px`;
    button.style.transform = `translate(${slot.x}px, ${slot.y}px)`;
  }
  for (const [id, button] of existing) if (!visible.has(id)) button.remove();
  return visible;
}
