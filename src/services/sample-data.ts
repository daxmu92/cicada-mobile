import { runLedgerMaintenance } from './ledger-maintenance';
import { buildSampleData } from './sample-data-core';
import { isDemoLedger, getLedgerMode } from '../ledger/mode';
import { tick } from '../sync/clock';
import { syncScheduler } from '../sync/scheduler';
import { notifyDataChanged } from '../db/changes';
import { replaceBackupDoc } from './backup-core';

export { buildSampleData } from './sample-data-core';

export async function loadSampleData(options: { monthsOfHistory?: number; transactionsPerMonth?: number } = {}): Promise<void> {
  if (!isDemoLedger()) throw new Error('Sample data is only available in the demo ledger');
  const expected=getLedgerMode();
  const data = buildSampleData(options);
  await runLedgerMaintenance(expected,async (db,sync) => {
    if(!isDemoLedger())throw new Error('Sample data is only available in the demo ledger');
    const settings=await db.getAllAsync<{key:string;value:string}>('SELECT key,value FROM setting');
    data.settings=Object.fromEntries(settings.map(row=>[row.key,row.value]));
    await sync().catch(() => {});
    const deletedAt = await tick(); const freshStamp = await tick();
    await replaceBackupDoc(db, data, { deletedAt, freshStamp });
    notifyDataChanged(); syncScheduler.markDirty();
    await sync().catch(() => {});
  });
}
