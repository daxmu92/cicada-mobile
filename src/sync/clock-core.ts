import type { CicadaDB } from '../db/migrations';
import { advanceLocal,encodeHlc,parseHlc,receive,type HlcState } from './hlc';
export async function updateDatabaseClock(db:CicadaDB,now:number,remote?:string):Promise<string> {
  let result!:string;
  await db.withTransactionAsync(async db=>{
  const row=await db.getFirstAsync<{value:string}>('SELECT value FROM sync_state WHERE key=?',['hlc']);
  const previous:HlcState=row?JSON.parse(row.value):{phys:0,counter:0};
  const next=remote?receive(previous,parseHlc(remote),now):advanceLocal(previous,now);
  const device=await db.getFirstAsync<{value:string}>('SELECT value FROM sync_state WHERE key=?',['deviceId']);
  if(!device)throw new Error('Device identity missing');
  await db.runAsync('INSERT INTO sync_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',['hlc',JSON.stringify(next)]);
  result=encodeHlc(next.phys,next.counter,device.value);
  });
  return result;
}
