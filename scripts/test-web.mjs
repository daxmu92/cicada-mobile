import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';

const base = process.env.CICADA_WEB_URL ?? 'http://localhost:8085';
const browser = await chromium.launch(process.env.CICADA_E2E_BROWSER
  ? { executablePath: process.env.CICADA_E2E_BROWSER }
  : process.platform === 'win32' ? { channel: 'msedge' } : {});
try {
  const context = await browser.newContext({ viewport: { width: 420, height: 900 }, locale: 'en-US' });
  await context.addInitScript(() => {
    const original = Worker.prototype.postMessage;
    const queued = [];
    window.__cicadaPauseSQL = false;
    window.__cicadaFlushSQL = () => {
      window.__cicadaPauseSQL = false;window.__cicadaPausePreview=false;
      for (const [worker, args] of queued.splice(0)) original.apply(worker, args);
    };
    Worker.prototype.postMessage = function (...args) {
      const pausePreview=window.__cicadaPausePreview&&args[0]?.data?.source?.startsWith('SELECT date,net_worth,inflow,profit,updated_at');
      if (pausePreview)window.__cicadaHasPausedPreview=true;
      if ((window.__cicadaPauseSQL||pausePreview) && args[0]?.isSync === false) queued.push([this, args]);
      else original.apply(this, args);
    };
  });
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  let dismissUnsaved=false;
  page.on('dialog', (dialog) => { if(dismissUnsaved&&dialog.message().startsWith('Unsaved changes')){dismissUnsaved=false;void dialog.dismiss();}else void dialog.accept(); });
  const successDialog = (prefix) => page.waitForEvent('dialog', { predicate: d => prefix instanceof RegExp ? prefix.test(d.message()) : d.message().startsWith(prefix), timeout: 30000 });
  const exported = async (label) => {
    const download = page.waitForEvent('download');
    await page.getByRole('button',{name:label,exact:true}).click();
    return JSON.parse(await readFile(await (await download).path(), 'utf8'));
  };
  const imported = async (data, label, result) => {
    const chooser = page.waitForEvent('filechooser'); const done = successDialog(result);
    await page.getByRole('button',{name:label,exact:true}).click();
    await (await chooser).setFiles({ name: 'test-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
    await done;
  };
  await page.goto(`${base}/settings`, { waitUntil: 'networkidle' });
  await imported({version:2,exportedAt:'2026-10-09T00:00:00Z',accounts:[{id:1,name:'Main sentinel',archived:0}],assets:[{id:1,accountId:1,name:'Main asset',categories:'{}',archived:0}],snapshots:[{assetId:1,date:'2026-10',netWorth:42,inflow:42,profit:0}],transactions:[{id:999,date:'2026-10-09',type:'INCOME',value:42,cat:'main',note:'Main ledger sentinel'}],settings:{language:'en'}},'Import Data','Imported');
  const liveBefore=await exported('Export Data');
  const seeded = successDialog('Done');
  await page.getByText('Open Demo Ledger', { exact: true }).click(); await seeded;
  const seed = await exported('Export Data');
  assert.equal(seed.snapshots.length, 144); assert.equal(seed.transactions.length, 36);
  console.log('PASS atomic sample creation / export');
  await page.goto(`${base}/assets`,{waitUntil:'networkidle'});
  await page.getByRole('button',{name:'Enter data',exact:true}).click();
  await page.getByText('Checking',{exact:true}).click();
  await page.getByRole('textbox',{name:'Net Worth',exact:true}).waitFor();
  await page.getByRole('tab',{name:/Settings$/}).click();
  await page.getByRole('button',{name:'Return to My Ledger',exact:true}).click();
  await page.getByRole('tab',{name:/Assets$/}).click();
  await page.getByText('Main asset',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Enter data',exact:true}).click();
  await page.getByText('Main asset',{exact:true}).click();
  assert.equal(await page.getByRole('textbox',{name:'Net Worth',exact:true}).inputValue(),'42');
  await page.getByRole('tab',{name:/Settings$/}).click();
  await page.getByText('Open Demo Ledger',{exact:true}).click();
  await page.getByRole('button',{name:'Return to My Ledger',exact:true}).waitFor();
  console.log('PASS clean demo entry baselines cannot carry over to a matching main asset ID');


  const snapshot = seed.snapshots[0];
  await page.goto(`${base}/modals/add-record?assetId=${snapshot.assetId}&date=${snapshot.date}`, {waitUntil:'networkidle'});
  const amount = page.getByRole('textbox', {name:'Net Worth',exact:true});
  await amount.waitFor();
  await page.waitForFunction(() => !document.querySelector('input[aria-label="Net Worth"]').readOnly);
  assert.equal(await amount.inputValue(),String(snapshot.netWorth));
  await page.evaluate(() => { window.__cicadaPauseSQL = true; });
  await page.locator('input[type=month]').fill('2030-01');
  assert.equal(await amount.isEditable(),false);
  assert.equal(await page.getByRole('button',{name:'Save',exact:true}).isEnabled(),false);
  assert.equal(await page.getByText('Delete',{exact:true}).count(),0);
  await page.evaluate(() => window.__cicadaFlushSQL());
  await page.waitForFunction(() => !document.querySelector('input[aria-label="Net Worth"]').readOnly);
  assert.equal(await amount.inputValue(),'');
  console.log('PASS delayed month loading blocks stale amount writes and deletes');


  await page.goto(`${base}/modals/add-transaction`, { waitUntil: 'networkidle' });
  const transactionDate=`${seed.snapshots.at(-1).date}-17`;
  await page.locator('input[type=date]').fill(transactionDate);
  await page.locator('input').nth(1).fill('1,000.15');
  await page.getByRole('textbox',{name:/^Tags/}).fill('regressionTag');
  await page.locator('textarea').fill('automated amount/date regression');
  await page.getByText('Save', { exact: true }).click();
  await page.waitForURL(url => !url.pathname.includes('add-transaction'));
  await page.goto(`${base}/settings`, { waitUntil: 'networkidle' });
  let before = await exported('Export Data');
  const transaction = before.transactions.find(row => row.note === 'automated amount/date regression');
  assert.equal(transaction.value, 1000.15); assert.equal(transaction.date, transactionDate);
  console.log('PASS formatted amount and web date editing');

  await page.goto(`${base}/transactions`,{waitUntil:'networkidle'});
  await page.getByRole('textbox',{name:'Search notes, tags, dates or amounts'}).fill('automated amount/date regression');
  await page.getByText('1 matching transactions',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Income',exact:true}).click();
  await page.getByText('0 matching transactions',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Outlay',exact:true}).click();
  await page.getByRole('button',{name:'regressionTag',exact:true}).click();
  await page.getByText('1 matching transactions',{exact:true}).waitFor();
  console.log('PASS transaction search combined with type and exact tag filters');

  await page.getByRole('button',{name:'Add Transaction',exact:true}).click();
  await page.getByRole('textbox',{name:'Value',exact:true}).fill('88.00');
  const back=page.getByRole('link',{name:/back|close/i}).or(page.getByRole('button',{name:/back|close/i})).first();
  dismissUnsaved=true;const cancelled=successDialog('Unsaved changes');
  await back.click();await cancelled;
  assert.ok(page.url().includes('add-transaction'));
  assert.equal(await page.getByRole('textbox',{name:'Value',exact:true}).inputValue(),'88.00');
  const discarded=successDialog('Unsaved changes');await back.click();await discarded;
  await page.waitForURL(url=>!url.pathname.includes('add-transaction'));
  console.log('PASS cancel/discard unsaved navigation without writing a transaction');

  await page.goto(`${base}/settings`,{waitUntil:'networkidle'});
  const wrong=structuredClone(before);
  const second=wrong.snapshots.filter(row=>row.assetId===snapshot.assetId).sort((a,b)=>a.date.localeCompare(b.date))[1];
  const originalProfit=second.profit;second.profit+=1.23;
  await imported(wrong,'Import Data','Imported');
  await page.goto(`${base}/modals/reconcile-asset?assetId=${snapshot.assetId}`,{waitUntil:'networkidle'});
  await page.getByText(second.date,{exact:true}).waitFor();
  await page.getByRole('button',{name:'Apply Profit Recalculation',exact:true}).click();
  await page.waitForURL(url=>!url.pathname.includes('reconcile-asset'));
  await page.goto(`${base}/settings`,{waitUntil:'networkidle'});
  const corrected=await exported('Export Data');
  assert.equal(corrected.snapshots.find(row=>row.assetId===snapshot.assetId&&row.date===second.date).profit,originalProfit);
  console.log('PASS previewed profit recalculation and automatic recovery copy');

  const last=corrected.snapshots.filter(row=>row.assetId===snapshot.assetId).sort((a,b)=>a.date.localeCompare(b.date)).at(-1);
  await page.goto(`${base}/modals/add-record?assetId=${last.assetId}&date=${last.date}`,{waitUntil:'networkidle'});
  await page.waitForFunction(()=>!document.querySelector('input[aria-label="Net Worth"]').readOnly);
  await page.evaluate(()=>{window.__cicadaPausePreview=true;});
  await page.getByText('Delete',{exact:true}).click();
  await page.waitForFunction(()=>window.__cicadaHasPausedPreview===true);
  assert.ok(page.url().includes('add-record'));
  await page.evaluate(()=>window.__cicadaFlushSQL());
  await page.waitForURL(url=>!url.pathname.includes('add-record'));
  await page.goto(`${base}/settings`,{waitUntil:'networkidle'});
  before=await exported('Export Data');
  assert.ok(!before.snapshots.some(row=>row.assetId===last.assetId&&row.date===last.date));
  console.log('PASS deleting an unchanged snapshot navigates back after a delayed preview');


  await imported({version:3,accounts:[{id:999}],assets:[],snapshots:[],transactions:[]}, 'Import Data', 'Import Failed');
  const after = await exported('Export Data');
  for (const key of ['accounts','assets','snapshots','transactions','settings','tombstones']) assert.deepEqual(after[key], before[key]);
  console.log('PASS invalid import preserves the entire ledger');

  const changed = structuredClone(before);
  changed.settings = [{key:'language',value:'zh',updated_at:'000000000000001-00000-aaaaaa'},{key:'currency',value:'¥',updated_at:'000000000000001-00000-aaaaaa'}];
  await imported(changed, 'Import Data', /^(Imported|已导入)/);
  await page.getByText('设置', {exact:true}).first().waitFor();
  const restored = await exported('导出数据');
  assert.equal(restored.transactions.length,37);
  const recovery = await exported('导出最近的自动备份');
  assert.equal(recovery.transactions.length,37);
  console.log('PASS immediate settings refresh / automatic recovery backup');

  await page.goto(`${base}/`, {waitUntil:'networkidle'});
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByText('总净值',{exact:true}).waitFor();
  assert.equal(errors.length,0,errors.join('\n'));
  console.log('PASS cached offline reload / no uncaught page errors');
  await context.setOffline(false);
  await page.goto(`${base}/settings`,{waitUntil:'networkidle'});
  await page.getByText('返回我的账本',{exact:true}).click();
  await page.getByText('Open Demo Ledger',{exact:true}).waitFor();
  const liveAfter=await exported('Export Data');
  for(const key of ['accounts','assets','snapshots','transactions','settings','tombstones'])assert.deepEqual(liveAfter[key],liveBefore[key]);
  console.log('PASS isolated demo ledger leaves the main ledger and settings unchanged');
  await context.close();
} finally { await browser.close(); }
