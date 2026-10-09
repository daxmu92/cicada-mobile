import type { CicadaDB } from '../db/migrations';
import type { Scheduler } from '../sync/scheduler';
import type { LedgerMode } from './mode';
import { assertLedgerIdentity } from './identity';
export function createLedgerMaintenance(deps: {
  runExclusive: Scheduler['runExclusive'];
  getMode:()=>LedgerMode;
  getDatabase:()=>Promise<CicadaDB>;
}) {
  return <T>(expected: LedgerMode, task:(db:CicadaDB,sync:()=>Promise<void>)=>Promise<T>)=>deps.runExclusive(async sync=>{
    assertLedgerIdentity(expected,deps.getMode());
    return task(await deps.getDatabase(),sync);
  });
}
