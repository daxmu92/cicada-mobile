import { getDatabase } from './database';
import { listAssets } from './asset-repo';
import type { AssetSnapshot, SnapshotWithAsset } from '../utils/types';
import { stampWrite } from '../sync/stamp';

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

export async function listSnapshotsByDate(
  date: string,
  opts?: { forwardFill?: boolean }
): Promise<SnapshotWithAsset[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<SnapshotWithAssetRow>(`
    SELECT s.*, acc.name AS account_name, a.name AS asset_name
    FROM asset_snapshot s
    JOIN asset a ON s.asset_id = a.id
    JOIN account acc ON a.account_id = acc.id
    WHERE s.date = ? AND a.archived = 0
    ORDER BY acc.name, a.name
  `, [date]);
  const exact: SnapshotWithAsset[] = rows.map(r => ({
    ...rowToSnapshot(r),
    accountName: r.account_name,
    assetName: r.asset_name,
  }));

  if (!opts?.forwardFill) return exact;

  const assets = await listAssets();
  const byId = new Map<number, SnapshotWithAsset>();
  for (const s of exact) byId.set(s.assetId, s);

  const result: SnapshotWithAsset[] = [];
  for (const asset of assets) {
    const existing = byId.get(asset.id);
    if (existing) {
      result.push(existing);
      continue;
    }
    const prev = await getLastSnapshotBefore(asset.id, date);
    if (!prev) continue; // asset with no prior history — skip
    result.push({
      assetId: asset.id,
      date,
      netWorth: prev.netWorth,
      inflow: 0,
      profit: 0,
      accountName: asset.accountName,
      assetName: asset.name,
    });
  }

  result.sort((a, b) => {
    const cmp = a.accountName.localeCompare(b.accountName);
    return cmp !== 0 ? cmp : a.assetName.localeCompare(b.assetName);
  });
  return result;
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
    `SELECT s.date AS date,
      SUM(s.net_worth) AS netWorth,
      SUM(s.profit)    AS profit,
      SUM(s.inflow)    AS inflow
    FROM asset_snapshot s
    JOIN asset a ON s.asset_id = a.id
    WHERE s.date BETWEEN ? AND ? AND a.archived = 0
    GROUP BY s.date
    ORDER BY s.date`,
    [startDate, endDate]
  );
}

export async function getTotalsForDate(
  date: string,
  opts?: { forwardFill?: boolean }
): Promise<{
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
      SUM(s.net_worth) AS net_worth,
      SUM(s.inflow) AS inflow,
      SUM(s.profit) AS profit
    FROM asset_snapshot s
    JOIN asset a ON s.asset_id = a.id
    WHERE s.date = ? AND a.archived = 0
  `, [date]);
  const base = {
    netWorth: row?.net_worth ?? 0,
    inflow: row?.inflow ?? 0,
    profit: row?.profit ?? 0,
  };

  if (!opts?.forwardFill) return base;

  // Find assets without an exact-date snapshot and add their last-known netWorth.
  // Only consider non-archived assets; the forward-fill set already does via
  // listAssets() below, but we also filter the "exact" lookup to archived=0
  // so archived snapshots on this date don't mark an asset as having one.
  const exactRows = await db.getAllAsync<{ asset_id: number }>(
    `SELECT s.asset_id
       FROM asset_snapshot s
       JOIN asset a ON s.asset_id = a.id
      WHERE s.date = ? AND a.archived = 0`,
    [date]
  );
  const haveExact = new Set<number>(exactRows.map(r => r.asset_id));

  const assets = await listAssets();
  let filledNetWorth = 0;
  for (const asset of assets) {
    if (haveExact.has(asset.id)) continue;
    const prev = await getLastSnapshotBefore(asset.id, date);
    if (prev) filledNetWorth += prev.netWorth;
  }

  return {
    netWorth: base.netWorth + filledNetWorth,
    inflow: base.inflow,
    profit: base.profit,
  };
}
