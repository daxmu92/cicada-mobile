import { ledgerWriteLock } from '../ledger/write-lock';
import { createLedgerMaintenance } from '../ledger/maintenance-core';
import { getLedgerMode } from '../ledger/mode';
import { syncScheduler } from '../sync/scheduler';
import { getDatabase } from '../db/database';
export const runLedgerMaintenance=createLedgerMaintenance({runExclusive:(task)=>syncScheduler.runExclusive(sync=>ledgerWriteLock.run(()=>task(sync))),getMode:getLedgerMode,getDatabase});
