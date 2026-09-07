import { state } from '../../state.js';
import { openInspectorFor } from '../../inspector.js';
import { knowledgeContext, materialActions, queryKnowledge } from './model.js';

const filters = { query:'', kind:'all', domain:'all', sort:'updated' };
let selectedId = null;
let controls = null;
const element = (tag, className, text) => {
  const node = document.createElement(tag); if (className) node.className = className;
  if (text !== undefined) node.textContent = text; return node;
};
function initialize(host){
  const header = element('div','materials-heading');
  const titles = element('div');
  titles.append(element('div','materials-eyebrow','ЛИЧНЫЕ МАТЕРИАЛЫ'),element('h1',null,'Мысли и заметки'),element('p',null,'Сохраняйте важное. Возвращайтесь к идеям. Находите следующее действие.'));
  const add = element('button','btn primary','+ Записать'); add.type = 'button';
  add.onclick = async () => { const {openInboxCapture} = await import('../inbox/view.js'); openInboxCapture(); };
  header.append(titles,add);
  const summary = element('div','materials-summary'); summary.setAttribute('aria-live','polite');
  const toolbar = element('div','materials-toolbar');
  const search = element('input','materials-search'); search.type = 'search'; search.placeholder = 'Найти мысль, заметку или контекст…'; search.setAttribute('aria-label','Поиск по мыслям и заметкам');
  search.value = filters.query; search.oninput = () => { filters.query=search.value; renderKnowledge(); };
  const domains = element('select'); domains.setAttribute('aria-label','Контекст материалов');
  domains.onchange = () => { filters.domain=domains.value; renderKnowledge(); };
  const sort = element('select'); sort.setAttribute('aria-label','Порядок материалов');
  sort.append(new Option('Недавно изменённые','updated'),new Option('По названию','title'));
  sort.onchange = () => { filters.sort=sort.value; renderKnowledge(); };
  toolbar.append(search,domains,sort);
  const tabs = element('div','materials-tabs'); tabs.setAttribute('role','group'); tabs.setAttribute('aria-label','Тип материалов');
  const tabButtons=[];
  for (const [key,title] of [['all','Все'],['thought','Мысли'],['note','Заметки']]) {
    const button=element('button',null,title); button.type='button'; button.dataset.kind=key;
    button.onclick=()=>{ filters.kind=key; renderKnowledge(); }; tabs.append(button); tabButtons.push(button);
  }
  const unassigned=element('button','materials-unassigned','Без контекста'); unassigned.type='button';
  unassigned.onclick=()=>{ filters.domain=filters.domain==='none'?'all':'none'; renderKnowledge(); }; tabs.append(unassigned);
  const list=element('div','materials-grid');
  host.append(header,summary,toolbar,tabs,list);
  controls={summary,domains,list,tabButtons,unassigned,search,sort};
}
export function renderKnowledge(){
  const host=document.getElementById('viewKnowledge'); if (!host) return;
  host.hidden=state.view!=='knowledge'; if(host.hidden) return;
  if(!controls || !host.contains(controls.list)) initialize(host);
  const {summary,domains,list,tabButtons,unassigned}=controls;
  const withoutContext=state.knowledge.filter(item=>!item.domainId&&!item.projectId).length;
  domains.replaceChildren(new Option('Все контексты','all'),new Option('Без контекста','none'));
  for(const domain of state.domains) domains.append(new Option(domain.title,domain.id));
  if(filters.domain!=='all'&&filters.domain!=='none'&&!state.domains.some(d=>d.id===filters.domain)) filters.domain='all';
  domains.value=filters.domain;
  tabButtons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.kind===filters.kind)));
  unassigned.setAttribute('aria-pressed',String(filters.domain==='none'));
  list.replaceChildren();
  const items=queryKnowledge(state,filters);
  summary.textContent=`Найдено: ${items.length} из ${state.knowledge.length} · Без контекста: ${withoutContext} · Связанных задач: ${state.tasks.filter(task=>task.sourceKnowledgeId).length}`;
  if(!items.length){
    const empty=element('div','materials-empty');
    empty.append(element('div','materials-empty-mark','◇'),element('h2',null,state.knowledge.length?'Ничего не найдено':'Здесь появится то, что важно сохранить'),element('p',null,state.knowledge.length?'Измените запрос или выберите другой контекст.':'Запишите мысль во Входящие и сохраните её как материал при разборе.'));
    if(state.knowledge.length){ const reset=element('button','btn','Сбросить фильтры'); reset.onclick=()=>{Object.assign(filters,{query:'',kind:'all',domain:'all'});controls.search.value='';renderKnowledge();}; empty.append(reset); }
    list.append(empty); return;
  }
  for(const item of items){
    const context=knowledgeContext(state,item), actions=materialActions(state,item.id);
    const card=element('button','material-card'); card.type='button'; card.dataset.knowledgeId=item.id;
    card.setAttribute('aria-pressed',String(selectedId===item.id));
    card.style.setProperty('--material-color',context.domain?.color || 'var(--muted)');
    card.append(element('span',`material-kind material-kind--${item.kind}`,item.kind==='thought'?'◇ Мысль':'≡ Заметка'),element('h2',null,item.title));
    const excerpt=item.text.startsWith(item.title)?item.text.slice(item.title.length).trim():item.text;
    if(excerpt)card.append(element('p','material-excerpt',excerpt));
    const footer=element('div','material-card-footer'); footer.append(element('span',null,context.label),element('span','material-action-count',actions.length?`Действия · ${actions.length}`:'Открыть →'));
    card.append(footer);
    card.onclick=()=>{
      selectedId=item.id;renderKnowledge();openInspectorFor({...item,_type:'knowledge'});
      const heading=document.querySelector('#inspector h2');if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}
    };
    list.append(card);
  }
}
