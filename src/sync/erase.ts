import type { CicadaDB } from '../db/migrations';
import { recordTombstonesAt } from './tombstone';

export type EraseDeps = { tick: () => Promise<string> };

/**
 * Tombstone every live financial row (account/asset/snapshot/tran) at one fresh
 * HLC, then delete those rows. Settings, sync_state, and tombstone tables are
 * left intact (settings are never tombstoned — see merge.ts). The tombstones
 * are what propagate the deletion to the cloud and other devices on the next
 * sync; deleting the rows without tombstones (the old DROP TABLE reset) is why
 * data used to resurrect.
 */
export async function eraseAllData(db: CicadaDB, deps: EraseDeps): Promise<void> {
  const deletedAt = await deps.tick();

  const accounts = await db.getAllAsync<{ uuid: string }>('SELECT uuid FROM account');
  const assets = await db.getAllAsync<{ uuid: string }>('SELECT uuid FROM asset');
  const snapshots = await db.getAllAsync<{ k: string }>(
    `SELECT a.uuid || '|' || s.date AS k FROM asset_snapshot s JOIN asset a ON s.asset_id = a.id`
  );
  const trans = await db.getAllAsync<{ uuid: string }>('SELECT uuid FROM tran');

  // Not wrapped in a transaction: like restore, this is intentionally non-atomic on
  // Tauri desktop (withTransactionAsync is a no-op there). A crash mid-erase leaves
  // tombstones for still-present rows, which the next merge suppresses (tombstone
  // stamp >= row stamp), so the sequence still converges safely.
  await recordTombstonesAt(db, 'account', accounts.map((r) => r.uuid), deletedAt);
  await recordTombstonesAt(db, 'asset', assets.map((r) => r.uuid), deletedAt);
  await recordTombstonesAt(db, 'snapshot', snapshots.map((r) => r.k), deletedAt);
  await recordTombstonesAt(db, 'tran', trans.map((r) => r.uuid), deletedAt);

  // Delete in FK-safe order. Keep sync_state + tombstone.
  await db.runAsync('DELETE FROM tran');
  await db.runAsync('DELETE FROM asset_snapshot');
  await db.runAsync('DELETE FROM asset');
  await db.runAsync('DELETE FROM account');
}
