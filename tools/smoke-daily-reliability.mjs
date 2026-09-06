import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startStaticServer, startSyncServer, makeAdminToken, pairDevice, waitFor } from './smoke-shared.mjs';

const site = await startStaticServer();
const token = makeAdminToken();
const relay = await startSyncServer({ token, allowedOrigins:[site.origin] });
let browser;
try {
  browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{width:1440,height:960} });
  const errors=[]; page.on('pageerror',error => errors.push(error.message));
  page.on('dialog',dialog => dialog.accept());
  await page.goto(site.origin);
  assert.equal(await page.evaluate(() => window.state.tasks.length),0, 'first launch is empty, not demo');
  assert.equal(await page.getByRole('button',{name:'Сегодня+',exact:true}).count(),0);
  await page.evaluate(async () => {
    const core=await import('/js/core/commands.js');
    const {localDay}=await import('/js/features/today/model.js');
    const domain=core.createDomain({title:'Дом'});
    const [item]=core.captureInbox('Оплатить электричество',{itemType:'task'});
    core.routeInboxToTask(item.id,{domainId:domain.id,due:{date:localDay(),time:null}});
    core.createTask({title:'Прочитать заметки',domainId:domain.id,status:'today',due:{date:'2099-01-01',time:null}});
  });
  await pairDevice(page,relay.endpoint,token,'Daily Studio');
  const phone=await browser.newPage({viewport:{width:390,height:844}});
  phone.on('pageerror',error => errors.push(error.message));
  await phone.goto(site.origin+'/capture/');
  await pairDevice(phone,relay.endpoint,token,'Daily Capture');
  await page.locator('.chip[data-view="today"]').click();
  assert.match(await page.locator('[data-today-group="deadlines"]').innerText(),/Оплатить электричество/);
  assert.match(await page.locator('[data-today-group="planned"]').innerText(),/Прочитать заметки/);
  await page.getByRole('button',{name:'Выбрать на сегодня',exact:true}).click();
  const row=page.locator('[data-today-group="planned"] .todo').filter({hasText:'Оплатить электричество'});
  const before=await page.evaluate(() => JSON.stringify(window.state));
  await page.evaluate(() => {
    window.originalSetItem=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){ if(key==='atlas_v2_data') throw new Error('smoke quota'); return window.originalSetItem.call(this,key,value); };
  });
  await row.getByRole('button',{name:'Выполнено',exact:true}).click();
  assert.match(await page.locator('#viewToday [role="alert"]').innerText(),/не сохранено/);
  assert.equal(await page.evaluate(() => JSON.stringify(window.state)),before);
  await page.evaluate(() => { Storage.prototype.setItem=window.originalSetItem; });
  await row.getByRole('button',{name:'Выполнено',exact:true}).click();
  assert.match(await page.locator('[data-today-group="completed"]').innerText(),/Оплатить электричество/);
  await page.reload(); await page.locator('.chip[data-view="today"]').click();
  assert.match(await page.locator('[data-today-group="completed"]').innerText(),/Оплатить электричество/);
  await waitFor(async () => {
    await page.evaluate(() => window.atlasSync.syncNow()); await phone.evaluate(() => window.atlasSync.syncNow());
    return phone.evaluate(() => window.state.taskProjections.some(task => task.status==='done'));
  },{label:'completed projection on phone'});
  await page.screenshot({path:'output/playwright/daily-today.png'});
  await page.getByRole('button',{name:'Вернуть на сегодня',exact:true}).click();
  assert.match(await page.locator('[data-today-group="planned"]').innerText(),/Оплатить электричество/);
  const due=await page.evaluate(() => window.state.tasks.find(task => task.title==='Оплатить электричество').due.date);
  assert(due);
  // Startup corruption: no writes or runtime until explicit recovery.
  await page.evaluate(() => { window.atlasSync.stop(); localStorage.setItem('atlas_v2_data','{broken-original'); });
  await page.reload(); await page.locator('#storageRecovery').waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('atlas_v2_data')),'{broken-original');
  assert.equal(await page.evaluate(() => !!window.atlasSync),false);
  await page.screenshot({path:'output/playwright/daily-recovery.png'});
  const downloadPromise=page.waitForEvent('download');
  await page.getByRole('button',{name:'Скачать исходные данные',exact:true}).click();
  const download=await downloadPromise; await download.saveAs('output/playwright/daily-recovery-original.json');
  await page.getByRole('button',{name:'Восстановить предыдущий снимок',exact:true}).click();
  await page.waitForFunction(() => window.state?.tasks?.length===2 && !document.getElementById('storageRecovery'));
  assert.equal(await page.evaluate(() => localStorage.getItem('atlas_v2_recovery_original')),'{broken-original');
  assert.equal(await page.evaluate(() => window.state.operationLog.some(op => op.type==='state.restore')),true);
  await phone.evaluate(() => { window.atlasSync.stop(); localStorage.setItem('atlas_v2_data','{phone-original'); });
  await phone.reload(); await phone.locator('#storageRecovery').waitFor();
  assert.equal(await phone.evaluate(() => !!window.atlasSync),false);
  assert.equal(await phone.evaluate(() => localStorage.getItem('atlas_v2_data')),'{phone-original');
  assert.deepEqual(errors,[]);
  console.log('Browser PASS: empty startup, one Today, due vs choice, write failure/retry, completion/reload/phone Sync, reopen, corrupt Studio/Capture, download and explicit snapshot recovery.');
} finally { await browser?.close(); site.server.close(); relay.server.close(); }
