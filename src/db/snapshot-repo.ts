import { tick } from '../sync/clock';
import { requireAmount, requireId, requireMonth } from '../utils/validation';
import { getDatabase } from './database';
import { monthValuation, monthlyValuations, type ValuationOptions } from './valuation';
import { stampWrite, recordTombstonesAt } from '../sync/stamp';
import { bumpDirty } from '../sync/dirty';
import type { CicadaDB } from './migrations';
import type { AssetSnapshot, SnapshotWithAsset } from '../utils/types';

type SnapshotRow = {
  asset_id: number;
  date: string;
  net_worth: number;
  inflow: number;
  profit: number;
};

type SnapshotWithAssetRow = SnapshotRow & {
  account_name: string;
  asset_name: string;
};

function rowToSnapshot(r: SnapshotRow): AssetSnapshot {
  return {
    assetId: r.asset_id,
    date: r.date,
    netWorth: r.net_worth,
    inflow: r.inflow,
    profit: r.profit,
  };
}

export async function getSnapshot(
  assetId: number,
  date: string
): Promise<AssetSnapshot | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<SnapshotRow>(
    'SELECT * FROM asset_snapshot WHERE asset_id = ? AND date = ?',
    [assetId, date]
  );
  return row ? rowToSnapshot(row) : null;
}

export async function listSnapshotsByAsset(assetId: number): Promise<AssetSnapshot[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<SnapshotRow>(
    'SELECT * FROM asset_snapshot WHERE asset_id = ? ORDER BY date',
    [assetId]
  );
  return rows.map(rowToSnapshot);
}

export async function listSnapshotsByDate(date: string, options: ValuationOptions = {}): Promise<SnapshotWithAsset[]> {
  return monthValuation(await getDatabase(), date, options);
}

export async function listSnapshotsInRange(
  startDate: string,
  endDate: string
): Promise<SnapshotWithAsset[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<SnapshotWithAssetRow>(`
    SELECT s.*, acc.name AS account_name, a.name AS asset_name
    FROM asset_snapshot s
    JOIN asset a ON s.asset_id = a.id
    JOIN account acc ON a.account_id = acc.id
    WHERE s.date BETWEEN ? AND ?
    ORDER BY s.date, acc.name, a.name
  `, [startDate, endDate]);
  return rows.map(r => ({
    ...rowToSnapshot(r),
    accountName: r.account_name,
    assetName: r.asset_name,
  }));
}

export async function getLastSnapshotBefore(
  assetId: number,
  date: string
): Promise<AssetSnapshot | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<SnapshotRow>(
    'SELECT * FROM asset_snapshot WHERE asset_id = ? AND date < ? ORDER BY date DESC LIMIT 1',
    [assetId, date]
  );
  return row ? rowToSnapshot(row) : null;
}

/**
 * Composite tombstone keys ("<assetUuid>|<date>") for every snapshot belonging
 * to the given assets. Used by deleteAccount/deleteAsset to tombstone snapshots
 * that FK-cascade would otherwise erase silently.
 */
export async function collectSnapshotTombstoneKeys(
  db: CicadaDB,
  assetIds: number[]
): Promise<string[]> {
  if (assetIds.length === 0) return [];
  const placeholders = assetIds.map(() => '?').join(',');
  const rows = await db.getAllAsync<{ uuid: string; date: string }>(
    `SELECT a.uuid AS uuid, s.date AS date
       FROM asset_snapshot s
       JOIN asset a ON s.asset_id = a.id
      WHERE s.asset_id IN (${placeholders})`,
    assetIds
  );
  return rows.map((r) => `${r.uuid}|${r.date}`);
}

export async function upsertSnapshot(
  assetId: number,
  date: string,
  netWorth: number,
  inflow: number,
  profit: number
): Promise<void> {
  requireId(assetId, 'snapshot.assetId'); requireMonth(date, 'snapshot.date');
  requireAmount(netWorth, 'snapshot.netWorth'); requireAmount(inflow, 'snapshot.inflow'); requireAmount(profit, 'snapshot.profit');
  const db = await getDatabase();
  const { updatedAt } = await stampWrite(db, { withUuid: false });
  await db.runAsync(`
    INSERT INTO asset_snapshot (asset_id, date, net_worth, inflow, profit, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(asset_id, date) DO UPDATE SET
      net_worth = excluded.net_worth,
      inflow = excluded.inflow,
      profit = excluded.profit,
      updated_at = excluded.updated_at
  `, [assetId, date, netWorth, inflow, profit, updatedAt]);
  bumpDirty();
}

export async function deleteSnapshot(assetId: number, date: string): Promise<void> {
  const db = await getDatabase();
  const deletedAt = await tick();
  await db.withTransactionAsync(async (db) => {
    const asset = await db.getFirstAsync<{ uuid: string }>(
      'SELECT uuid FROM asset WHERE id = ?',
      [assetId]
    );
    await db.runAsync(
      'DELETE FROM asset_snapshot WHERE asset_id = ? AND date = ?',
      [assetId, date]
    );
    if (asset?.uuid) {
      await recordTombstonesAt(db, 'snapshot', [`${asset.uuid}|${date}`], deletedAt);
    }
  });
  bumpDirty();
}

export async function getDateRange(): Promise<{ start: string; end: string } | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ start: string; end: string }>(
    'SELECT MIN(date) AS start, MAX(date) AS end FROM asset_snapshot'
  );
  if (!row || !row.start) return null;
  return { start: row.start, end: row.end };
}

export async function getMonthlyTotals(startDate: string, endDate: string, options: ValuationOptions = {}) {
  return monthlyValuations(await getDatabase(), startDate, endDate, options);
}
export async function getTotalsForDate(date: string, options: ValuationOptions = {}): Promise<{ netWorth: number; inflow: number; profit: number }> {
  const rows = await monthValuation(await getDatabase(), date, options);
  return rows.reduce((total, row) => ({ netWorth: total.netWorth + row.netWorth, inflow: total.inflow + row.inflow, profit: total.profit + row.profit }), { netWorth: 0, inflow: 0, profit: 0 });
}
