import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdirSync,writeFileSync } from 'node:fs';
import { startStaticServer,closeAll } from './smoke-shared.mjs';
const server=await startStaticServer(),browser=await chromium.launch({headless:true});
mkdirSync('output/stable-atlas',{recursive:true});
const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(server.origin);
 const ids=await page.evaluate(async()=>{
  const c=await import('/js/core/commands.js');const ps=[],ds=[];const o={persist:false};
  for(const title of ['Дом','Здоровье','Работа','Творчество','Семья','Учёба','Финансы','Мастерская','Отдых','Друзья','Спорт','Сад']){
   const d=c.createDomain({title,color:'#60a5fa'},o);ds.push(d.id);
   for(let j=0;j<5;j++){const p=c.createProject({title:`${title}: направление ${j+1} с длинным названием`,domainId:d.id},o);ps.push(p.id);
    for(let k=0;k<6;k++)c.createTask({title:`Шаг ${k+1}: ${title}`,projectId:p.id},o);
   }
  }
  (await import('/js/storage.js')).saveState();const m=await import('/js/view_map.js');m.layoutMap();m.fitAll();return {ds,ps};
 });
 const positions=()=>page.evaluate(async()=>{const s=(await import('/js/view_map.js')).getLayoutSnapshot();return Object.fromEntries(s.nodes.filter(n=>['domain','project'].includes(n._type)).map(n=>[n.id,[n.x/s.size.dpr,n.y/s.size.dpr]]));});
 const before=await positions();
 const metrics=await page.evaluate(async id=>{const c=await import('/js/core/commands.js');const {state}=await import('/js/state.js');c.createTask({title:'Ещё один шаг',projectId:id});c.updateTask(state.tasks[0].id,{status:'doing'});const m=await import('/js/view_map.js');const start=performance.now();for(let i=0;i<10;i++)m.layoutMap();const layout=(performance.now()-start)/10;const drawStart=performance.now();for(let i=0;i<10;i++)m.drawMap();return {layoutMs:layout,drawMs:(performance.now()-drawStart)/10,domains:state.domains.length,projects:state.projects.length,tasks:state.tasks.length};},ids.ps[0]);
 assert.deepEqual(await positions(),before,'task changes do not move anchors');
 await page.screenshot({path:'output/stable-atlas/overview-dark.png'});
 await page.setViewportSize({width:1024,height:768});assert.deepEqual(await positions(),before,'resize preserves world anchors');
 await page.reload();assert.deepEqual(await positions(),before,'reload preserves anchors');
 await page.evaluate(async id=>{(await import('/js/view_map.js')).fitProject(id);},ids.ps[15]);
 await page.screenshot({path:'output/stable-atlas/project-focus.png'});
 // Growth and overflow: every existing anchor stays, an out-of-page project is searchable.
 const overflow=await page.evaluate(async d=>{const c=await import('/js/core/commands.js');let p;for(let i=0;i<18;i++)p=c.createProject({title:`Резерв ${i}`,domainId:d});(await import('/js/view_map.js')).layoutMap();return p.id;},ids.ds[0]);
 const grown=await positions();for(const [id,xy] of Object.entries(before))assert.deepEqual(grown[id],xy);
 await page.evaluate(async id=>{const {state}=await import('/js/state.js');const p=state.projects.find(p=>p.id===id);(await import('/js/view_map.js')).setMapFilter({query:p.title});},overflow);
 assert.ok((await positions())[overflow],'empty project search reveals correct page');
 assert.ok(await page.locator('#atlasNavigator [data-action=next-page]').count(),'page control exists');
 await page.locator('#atlasNavigator [data-action=next-page]').click();
 assert.ok(!(await positions())[overflow],'manual page navigation clears search override');
 await page.locator('#atlasNavigator [data-action=next-page]').click();
 assert.ok((await positions())[overflow],'page navigation reveals overflow again');
 const hiddenTask=await page.evaluate(async id=>{const c=await import('/js/core/commands.js');let task;for(let i=0;i<40;i++)task=c.createTask({title:`Плотный проект: скрытый шаг ${i}`,projectId:id},{persist:false});(await import('/js/storage.js')).saveState();const m=await import('/js/view_map.js');m.setMapFilter({query:task.title});return task.id;},ids.ps[0]);
 assert.ok(await page.evaluate(async id=>(await import('/js/view_map.js')).getLayoutSnapshot().nodes.some(n=>n.id===id),hiddenTask),'search reveals task beyond first 12');
 await page.evaluate(async id=>{const m=await import('/js/view_map.js');m.setMapFilter({query:''});m.fitTask(id);},hiddenTask);
 assert.ok(await page.evaluate(async id=>(await import('/js/view_map.js')).getLayoutSnapshot().nodes.some(n=>n.id===id),hiddenTask),'direct task navigation reveals a capped task');
 await page.evaluate(async()=>{document.documentElement.dataset.theme='light';(await import('/js/view_map.js')).drawMap();});await page.screenshot({path:'output/stable-atlas/overflow-light.png'});
 writeFileSync('output/stable-atlas/performance.json',JSON.stringify(metrics,null,2));assert.deepEqual(errors,[]);
 console.log('PASS stable map: 12 domains / 60 projects / 360+ tasks, resize/reload/task changes/new project growth, overflow/search; timings',metrics);
}finally{await browser.close();await closeAll(server);}
