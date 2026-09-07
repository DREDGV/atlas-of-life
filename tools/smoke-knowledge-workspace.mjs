import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {startStaticServer} from './smoke-shared.mjs';
const server=await startStaticServer();let browser;
try{
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1600,height:1040}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(server.origin);
  await page.evaluate(async()=>{
    const core=await import('/js/core/commands.js');
    core.createDomain({id:'d1',title:'Дом',color:'#2dd4bf'});
    core.createDomain({id:'d2',title:'Дача',color:'#f59e0b'});
    core.createDomain({id:'d3',title:'Работа',color:'#7f9cf5'});
    core.createProject({id:'p1',domainId:'d2',title:'Сад и терраса'});
    const entries=[
      ['note','Рабочее место у окна\nУтром здесь естественный свет. Перенести монитор перпендикулярно окну, оставить стол свободным.','d1',null],
      ['thought','Тень для летней террасы\nПосадить дерево с западной стороны. Сначала узнать, сколько места потребуется корням и как меняется тень в течение дня.','d2','p1'],
      ['note','После встречи с командой\nНужен короткий список решений, а не длинный протокол. Каждому решению — ответственный и следующий шаг.','d3',null],
      ['thought','Выходные без спешки\nОставить одно свободное утро. Не превращать отдых в ещё один список обязательств.',null,null],
      ['note','Что посадить у дорожки\nЛаванда любит солнце и дренированную почву. Проверить зимостойкость сорта перед покупкой.','d2','p1'],
      ['thought','Меньше переключений в работе\nСобирать короткие созвоны в одно окно, чтобы оставалось время на сложные задачи.','d3',null],
    ];
    for(const[kind,text,domainId,projectId]of entries){const[item]=core.captureInbox(text,{itemType:kind,splitLines:false});core.routeInboxToKnowledge(item.id,{domainId,projectId});}
  });
  await page.locator('#btnKnowledge').click();
  assert.equal(await page.locator('#viewKnowledge .material-card').count(),6);
  await page.screenshot({animations:'disabled',path:'output/playwright/materials-workspace.png'});
  await page.locator('#viewKnowledge .material-card').nth(0).click();
  const draftText=(await page.locator('#knowledgeText').inputValue())+'\nЧерновик этой сессии';
  await page.locator('#knowledgeText').fill(draftText);
  await page.locator('#viewKnowledge .material-card').nth(1).click();
  await page.locator('#viewKnowledge .material-card').nth(0).click();
  assert.equal(await page.locator('#knowledgeText').inputValue(),draftText);
  await page.getByRole('button',{name:'Отменить правки',exact:true}).click();
  const search=page.getByLabel('Поиск по мыслям и заметкам');
  await search.fill('террасы');
  assert.equal(await page.locator('#viewKnowledge .material-card').count(),1);
  await page.locator('#viewKnowledge .material-card').click();
  const materialId=await page.locator('#viewKnowledge .material-card').getAttribute('data-knowledge-id');
  const sourceBefore=await page.evaluate(id=>JSON.stringify(window.state.knowledge.find(item=>item.id===id)),materialId);
  await page.getByRole('button',{name:'+ Создать задачу',exact:true}).click();
  await page.getByLabel('Что сделать по материалу').fill('Выбрать дерево для террасы');
  await page.getByLabel('Выбрать на сегодня',{exact:true}).check();
  await page.getByRole('button',{name:'Создать связанную задачу',exact:true}).click();
  assert.equal(await page.evaluate(id=>JSON.stringify(window.state.knowledge.find(item=>item.id===id)),materialId),sourceBefore);
  assert.equal(await page.locator('[data-material-task-id]').count(),1);
  await page.locator('[data-material-task-id]').click();
  assert.match(await page.locator('#inspector').innerText(),/Материал-источник/);
  await page.locator('#inspector .knowledge-task-link').click();
  assert.equal(await page.locator('#knowledgeText').inputValue(),JSON.parse(sourceBefore).text);
  await page.screenshot({animations:'disabled',path:'output/playwright/materials-to-action.png'});
  await page.locator('.chip[data-view="today"]').click();
  assert.equal(await page.locator('#viewKnowledge').isVisible(),false);
  const task=page.locator('[data-today-group="planned"] .todo').filter({hasText:'Выбрать дерево для террасы'});
  await task.getByRole('button',{name:'Выполнено',exact:true}).click();
  await page.reload();await page.locator('#btnKnowledge').click();
  await search.fill('террасы');await page.locator('#viewKnowledge .material-card').click();
  assert.match(await page.locator('[data-material-task-id]').innerText(),/✓/);
  await search.fill('');
  await page.getByLabel('Контекст материалов').selectOption('d2');
  assert.equal(await page.locator('#viewKnowledge .material-card').count(),2);
  await page.getByRole('button',{name:'Без контекста',exact:true}).click();
  assert.equal(await page.locator('#viewKnowledge .material-card').count(),1);
  await page.getByLabel('Контекст материалов').selectOption('all');
  await page.setViewportSize({width:900,height:900});
  await page.screenshot({animations:'disabled',path:'output/playwright/materials-workspace-compact.png'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.evaluate(()=>document.documentElement.dataset.theme='light');
  await page.screenshot({animations:'disabled',path:'output/playwright/materials-workspace-light.png'});
  assert.deepEqual(errors,[]);
  console.log('Browser PASS: full library/filter/context, create related action, material unchanged, source navigation, Today completion, reload, compact/light layout.');
}finally{await browser?.close();server.server.close();}
