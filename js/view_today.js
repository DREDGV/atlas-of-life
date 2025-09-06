// js/view_today.js
import { state } from './state.js';
import { saveState } from './storage.js';

export function renderToday(){
  const wrap = document.getElementById('viewToday');
  if(state.view!=='today'){ wrap.style.display='none'; return; }
  wrap.style.display='block';
  const list = state.tasks.filter(t=>t.status==='today');
  if(list.length===0){
    wrap.innerHTML = `<div class="hint">На сегодня задач нет. Добавьте через форму снизу или выберите из бэклога.</div>`;
    return;
  }
  wrap.innerHTML = list.map(t=>`
    <div class="todo" data-id="${t.id}">
      <input type="checkbox" ${t.status==='done'?'checked':''}/>
      <div class="title">${t.title} <span class="hint">#${t.tags.join(' #')}</span></div>
      <div class="hint">${t.estimateMin?('~'+t.estimateMin+'м'):' '}</div>
      <div class="handle">⋮⋮</div>
    </div>
  `).join('');
  wrap.querySelectorAll('.todo input[type="checkbox"]').forEach(cb=>{
    cb.onchange=(e)=>{
      const id = e.target.closest('.todo').dataset.id;
      const t = state.tasks.find(x=>x.id===id);
      t.status = e.target.checked?'done':'today';
      t.updatedAt = Date.now();
      try{ saveState(); }catch(_){}
      renderToday();
    };
  });
}
