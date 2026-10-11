import type { CicadaDB } from '../db/migrations';
import { advanceLocal,encodeHlc, type HlcState } from '../sync/hlc';
import { buildSampleData } from './sample-data-core';
import { restoreBackupDoc } from './backup-core';
/** Prepare the separate DB completely before publishing the new UI mode. */
export async function prepareDemo(db: CicadaDB, preferences: Record<string,string>) {
  await db.withTransactionAsync(async tx=>{
    const row=await tx.getFirstAsync<{value:string}>('SELECT value FROM sync_state WHERE key=?',['hlc']);
    const device=await tx.getFirstAsync<{value:string}>('SELECT value FROM sync_state WHERE key=?',['deviceId']);
    const next=advanceLocal(row?JSON.parse(row.value) as HlcState:{phys:0,counter:0},Date.now());
    const stamp=encodeHlc(next.phys,next.counter,device!.value);
    const marker=await tx.getFirstAsync<{value:string}>('SELECT value FROM sync_state WHERE key=?',['demo_initialized']);
    const count=await tx.getFirstAsync<{n:number}>('SELECT (SELECT COUNT(*) FROM account)+(SELECT COUNT(*) FROM tran) AS n');
    if(!marker&& !count?.n) {
      const sample=buildSampleData();sample.settings=preferences;
      await restoreBackupDoc(tx,sample,{freshStamp:stamp});
    } else {
      await tx.runAsync("DELETE FROM setting WHERE key IN ('currency','language','theme','gainColor','forwardFill')");
      for(const[key,value]of Object.entries(preferences))await tx.runAsync('INSERT INTO setting(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at',[key,value,stamp]);
    }
    await tx.runAsync('INSERT INTO sync_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',['hlc',JSON.stringify(next)]);
    await tx.runAsync('INSERT INTO sync_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',['demo_initialized','true']);
  });
}
