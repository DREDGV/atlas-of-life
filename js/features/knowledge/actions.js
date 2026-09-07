import { state } from '../../state.js';
import { createTaskFromKnowledge } from '../../core/commands.js';
import { materialActions, knowledgeContext } from './model.js';

export function appendKnowledgeActions(host, material, onOpen){
  const section=document.createElement('section'); section.className='knowledge-actions'; host.append(section);
  const render=()=>{
    section.replaceChildren();
    const heading=document.createElement('h3'); heading.textContent='Связанные действия'; section.append(heading);
    const tasks=materialActions(state,material.id);
    for(const task of tasks){
      const button=document.createElement('button'); button.type='button'; button.className='knowledge-task-link';
      button.textContent=`${task.status==='done'?'✓':task.status==='today'?'Сегодня ·':'→'} ${task.title}`;
      button.dataset.materialTaskId=task.id; button.onclick=()=>onOpen(task); section.append(button);
    }
    if(!tasks.length){const hint=document.createElement('p');hint.className='hint';hint.textContent='Превратите идею в следующий шаг. Материал останется на месте.';section.append(hint);}
    const toggle=document.createElement('button');toggle.type='button';toggle.className='btn primary';toggle.textContent='+ Создать задачу';toggle.setAttribute('aria-expanded','false');
    const form=document.createElement('form');form.className='knowledge-action-form';form.hidden=true;
    const title=document.createElement('input');title.required=true;title.value=material.title;title.setAttribute('aria-label','Что сделать по материалу');
    const label=document.createElement('label');label.textContent='Что сделать?';label.append(title);
    const domain=document.createElement('select');domain.setAttribute('aria-label','Домен новой задачи');
    const project=document.createElement('select');project.setAttribute('aria-label','Проект новой задачи');
    const context=knowledgeContext(state,material);
    domain.append(new Option('Выберите домен',''));
    state.domains.forEach(item=>domain.append(new Option(item.title,item.id)));
    domain.value=context.domain?.id || '';
    const fillProjects=()=>{
      project.replaceChildren(new Option('Без проекта',''));
      state.projects.filter(item=>item.domainId===domain.value).forEach(item=>project.append(new Option(item.title,item.id)));
    };
    fillProjects();project.value=material.projectId || '';domain.onchange=fillProjects;
    const today=document.createElement('input');today.type='checkbox';
    const todayLabel=document.createElement('label');todayLabel.className='knowledge-action-today';todayLabel.append(today,document.createTextNode(' Выбрать на сегодня'));
    const error=document.createElement('p');error.className='today-error';error.setAttribute('role','alert');
    const submit=document.createElement('button');submit.type='submit';submit.className='btn primary';submit.textContent='Создать связанную задачу';
    form.append(label,domain,project,todayLabel,error,submit);
    if(!state.domains.length){error.textContent='Сначала создайте домен в боковой панели.';submit.disabled=true;}
    toggle.onclick=()=>{form.hidden=!form.hidden;toggle.setAttribute('aria-expanded',String(!form.hidden));if(!form.hidden)title.focus();};
    form.onsubmit=event=>{
      event.preventDefault();submit.disabled=true;
      try{
        if(!domain.value)throw new Error('Выберите домен для задачи');
        createTaskFromKnowledge(material.id,{title:title.value,domainId:domain.value,projectId:project.value || null,status:today.checked?'today':'backlog'});
        render();
        const message=document.createElement('p');message.className='knowledge-action-success';message.setAttribute('role','status');message.textContent='Задача создана. Материал и исходник сохранены.';section.append(message);
      }catch(failure){error.textContent=failure.message;submit.disabled=false;}
    };
    section.append(toggle,form);
  };
  render();
}
