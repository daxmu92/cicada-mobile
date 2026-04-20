import { getDatabase } from './database';
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

export async function listSnapshotsByDate(date: string): Promise<SnapshotWithAsset[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<SnapshotWithAssetRow>(`
    SELECT s.*, acc.name AS account_name, a.name AS asset_name
    FROM asset_snapshot s
    JOIN asset a ON s.asset_id = a.id
    JOIN account acc ON a.account_id = acc.id
    WHERE s.date = ?
    ORDER BY acc.name, a.name
  `, [date]);
  return rows.map(r => ({
    ...rowToSnapshot(r),
    accountName: r.account_name,
    assetName: r.asset_name,
  }));
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

export async function upsertSnapshot(
  assetId: number,
  date: string,
  netWorth: number,
  inflow: number,
  profit: number
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`
    INSERT INTO asset_snapshot (asset_id, date, net_worth, inflow, profit)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(asset_id, date) DO UPDATE SET
      net_worth = excluded.net_worth,
      inflow = excluded.inflow,
      profit = excluded.profit
  `, [assetId, date, netWorth, inflow, profit]);
}

export async function deleteSnapshot(assetId: number, date: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'DELETE FROM asset_snapshot WHERE asset_id = ? AND date = ?',
    [assetId, date]
  );
}

export async function getDateRange(): Promise<{ start: string; end: string } | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ start: string; end: string }>(
    'SELECT MIN(date) AS start, MAX(date) AS end FROM asset_snapshot'
  );
  if (!row || !row.start) return null;
  return { start: row.start, end: row.end };
}

export async function getMonthlyTotals(
  startDate: string,
  endDate: string
): Promise<Array<{ date: string; netWorth: number; profit: number; inflow: number }>> {
  const db = await getDatabase();
  return db.getAllAsync<{ date: string; netWorth: number; profit: number; inflow: number }>(
    `SELECT date,
      SUM(net_worth) AS netWorth,
      SUM(profit)    AS profit,
      SUM(inflow)    AS inflow
    FROM asset_snapshot
    WHERE date BETWEEN ? AND ?
    GROUP BY date
    ORDER BY date`,
    [startDate, endDate]
  );
}

export async function getTotalsForDate(date: string): Promise<{
  netWorth: number;
  inflow: number;
  profit: number;
}> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{
    net_worth: number | null;
    inflow: number | null;
    profit: number | null;
  }>(`
    SELECT
      SUM(net_worth) AS net_worth,
      SUM(inflow) AS inflow,
      SUM(profit) AS profit
    FROM asset_snapshot
    WHERE date = ?
  `, [date]);
  return {
    netWorth: row?.net_worth ?? 0,
    inflow: row?.inflow ?? 0,
    profit: row?.profit ?? 0,
  };
}
