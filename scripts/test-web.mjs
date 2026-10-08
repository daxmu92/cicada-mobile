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
      window.__cicadaPauseSQL = false;
      for (const [worker, args] of queued.splice(0)) original.apply(worker, args);
    };
    Worker.prototype.postMessage = function (...args) {
      if (window.__cicadaPauseSQL && args[0]?.isSync === false) queued.push([this, args]);
      else original.apply(this, args);
    };
  });
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (dialog) => { void dialog.accept(); });
  const successDialog = (prefix) => page.waitForEvent('dialog', { predicate: d => prefix instanceof RegExp ? prefix.test(d.message()) : d.message().startsWith(prefix), timeout: 30000 });
  const exported = async (label) => {
    const download = page.waitForEvent('download');
    await page.getByText(label, { exact: true }).click();
    return JSON.parse(await readFile(await (await download).path(), 'utf8'));
  };
  const imported = async (data, label, result) => {
    const chooser = page.waitForEvent('filechooser'); const done = successDialog(result);
    await page.getByText(label, { exact: true }).click();
    await (await chooser).setFiles({ name: 'test-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
    await done;
  };
  await page.goto(`${base}/settings`, { waitUntil: 'networkidle' });
  const seeded = successDialog('Done');
  await page.getByText('Load Sample Data', { exact: true }).click(); await seeded;
  const seed = await exported('Export Data');
  assert.equal(seed.snapshots.length, 144); assert.equal(seed.transactions.length, 36);
  console.log('PASS atomic sample creation / export');

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
  await page.locator('input[type=date]').fill('2026-09-17');
  await page.locator('input').nth(1).fill('1,000.15');
  await page.locator('textarea').fill('automated amount/date regression');
  await page.getByText('Save', { exact: true }).click();
  await page.waitForURL(url => !url.pathname.includes('add-transaction'));
  await page.goto(`${base}/settings`, { waitUntil: 'networkidle' });
  const before = await exported('Export Data');
  const transaction = before.transactions.find(row => row.note === 'automated amount/date regression');
  assert.equal(transaction.value, 1000.15); assert.equal(transaction.date, '2026-09-17');
  console.log('PASS formatted amount and web date editing');

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
  await context.close();
} finally { await browser.close(); }
