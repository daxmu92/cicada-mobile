import assert from 'node:assert/strict';
import type {Page} from 'playwright-core';
import type {CicadaDB,SqlParam} from '../src/db/migrations';
import {buildDocument,serializeDocument} from '../src/sync/document';
import {runSync} from '../src/sync/sync';
import type {SyncRemote} from '../src/sync/providers/types';
/** Real native SQLite; an in-memory remote avoids touching personal cloud credentials. */
export async function exerciseNativeSync(page:Page){
 const url='sqlite:cicada-demo.db';let ledgerWrites=0;
 const numbered=(sql:string)=>{let index=0;return sql.replace(/\?/g,()=>`$${++index}`);};
 const invoke=<T>(cmd:string,args:Record<string,unknown>)=>page.evaluate(({cmd,args})=>(window as unknown as {__TAURI_INTERNALS__:{invoke:<T=any>(command:string,args:Record<string,unknown>)=>Promise<T>}}).__TAURI_INTERNALS__.invoke(cmd,args),{cmd,args}) as Promise<T>;
 const scoped=(id?:string):CicadaDB=>{
  const select=<T>(sql:string,params:SqlParam[]=[])=>id?invoke<T[]>('cicada_transaction_query',{transactionId:id,sql:numbered(sql),params,select:true}):invoke<T[]>('plugin:sql|select',{db:url,query:numbered(sql),values:params});
  const db:CicadaDB={
   getAllAsync:select,
   getFirstAsync:async(sql,params)=>(await select(sql,params))[0] as any??null,
   runAsync:async(sql,params=[])=>{
    if(/(?:INSERT INTO|UPDATE|DELETE FROM) (?:account|asset|asset_snapshot|tran|setting)\b/i.test(sql))ledgerWrites++;
    if(id)return invoke('cicada_transaction_query',{transactionId:id,sql:numbered(sql),params,select:false});
    const r=await invoke<{lastInsertId:number;rowsAffected:number}>('plugin:sql|execute',{db:url,query:numbered(sql),values:params});return{lastInsertRowId:r.lastInsertId??0,changes:r.rowsAffected};
   },
   execAsync:async sql=>{await db.runAsync(sql);},
   withTransactionAsync:async task=>{
    if(id){await task(db);return;}
    const next=await invoke<string>('cicada_begin_transaction',{databaseUrl:url});
    try{await task(scoped(next));await invoke('cicada_end_transaction',{transactionId:next,commit:true});}
    catch(e){await invoke('cicada_end_transaction',{transactionId:next,commit:false});throw e;}
   },
  };return db;
 };
 const db=scoped();
 await db.runAsync(`WITH RECURSIVE months(date) AS (SELECT '2000-01' UNION ALL SELECT strftime('%Y-%m',date(date||'-01','+1 month')) FROM months WHERE date<'2049-12')
 INSERT OR IGNORE INTO asset_snapshot(asset_id,date,net_worth,inflow,profit,updated_at) SELECT a.id,m.date,1000,0,0,a.updated_at FROM asset a CROSS JOIN months m`);
 const doc=await buildDocument(db,{generatedBy:'test',generatedAt:new Date().toISOString()});
 assert(doc.tables.snapshot.length>3000,'Large-ledger fixture must exceed 3,000 snapshots');
 let content=serializeDocument(doc);const remote:SyncRemote={isConnected:()=>true,testConnection:async()=>{},read:async()=>({content,etag:'test'}),write:async next=>{content=next;return{etag:'test-next'};}};
 ledgerWrites=0;const started=Date.now();
 const sync=runSync({db,remote,deviceId:'test',now:()=>Date.now(),getState:async key=>(await db.getFirstAsync<{value:string}>('SELECT value FROM sync_state WHERE key=?',[key]))?.value??null,setState:async(key,value)=>{await db.runAsync('INSERT INTO sync_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',[key,value]);},receiveRemote:async()=>{}});
 const click=Date.now();await page.getByText('Red ▲',{exact:true}).click();
 await page.waitForFunction(async()=>{const rows=await (window as unknown as {__TAURI_INTERNALS__:{invoke:<T=any>(command:string,args:Record<string,unknown>)=>Promise<T>}}).__TAURI_INTERNALS__.invoke('plugin:sql|select',{db:'sqlite:cicada-demo.db',query:"SELECT value FROM setting WHERE key='gainColor'",values:[]});return rows[0]?.value==='red';});
 const elapsed=Date.now()-click;await sync;
 assert.equal(ledgerWrites,0,'An unchanged large ledger must not be rewritten during sync');
 assert(elapsed<2000,`Color change blocked for ${elapsed}ms during native sync`);
 console.log(`PASS native ${doc.tables.snapshot.length}-snapshot sync: zero ledger rewrites, color save ${elapsed}ms, sync ${Date.now()-started}ms`);
}
