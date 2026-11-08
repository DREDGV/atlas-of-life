import { state } from '../../state.js';
import { saveProjectDecision } from '../../core/commands.js';
import { buildProjectContext } from '../../core/project-context.js';
import { buildAttention } from './attention.js';
import { requestSyncNow } from '../../sync/runtime.js';

const drafts = new Map();
if (typeof window !== 'undefined') window.addEventListener('beforeunload', event => {
  if (drafts.size) { event.preventDefault(); event.returnValue=''; }
});
export function appendProjectReview(host, project, reopen) {
  const context = buildProjectContext(state, project.id);
  const draft = drafts.get(project.id) || { ...context, baseVersion:project.updatedAt };
  const section = document.createElement('section'); section.className='project-review';
  const make = (tag, text) => { const el=document.createElement(tag); if(text)el.textContent=text; return el; };
  section.append(make('h3','Состояние и решение'));
  const form = make('form');
  const field = (title, input) => { const label=make('label',title); label.append(input); form.append(label); return input; };
  const outcome=field('Желаемый результат', make('textarea'));outcome.name='outcome';outcome.rows=2;outcome.value=draft.outcome;
  const next=field('Следующий шаг',make('select'));next.name='nextActionId';next.append(new Option('Пока не выбран',''));
  state.tasks.filter(t=>t.projectId===project.id&&t.status!=='done').forEach(t=>next.append(new Option(t.title,t.id)));
  next.value=draft.nextActionId || '';
  const lifecycle=field('Состояние проекта',make('select'));lifecycle.name='lifecycle';
  [['active','Активен'],['paused','Осознанная пауза'],['completed','Завершён']].forEach(([value,label])=>lifecycle.append(new Option(label,value)));
  lifecycle.value=draft.lifecycle;
  const reason=field('Почему пауза',make('textarea'));reason.name='pauseReason';reason.rows=2;reason.value=draft.pauseReason;
  const review=field('Вернуться к обзору (необязательно)',make('input'));review.name='reviewOn';review.type='date';review.value=draft.reviewOn || '';
  const toggle=()=>{reason.parentElement.hidden=review.parentElement.hidden=lifecycle.value!=='paused';};toggle();
  const remember=()=>{drafts.set(project.id,{outcome:outcome.value,nextActionId:next.value||null,lifecycle:lifecycle.value,pauseReason:reason.value,reviewOn:review.value||null,baseVersion:draft.baseVersion});toggle();};
  form.addEventListener('input',remember);form.addEventListener('change',remember);
  const save=make('button','Сохранить решение');save.type='submit';save.className='btn primary';form.append(save);
  const discard=make('button','Сбросить черновик');discard.type='button';discard.className='btn';discard.onclick=()=>{drafts.delete(project.id);reopen();};form.append(discard);
  const status=make('p');status.setAttribute('role','status');status.className='project-review-status';form.append(status);
  form.onsubmit=e=>{e.preventDefault();remember();try{
    saveProjectDecision(project.id,drafts.get(project.id),{expectedUpdatedAt:draft.baseVersion});drafts.delete(project.id);
    window.mapApi?.refresh?.({layout:true});requestSyncNow();reopen();
    host.querySelector('.project-review-status').textContent='Решение сохранено. Обзор не считается выполненной работой.';
  }catch(error){status.textContent=error.message;}};
  section.append(form);
  const facts=make('div');facts.className='project-evidence';facts.append(make('h4','Что известно'));
  facts.append(make('p',context.evidence.length ? `Последнее отмеченное завершение: ${new Date(context.evidence[0].timestamp).toLocaleDateString('ru-RU')}` : 'Нет данных об отмеченных завершениях. Изменение записи не означает работу.'));
  facts.append(make('p',context.reviewedAt ? `Последний обзор: ${new Date(context.reviewedAt).toLocaleDateString('ru-RU')}` : 'Обзор ещё не отмечен.'));
  facts.append(make('p','Состояние проекта хранится локально в Studio. Sync v1 его не переносит.'));
  const explanation=make('details');explanation.append(make('summary','Почему показан сигнал'));
  const signals=buildAttention(state).get(`project:${project.id}`).signals;
  signals.forEach(s=>explanation.append(make('p',`${s.label}. ${s.reason}`)));
  if(!signals.length)explanation.append(make('p','Следующий шаг выбран. Это не оценка общего благополучия проекта.'));
  section.append(facts,explanation);host.insertBefore(section,host.querySelector('.list'));
}
