import { createProject, createTask } from '../../core/commands.js';
import { requestSyncNow } from '../../sync/runtime.js';

export function bindMapCreate(trigger, { row, type, destination, path, onCreate }) {
  trigger.setAttribute('aria-expanded', 'false');
  trigger.onclick = () => {
    const wasOpen = trigger.getAttribute('aria-expanded') === 'true';
    const current = row.nextElementSibling;
    if (current?.matches('.map-create-form')) current.dispatchEvent(new Event('map-create-close'));
    if (wasOpen) return;

    const isProject = type === 'project';
    const form = document.createElement('form');
    form.className = 'map-create-form';
    form.setAttribute('aria-label', isProject ? 'Новый проект' : 'Новая задача');

    const label = document.createElement('label');
    label.textContent = isProject ? 'Название проекта' : 'Название задачи';
    const input = document.createElement('input');
    input.required = true;
    input.maxLength = 240;
    label.append(input);

    const place = document.createElement('p');
    place.className = 'map-create-place';
    place.textContent = 'Место — ' + path.filter(Boolean).join(' → ');
    const actions = document.createElement('div');
    actions.className = 'map-create-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn';
    cancel.textContent = 'Отмена';
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'btn primary';
    submit.textContent = isProject ? 'Создать проект' : 'Создать задачу';
    actions.append(cancel, submit);

    const alert = document.createElement('p');
    alert.setAttribute('role', 'alert');
    form.append(place, label, alert, actions);
    const close = () => {
      form.remove();
      trigger.setAttribute('aria-expanded', 'false');
    };
    form.addEventListener('map-create-close', close);
    cancel.onclick = () => { close(); trigger.focus(); };
    form.onkeydown = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      cancel.click();
    };
    form.onsubmit = event => {
      event.preventDefault();
      const title = input.value.trim();
      if (!title) {
        alert.textContent = 'Введите название.';
        input.focus();
        return;
      }
      let created;
      try {
        created = (isProject ? createProject : createTask)({ ...destination, title });
      } catch (error) {
        alert.textContent = error.message;
        return;
      }
      close();
      requestSyncNow();
      onCreate(created, type);
    };
    row.after(form);
    trigger.setAttribute('aria-expanded', 'true');
    input.focus();
  };
}
