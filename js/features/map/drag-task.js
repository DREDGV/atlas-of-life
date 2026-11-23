import { containsTerritory } from './geometry.js';
import { taskMovePath } from './task-placement.js';

export function findDropTerritory(nodes, type, point, dpr) {
  let result = null;
  for (const node of nodes) {
    if (node._type === type && (!result || node.r <= result.r)
      && containsTerritory(node, point.x, point.y, dpr)) result = node;
  }
  return result;
}

export function taskDropTarget(atlas, nodes, taskId, point, dpr) {
  const task = atlas.tasks.find(item => item.id === taskId);
  if (!task) return null;
  const shape = findDropTerritory(nodes, 'project', point, dpr);
  const project = shape && atlas.projects.find(item => item.id === shape.id);
  const domainShape = project ? null : findDropTerritory(nodes, 'domain', point, dpr);
  const domainId = project?.domainId || domainShape?.id;
  const domain = domainId && atlas.domains.find(item => item.id === domainId);
  if (!domain) return { label:'Наведите задачу на сферу или проект' };
  const projectId = project?.id ?? null;
  const address = { domainId, projectId, domainTitle:domain.title, projectTitle:project?.title };
  const unchanged = (task.projectId ?? null) === projectId && (projectId || task.domainId === domainId);
  const blocked = project?.lifecycle === 'completed' && !unchanged;
  return { ...address, valid:!blocked && !unchanged,
    label:blocked ? 'Проект завершён' : unchanged ? 'Текущее место задачи' : 'Отпустите, чтобы перенести' };
}

let lastKey = '';
export function renderTaskMove(host, preview, notice, undo, dismiss) {
  const key = JSON.stringify([preview?.label, preview?.domainId, preview?.projectId, notice?.operation?.id, notice?.message, notice?.kind]);
  if (lastKey === key) return;
  lastKey = key;
  host.replaceChildren();
  host.hidden = !preview && !notice;
  if (host.hidden) return;
  host.dataset.mode = preview ? 'preview' : 'notice';
  host.dataset.tone = preview ? 'preview' : (notice.kind || 'info');
  host.dataset.valid = String(Boolean(preview?.valid));
  host.dataset.domainId = preview?.domainId ?? '';
  host.dataset.projectId = preview?.projectId ?? '';

  const heading = document.createElement('strong');
  heading.setAttribute('role', notice?.kind === 'error' && !preview ? 'alert' : 'status');
  heading.textContent = preview?.label || notice.message;
  host.append(heading);
  if (preview?.domainId) {
    const path = document.createElement('p');
    path.textContent = taskMovePath(preview);
    host.append(path);
  }
  if (preview) return;

  const actions = document.createElement('div');
  actions.className = 'map-move-actions';
  if (notice.operation) {
    const addresses = document.createElement('dl');
    for (const [label, address] of [['Было', notice.operation.payload.from], ['Стало', notice.operation.payload.to]]) {
      const term = document.createElement('dt');
      term.textContent = label;
      const value = document.createElement('dd');
      value.textContent = taskMovePath(address);
      addresses.append(term, value);
    }
    host.append(addresses);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn';
    button.textContent = 'Отменить';
    button.onclick = () => undo(notice.operation.id);
    actions.append(button);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn';
  close.textContent = 'Закрыть';
  close.onclick = dismiss;
  actions.append(close);
  host.append(actions);
}
