import type { CicadaDB } from '../db/migrations';
import { computeProfit } from '../utils/snapshot-calc';
import { minorUnits } from '../utils/money';
import { requireId } from '../utils/validation';
import { saveRecoveryBackup } from './backup-core';

type Source = { date: string; net_worth: number; inflow: number; profit: number; updated_at: string };
export type ReconciliationPreview = {
  assetId: number; assetUuid: string; source: Source[];
  changes: { date: string; before: number; after: number; previousDate: string }[];
};
async function readSource(db: CicadaDB, assetId: number) {
  return db.getAllAsync<Source>('SELECT date,net_worth,inflow,profit,updated_at FROM asset_snapshot WHERE asset_id=? ORDER BY date',[assetId]);
}
export async function previewReconciliation(db: CicadaDB, assetId: number): Promise<ReconciliationPreview> {
  requireId(assetId,'asset.id');
  let preview!: ReconciliationPreview;
  await db.withTransactionAsync(async (tx) => {
    const asset = await tx.getFirstAsync<{ uuid: string }>('SELECT uuid FROM asset WHERE id=?',[assetId]);
    if (!asset) throw new Error('Asset not found');
    const source = await readSource(tx,assetId);
    const changes: ReconciliationPreview['changes'] = [];
    for (let i=1;i<source.length;i++) {
      const before = source[i]; const previous = source[i-1];
      const after = computeProfit(before.net_worth,previous.net_worth,before.inflow);
      if (minorUnits(after)!==minorUnits(before.profit)) changes.push({date:before.date,before:before.profit,after,previousDate:previous.date});
    }
    preview={assetId,assetUuid:asset.uuid,source,changes};
  });
  return preview;
}
/** Apply only the preview the user confirmed; concurrent edits invalidate it. */
export async function applyReconciliation(db: CicadaDB, preview: ReconciliationPreview, stamp: string): Promise<number> {
  let count=0;
  await db.withTransactionAsync(async (tx) => {
    const latest = await previewReconciliation(tx,preview.assetId);
    if (JSON.stringify(latest)!==JSON.stringify(preview)) throw new Error('RECONCILIATION_CHANGED');
    if (!latest.changes.length) return;
    await saveRecoveryBackup(tx);
    for (const change of latest.changes) {
      await tx.runAsync('UPDATE asset_snapshot SET profit=?,updated_at=? WHERE asset_id=? AND date=?',[change.after,stamp,preview.assetId,change.date]);
      count++;
    }
  });
  return count;
}
