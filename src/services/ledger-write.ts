import type { CicadaDB } from '../db/migrations';
import { getDatabase } from '../db/database';
import { getLedgerMode } from '../ledger/mode';
import { assertLedgerIdentity } from '../ledger/identity';
import { ledgerWriteLock } from '../ledger/write-lock';
export function runLedgerWrite<T>(task:(db:CicadaDB)=>Promise<T>):Promise<T> {
  const expected=getLedgerMode();
  return ledgerWriteLock.run(async()=>{
    assertLedgerIdentity(expected,getLedgerMode());
    return task(await getDatabase(expected));
  });
}
