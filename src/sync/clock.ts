import { getDatabase } from '../db/database';
import type { CicadaDB } from '../db/migrations';
import { updateDatabaseClock } from './clock-core';
let queue:Promise<unknown>=Promise.resolve();
function enqueue(db:Promise<CicadaDB>,remote?:string) {
  const task=async()=>updateDatabaseClock(await db,Date.now(),remote);
  const run=queue.then(task,task);queue=run.catch(()=>undefined);return run;
}
/** Capture the owning DB before entering the global clock queue. */
export function tick(db?:CicadaDB):Promise<string> { return enqueue(db?Promise.resolve(db):getDatabase()); }
export async function receiveRemote(stamp:string):Promise<void> { await enqueue(getDatabase(),stamp); }
