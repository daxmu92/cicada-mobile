import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
const base=process.env.CICADA_WEB_URL??'http://localhost:8085';
const browser=await chromium.launch(process.env.CICADA_E2E_BROWSER?{executablePath:process.env.CICADA_E2E_BROWSER}:process.platform==='win32'?{channel:'msedge'}:{});
try{
 const context=await browser.newContext({viewport:{width:1280,height:1000},locale:'en-US'}),page=await context.newPage(),errors=[];
 page.setDefaultTimeout(15000);
 const activeText=text=>page.waitForFunction(text=>[...document.querySelectorAll('div')].some(node=>{
  if(node.textContent!==text)return false;
  for(let el=node;el;el=el.parentElement){const style=getComputedStyle(el);if(el.getAttribute('aria-hidden')==='true'||style.opacity==='0'||style.display==='none'||style.visibility==='hidden')return false;}return true;
 }),text);

 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>{void dialog.accept();});
 await page.goto(base+'/settings',{waitUntil:'networkidle'});
 const fixture={version:2,exportedAt:'2026-10-10T00:00:00Z',accounts:[{id:1,name:'Synthetic account',archived:0}],assets:[{id:1,accountId:1,name:'Alpha',categories:'{"风险":"低风险"}',archived:0},{id:2,accountId:1,name:'Beta',categories:'{"风险":"高风险"}',archived:0},{id:3,accountId:1,name:'Archived',categories:'{}',archived:1}],snapshots:[{assetId:1,date:'2026-01',netWorth:100,inflow:100,profit:0},{assetId:2,date:'2026-01',netWorth:200,inflow:200,profit:0},{assetId:3,date:'2026-01',netWorth:50,inflow:50,profit:0},{assetId:1,date:'2026-02',netWorth:110,inflow:5,profit:4},{assetId:1,date:'2026-05',netWorth:150,inflow:0,profit:40},{assetId:2,date:'2026-05',netWorth:230,inflow:0,profit:30}],transactions:[],settings:{language:'en',currency:'$',forwardFill:'true'}};
 const chooser=page.waitForEvent('filechooser'),done=page.waitForEvent('dialog',{predicate:d=>d.message().startsWith('Imported')});await page.getByRole('button',{name:'Import Data',exact:true}).click();await(await chooser).setFiles({name:'synthetic.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});await done;
 await page.getByRole('tab',{name:/Home$/}).click();await page.getByRole('button',{name:'View latest recorded month · 2026-05',exact:true}).click();
 await page.getByRole('button',{name:'Next month',exact:true}).click();
 await activeText('2026-06 · 0 / 2 current active assets recorded');
 await page.getByText('Profit',{exact:true}).locator('..').getByText('—',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Previous month',exact:true}).click();
 for(let i=0;i<3;i++)await page.getByRole('button',{name:'Previous month',exact:true}).click();
 await activeText('2026-02 · 1 / 2 current active assets recorded');
 await page.getByText('Comparable net-worth change',{exact:true}).locator('..').getByText('$10.00',{exact:true}).waitFor();
 await page.getByText('Unexplained difference',{exact:true}).locator('..').getByText('$1.00',{exact:true}).waitFor();
 console.log('PASS coverage and comparable change exclude missing assets and retain residual');
 await page.getByRole('tab',{name:/Assets$/}).click();await activeText('2026-02 · 1 / 2 current active assets recorded');
 await page.getByRole('textbox',{name:'Search assets or accounts',exact:true}).fill('Beta');assert.equal(await page.getByText('Alpha',{exact:true}).count(),0);await page.getByRole('textbox',{name:'Search assets or accounts',exact:true}).fill('');
 await page.getByRole('button',{name:'高风险',exact:true}).click();assert.equal(await page.getByText('Alpha',{exact:true}).count(),0);await page.getByRole('button',{name:'All categories',exact:true}).click();
 console.log('PASS shared observation month and asset search/category filters');
 await page.getByRole('tab',{name:/Home$/}).click();await page.getByRole('button',{name:'Previous month',exact:true}).click();await page.getByText('$350.00',{exact:true}).waitFor();
 await page.getByRole('tab',{name:/Insights$/}).click();await activeText('Jan 2026');
 console.log('PASS archived records remain in historical totals and Analysis shares the month');
 await page.getByText('3Y',{exact:true}).click();
 const chart=page.locator('svg[aria-label="Net worth trend"]').last();await chart.locator('circle').last().click({force:true});
 await page.getByText('1Y',{exact:true}).click();await activeText('Jan 2026');assert.deepEqual(errors,[]);
 console.log('PASS selected trend points remain safe when shortening the range');
 await page.getByRole('tab',{name:/Assets$/}).click();await page.getByText('Alpha',{exact:true}).click();await page.waitForURL(/asset\/1$/);await page.getByText('All',{exact:true}).filter({visible:true}).last().click();
 await page.waitForFunction(()=>[...document.querySelectorAll('svg[aria-label="Net worth trend"]')].some(svg=>{
  for(let el=svg;el;el=el.parentElement){const style=getComputedStyle(el);if(el.getAttribute('aria-hidden')==='true'||style.opacity==='0'||style.display==='none'||style.visibility==='hidden')return false;}
  return (svg.querySelector('path')?.getAttribute('d')??'').split('M').length>=3;
 }));
 console.log('PASS asset detail retains calendar gaps');


 await page.goto(base+'/modals/add-transaction',{waitUntil:'networkidle'});
 const amount=page.getByRole('textbox',{name:'Value',exact:true});await amount.fill('123.45');await page.locator('textarea').fill('Synthetic durable draft');await page.getByText('Local recovery draft saved',{exact:true}).waitFor();
 await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:'Restore draft',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Save',exact:true}).isEnabled(),false);await page.getByRole('button',{name:'Restore draft',exact:true}).click();assert.equal(await amount.inputValue(),'123.45');assert.equal(await page.locator('textarea').inputValue(),'Synthetic durable draft');
 await page.getByRole('button',{name:'Save',exact:true}).click();await page.waitForURL(url=>!url.pathname.includes('add-transaction'));
 await page.goto(base+'/modals/add-transaction',{waitUntil:'networkidle'});assert.equal(await page.getByRole('button',{name:'Restore draft',exact:true}).count(),0);
 console.log('PASS transaction draft survives reload and clears only after a successful save');
 await page.goto(base+'/modals/add-record?assetId=1&date=2026-02',{waitUntil:'networkidle'});
 await page.getByRole('textbox',{name:'Net Worth',exact:true}).fill('111.00');await page.getByText('Local recovery draft saved',{exact:true}).waitFor();
 await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:'Restore draft',exact:true}).click();assert.equal(await page.getByRole('textbox',{name:'Net Worth',exact:true}).inputValue(),'111.00');
 await page.getByRole('button',{name:'Update',exact:true}).click();await page.waitForURL(url=>!url.pathname.includes('add-record'));
 await page.goto(base+'/assets',{waitUntil:'networkidle'});await page.getByRole('button',{name:'Enter data',exact:true}).click();await page.getByText('Alpha',{exact:true}).click();
 await page.getByRole('textbox',{name:'Net Worth',exact:true}).fill('333.00');await page.getByText('Local recovery draft saved',{exact:true}).waitFor();
 await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:'Enter data',exact:true}).click();await page.getByRole('button',{name:'Restore draft',exact:true}).click();assert.equal(await page.getByRole('textbox',{name:'Net Worth',exact:true}).inputValue(),'333.00');
 await page.getByText('Submit (1)',{exact:true}).click();await page.getByRole('button',{name:'Enter data',exact:true}).waitFor();
 console.log('PASS snapshot and batch drafts survive reload and commit without stale recovery copies');

 assert.deepEqual(errors,[]);await context.close();
}finally{await browser.close();}
