import { state } from '../../state.js';
import { moveTask } from '../../core/commands.js';

function appendReceipt(host, operation) {
  const receipt = document.createElement('section');
  receipt.className = 'task-move-receipt';
  receipt.setAttribute('aria-label', 'Последний перенос задачи');

  const status = document.createElement('strong');
  status.setAttribute('role', 'status');
  status.textContent = 'Задача перенесена';
  const places = document.createElement('dl');
  for (const [label, address] of [['Было', operation.payload.from], ['Стало', operation.payload.to]]) {
    const term = document.createElement('dt');
    term.textContent = label;
    const value = document.createElement('dd');
    value.textContent = `${address.domainTitle || 'Без сферы'} → ${address.projectTitle || 'Без проекта'}`;
    places.append(term, value);
  }
  const undo = document.createElement('button');
  undo.type = 'button';
  undo.id = 'taskMoveUndo';
  undo.className = 'btn';
  undo.textContent = 'Отменить';
  const error = document.createElement('p');
  error.className = 'hint';
  error.setAttribute('role', 'alert');
  undo.onclick = () => {
    try {
      if (!window.mapApi.undoMapTaskMove(operation.id)) {
        error.textContent = 'Этот перенос уже недоступен для отмены.';
        return;
      }
      host.querySelector('#taskMoveMessage').textContent = 'Перенос отменён.';
      host.querySelector('#taskPlace summary').focus();
    } catch (failure) {
      error.textContent = failure.message;
    }
  };
  receipt.append(status, places, undo, error);
  host.querySelector('.inspector-heading').after(receipt);
}

export function wireTaskPlacement(host, task, taskDomainId) {
  const map = window.mapApi;
  const operation = map?.taskMoveReceipt?.(task.id);
  if (operation?.payload.from && operation.payload.to) appendReceipt(host, operation);

  const place = host.querySelector('#taskPlace');
  const domain = place.querySelector('#taskPlaceDomain');
  const project = place.querySelector('#taskPlaceProject');
  const form = place.querySelector('form');
  const submit = form.querySelector('[type=submit]');
  const updateSubmit = () => {
    submit.disabled = domain.value === (taskDomainId || '') && project.value === (task.projectId || '');
  };
  const fillProjects = () => {
    const projects = state.projects.filter(item => item.domainId === domain.value
      && (item.lifecycle !== 'completed' || item.id === task.projectId));
    project.replaceChildren(new Option('Без проекта', ''), ...projects.map(item => new Option(item.title, item.id)));
    project.value = projects.some(item => item.id === task.projectId) ? task.projectId : '';
    project.disabled = !domain.value;
    updateSubmit();
  };
  domain.append(new Option('Без сферы', ''), ...state.domains.map(item => new Option(item.title, item.id)));
  domain.value = taskDomainId || '';
  fillProjects();
  domain.onchange = fillProjects;
  project.onchange = updateSubmit;
  form.onsubmit = event => {
    event.preventDefault();
    if (submit.disabled) return;
    try {
      const result = moveTask(task.id, {
        domainId: domain.value || null,
        projectId: project.value || null,
        pos: null,
      }, { reason: 'inspector.place_task' });
      if (!map.rememberTaskMove(result)) return;
      map.revealTaskMove(task.id);
      host.querySelector('#taskMoveUndo')?.focus();
    } catch (error) {
      form.querySelector('[role=alert]').textContent = error.message;
    }
  };
}
