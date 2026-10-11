import { ledgerWriteLock } from '../ledger/write-lock';
import { getLedgerMode,setLedgerMode, type LedgerMode } from '../ledger/mode';
import { assertLedgerIdentity } from '../ledger/identity';
import { getDatabase } from '../db/database';
import { syncScheduler } from '../sync/scheduler';
import { notifyDataChanged } from '../db/changes';
import { prepareDemo } from './demo-core';
export async function switchLedger(mode: LedgerMode) {
  const expected=getLedgerMode();
  await syncScheduler.runExclusive(()=>ledgerWriteLock.run(async () => {
    assertLedgerIdentity(expected,getLedgerMode());
    // Wait for queries already queued on the current database before switching.
    await (await getDatabase()).withTransactionAsync(async()=>{});
    if(mode==='demo') {
      const current=await getDatabase();
      const rows=await current.getAllAsync<{key:string;value:string}>('SELECT key,value FROM setting');
      const preferences=Object.fromEntries(rows.filter(row=>['currency','language','theme','gainColor','forwardFill'].includes(row.key)).map(row=>[row.key,row.value]));
      await prepareDemo(await getDatabase('demo'),preferences);
    }
    setLedgerMode(mode); notifyDataChanged();
  }));
}
