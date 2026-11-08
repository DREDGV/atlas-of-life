import { state } from '../../state.js';
import { moveProject, undoProjectMove } from '../../core/commands.js';
import { setDomainVisible } from '../../ui/map-session.js';
import { requestSyncNow } from '../../sync/runtime.js';
import { revealProjectPage } from './spatial-layout.js';

export function revealProject(project) {
  revealProjectPage(project);
  setDomainVisible(project.domainId, true, state.domains);
  window.renderSidebar?.();
  window.mapApi?.layoutMap?.();
  window.mapApi?.fitDomain?.(project.domainId);
  window.mapApi?.drawMap?.();
  requestSyncNow();
}

export function appendProjectPlacement(host, project, reopen) {
  const form = document.createElement('form');
  form.className = 'project-placement';
  const label = document.createElement('label');
  label.textContent = 'Перенести проект в сферу';
  const select = document.createElement('select');
  select.name = 'projectDestination';
  state.domains.forEach(domain => select.add(new Option(domain.title, domain.id)));
  select.value = project.domainId;
  label.append(select);
  const note = document.createElement('p');
  const taskCount = state.tasks.filter(t => t.projectId === project.id).length;
  const materialCount = state.knowledge.filter(k => k.projectId === project.id).length;
  note.textContent = `Вместе с проектом: задач — ${taskCount}, материалов — ${materialCount}. Сроки и план сохранятся.`;
  const submit = document.createElement('button');
  submit.type = 'submit'; submit.className = 'btn'; submit.textContent = 'Перенести проект';
  submit.disabled = true;
  select.onchange = () => { submit.disabled = select.value === project.domainId; };
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  form.append(label, note, submit, status);
  form.onsubmit = event => {
    event.preventDefault();
    try {
      const result = moveProject(project.id, select.value, { expectedUpdatedAt: project.updatedAt });
      revealProject(result.project);
      reopen(result.project);
      const receipt = document.createElement('div');
      receipt.className = 'project-move-receipt'; receipt.setAttribute('role', 'status');
      const text = document.createElement('p');
      text.textContent = `Проект перенесён: ${state.domains.find(d => d.id === result.project.domainId)?.title}. Все связи сохранены.`;
      const undo = document.createElement('button');
      undo.type = 'button'; undo.className = 'btn'; undo.textContent = 'Отменить перенос';
      undo.onclick = () => {
        try {
          const restored = undoProjectMove(result);
          revealProject(restored.project); reopen(restored.project);
        } catch (error) { text.textContent = error.message; }
      };
      receipt.append(text, undo); host.prepend(receipt);
    } catch (error) { status.textContent = error.message; }
  };
  host.append(form);
}
