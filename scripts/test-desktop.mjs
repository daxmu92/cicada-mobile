import {exerciseNativeSync} from './test-native-sync.ts';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import Database from 'better-sqlite3';
import path from 'node:path';
const endpoint=process.env.CICADA_DESKTOP_CDP;
if(!endpoint)throw new Error('Run through scripts/test-desktop.ps1 with an isolated test application');
let browser;
for(let attempt=0;attempt<30;attempt++){
 try{browser=await chromium.connectOverCDP(endpoint);if(browser.contexts()[0]?.pages()[0])break;await browser.close();browser=undefined;}catch{ await new Promise(r=>setTimeout(r,500));}
}
if(!browser)throw new Error('Isolated WebView2 did not start');
try{
 const page=browser.contexts()[0].pages()[0];
 await page.waitForURL(url=>url.hostname==='tauri.localhost',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>Boolean(window.__TAURI_INTERNALS__?.invoke));
 await page.locator('body').waitFor();
 assert.equal(await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('plugin:app|name')),'CicadaNativeSmoke','Refusing to modify a production app');
 page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>{void d.accept();});
 const css=await page.evaluate(()=>{
  const style=document.createElement('style');style.textContent='.cicada-style-probe{width:37px;position:fixed;display:none}';document.head.append(style);
  const element=document.createElement('div');element.className='cicada-style-probe';document.body.append(element);
  const attr=document.createElement('div');attr.setAttribute('style','margin-left:23px');document.body.append(attr);
  const computed=getComputedStyle(element);const result={width:computed.width,position:computed.position,display:computed.display,margin:getComputedStyle(attr).marginLeft};
  element.remove();attr.remove();style.remove();return result;
 });
 assert.deepEqual(css,{width:'37px',position:'fixed',display:'none',margin:'23px'});
 console.log('PASS actual bundled CSP permits runtime styles and style attributes');
 await page.getByTestId('desktop-navigation').waitFor();
 await page.getByTestId('desktop-toolbar').waitFor();
 const nativeSidebar=await page.getByTestId('desktop-navigation').boundingBox();assert.equal(nativeSidebar.x,0);assert([76,212].some(width=>Math.abs(width-nativeSidebar.width)<1),JSON.stringify(nativeSidebar));
 console.log('PASS native Windows uses desktop side navigation and a persistent toolbar');
 await page.getByRole('tab',{name:/Home$/}).click();await page.getByText('Total Net Worth',{exact:true}).waitFor({state:'visible'});
 await page.getByRole('tab',{name:/Assets$/}).click();await page.getByRole('button',{name:'Accounts & Assets',exact:true}).waitFor({state:'visible'});
 await page.getByRole('tab',{name:/Settings$/}).click();await page.getByText('€',{exact:true}).click();
 await page.waitForFunction(async()=>{const rows=await window.__TAURI_INTERNALS__.invoke('plugin:sql|select',{db:'sqlite:cicada.db',query:"SELECT value FROM setting WHERE key='currency'",values:[]});return rows[0]?.value==='€';});
 await page.getByTestId('desktop-settings-feedback').getByText('Saved',{exact:true}).waitFor();
 console.log('PASS desktop settings click persists through native SQLite and clock transaction');
 const identifier=process.env.CICADA_SMOKE_IDENTIFIER;
 assert.match(identifier??'',/^com\.daxmu\.cicada\.native-smoke\.[a-f0-9]{32}$/,'Refusing to open a production ledger');
 const holder=new Database(path.join(process.env.APPDATA,identifier,'cicada.db'),{fileMustExist:true});
 try{
  const actualFiles=await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('plugin:sql|select',{db:'sqlite:cicada.db',query:'PRAGMA database_list',values:[]}));
  const expectedFile=path.join(process.env.APPDATA,identifier,'cicada.db');
  assert.equal(path.normalize(actualFiles.find(file=>file.name==='main').file).toLowerCase(),path.normalize(expectedFile).toLowerCase(),'Native and external lock checks must use the same isolated database');
  assert.equal(holder.prepare("SELECT value FROM setting WHERE key='currency'").get()?.value,'€','Initial preference must be committed before acquiring the test lock');
  holder.exec('BEGIN IMMEDIATE');
  await page.getByText('£',{exact:true}).click();
  await page.getByTestId('desktop-settings-feedback').getByText(/Close other Cicada windows/).waitFor();
  assert.equal(holder.prepare("SELECT value FROM setting WHERE key='currency'").get().value,'€','Failed settings must preserve their previous value');
 }finally{if(holder.inTransaction)holder.exec('ROLLBACK');holder.close();}
 await page.getByText('£',{exact:true}).click();
 await page.waitForFunction(async()=>{const rows=await window.__TAURI_INTERNALS__.invoke('plugin:sql|select',{db:'sqlite:cicada.db',query:"SELECT value FROM setting WHERE key='currency'",values:[]});return rows[0]?.value==='£';});
 console.log('PASS another connection holding a write lock reports cause, preserves setting, and retries after release');

 await page.getByText('Open Demo Ledger',{exact:true}).click();await page.getByRole('button',{name:'Return to My Ledger',exact:true}).waitFor({state:'visible'});
 await page.getByRole('tab',{name:/Home$/}).click();await page.getByText('Total Net Worth',{exact:true}).waitFor({state:'visible'});
 await page.getByRole('tab',{name:/Assets$/}).click();await page.getByText('Checking',{exact:true}).waitFor({state:'visible'});
 await page.evaluate(()=>{
  const original=window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
  window.__cicadaFinancialReads=0;
  window.__TAURI_INTERNALS__.invoke=(command,args)=>{
   if(/(?:plugin:sql\|select|cicada_transaction_query)/.test(command)&&/\b(?:account|asset|asset_snapshot|tran)\b/i.test(args?.query??args?.sql??''))window.__cicadaFinancialReads++;
   return original(command,args);
  };
 });
 await page.waitForTimeout(250);
 for(let i=0;i<2;i++){
  await page.getByRole('tab',{name:/Home$/}).click();await page.getByText('Total Net Worth',{exact:true}).waitFor({state:'visible'});
  await page.getByRole('tab',{name:/Assets$/}).click();await page.getByText('Checking',{exact:true}).waitFor({state:'visible'});
 }
 assert.equal(await page.evaluate(()=>window.__cicadaFinancialReads),0,'Revisiting warm Home/Assets must reuse financial reads');
 console.log('PASS native warm Home/Assets navigation performs zero financial queries');
 await page.getByRole('tab',{name:/Settings$/}).click();
 for(const color of ['red','green','red','green']){
  const started=Date.now();
  await page.getByText(color==='red'?'Red ▲':'Green ▲',{exact:true}).click();
  await page.waitForFunction(async color=>{const rows=await window.__TAURI_INTERNALS__.invoke('plugin:sql|select',{db:'sqlite:cicada-demo.db',query:"SELECT value FROM setting WHERE key='gainColor'",values:[]});return rows[0]?.value===color;},color);
  console.log('GAIN COLOR',color,Date.now()-started);
 }
 assert.equal(await page.evaluate(()=>window.__cicadaFinancialReads),0,'Appearance changes must not reload financial data');
 await exerciseNativeSync(page);
 await page.getByRole('tab',{name:/Transactions$/}).click();await page.getByRole('button',{name:'Add Transaction',exact:true}).click();
 await page.getByRole('textbox',{name:'Value',exact:true}).fill('12.34');await page.locator('textarea').fill('Native synthetic recovery');await page.getByText('Local recovery draft saved',{exact:true}).waitFor();
 await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('button',{name:'Restore draft',exact:true}).click();assert.equal(await page.getByRole('textbox',{name:'Value',exact:true}).inputValue(),'12.34');
 await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('plugin:sql|execute',{db:'sqlite:cicada-demo.db',query:"CREATE TRIGGER block_native_draft_cleanup BEFORE DELETE ON local_draft WHEN OLD.key='transaction:new' BEGIN SELECT RAISE(ABORT,'Synthetic cleanup failure'); END",values:[]}));
 const failedSave=page.waitForEvent('dialog');await page.getByRole('button',{name:'Save',exact:true}).click();assert.match((await failedSave).message(),/Could not save/);
 const rollback=await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('plugin:sql|select',{db:'sqlite:cicada-demo.db',query:"SELECT (SELECT COUNT(*) FROM tran WHERE note='Native synthetic recovery') AS n,(SELECT COUNT(*) FROM local_draft WHERE key='transaction:new') AS drafts",values:[]}));
 assert.equal(rollback[0].n,0);assert.equal(rollback[0].drafts,1);
 await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('plugin:sql|execute',{db:'sqlite:cicada-demo.db',query:'DROP TRIGGER block_native_draft_cleanup',values:[]}));
 await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForFunction(async()=>{
  const rows=await window.__TAURI_INTERNALS__.invoke('plugin:sql|select',{db:'sqlite:cicada-demo.db',query:"SELECT (SELECT COUNT(*) FROM tran WHERE note='Native synthetic recovery') AS n,(SELECT COUNT(*) FROM local_draft WHERE key='transaction:new') AS drafts",values:[]});return rows[0]?.n===1&&rows[0]?.drafts===0;
 });
 console.log('PASS actual native draft reload, cleanup-failure rollback and single transaction after retry');
 await page.getByRole('tab',{name:/Settings$/}).click();

 await page.getByText('中文',{exact:true}).click();
 await page.getByRole('button',{name:'返回我的账本',exact:true}).click();await page.getByRole('tab',{name:/Home$/}).click();await page.getByText('Total Net Worth',{exact:true}).waitFor({state:'visible'});
 await page.getByRole('tab',{name:/Settings$/}).click();await page.getByText('中文',{exact:true}).click();await page.getByRole('tab',{name:/首页$/}).click();await page.getByText('总净值',{exact:true}).waitFor({state:'visible'});
 for(const node of await page.getByText(/^(正在加载账本…|Loading ledger…)$/).all()){
  const shown=await node.evaluate(element=>{
   for(let current=element;current;current=current.parentElement){
    const style=getComputedStyle(current);
    if(current.getAttribute('aria-hidden')==='true'||style.opacity==='0'||style.display==='none'||style.visibility==='hidden')return false;
   }
   return true;
  });
  assert.equal(shown,false,'Active screen must not remain on the ledger loading placeholder');
 }
 await page.waitForTimeout(7000);assert.deepEqual(errors,[]);
 console.log('PASS native demo/main switching, Chinese UI and font loading without page errors');
}finally{await browser.close();}
