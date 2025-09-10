// js/view_today.js
import { state } from './state.js';
import { saveState } from './storage.js';

export function renderToday(){
  const wrap = document.getElementById('viewToday');
  if(state.view!=='today'){ wrap.style.display='none'; return; }
  wrap.style.display='block';
  
  // Get today's date for comparison
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTimestamp = today.getTime();
  
  // Show tasks with status=today OR deadline=today
  const list = state.tasks.filter(t => {
    // Status is today
    if (t.status === 'today') return true;
    
    // Has deadline today (even if status is backlog)
    if (t.scheduledFor) {
      const taskDate = new Date(t.scheduledFor);
      taskDate.setHours(0, 0, 0, 0);
      return taskDate.getTime() === todayTimestamp;
    }
    
    return false;
  });
  
  if(list.length===0){
    wrap.innerHTML = `<div class="hint">На сегодня задач нет. Добавьте через форму снизу или выберите из бэклога.</div>`;
    return;
  }
  
  wrap.innerHTML = list.map(t => {
    // Check if task has deadline today but status is not today
    const hasDeadlineToday = t.scheduledFor && new Date(t.scheduledFor).setHours(0,0,0,0) === todayTimestamp;
    const isOverdue = hasDeadlineToday && t.status === 'backlog';
    
    // Format time badge
    let timeBadge = '';
    if (t.scheduledFor) {
      const taskTime = new Date(t.scheduledFor);
      const timeStr = taskTime.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      timeBadge = `<span class="time-badge ${isOverdue ? 'overdue' : ''}" title="Дедлайн: ${timeStr}">${timeStr}</span>`;
    }
    
    return `
      <div class="todo ${isOverdue ? 'overdue' : ''}" data-id="${t.id}">
        <input type="checkbox" ${t.status==='done'?'checked':''}/>
        <div class="title">
          ${t.title} 
          <span class="hint">#${t.tags.join(' #')}</span>
          ${timeBadge}
        </div>
        <div class="hint">${t.estimateMin?('~'+t.estimateMin+'м'):' '}</div>
        <div class="handle">⋮⋮</div>
      </div>
    `;
  }).join('');
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
