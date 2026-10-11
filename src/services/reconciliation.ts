import { runLedgerMaintenance } from './ledger-maintenance';
import { getLedgerMode } from '../ledger/mode';
import { getDatabase } from '../db/database';
import { tick } from '../sync/clock';
import { bumpDirty } from '../sync/dirty';
import { applyReconciliation, previewReconciliation, type ReconciliationPreview } from './reconciliation-core';
export async function getReconciliationPreview(assetId: number) {
  const ledgerMode=getLedgerMode();
  return {...await previewReconciliation(await getDatabase(ledgerMode),assetId),ledgerMode};
}
export async function confirmReconciliation(ticket: ReconciliationPreview & {ledgerMode: ReturnType<typeof getLedgerMode>}) {
  const {ledgerMode,...preview}=ticket;
  return runLedgerMaintenance(ledgerMode,async (db) => {
    const stamp=await tick();
    const count=await applyReconciliation(db,preview,stamp);
    if(count) bumpDirty();
    return count;
  });
}
