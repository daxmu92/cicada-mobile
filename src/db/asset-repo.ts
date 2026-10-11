import {readCached} from './query-cache';
import { runLedgerWrite } from '../services/ledger-write';
import { tick } from '../sync/clock';
import { getDatabase } from './database';
import { stampWrite, recordTombstonesAt } from '../sync/stamp';
import { collectSnapshotTombstoneKeys } from './snapshot-repo';
import { bumpDirty } from '../sync/dirty';
import type { Asset, AssetWithAccount } from '../utils/types';

type AssetRow = {
  id: number;
  uuid?:string;
  account_id: number;
  name: string;
  categories: string;
  archived: number;
};

type AssetWithAccountRow = AssetRow & {
  account_name: string;
};

function parseCategories(raw: string): Record<string, string> {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function rowToAsset(row: AssetRow): Asset {
  return {
    id: row.id,
    uuid:row.uuid,
    accountId: row.account_id,
    name: row.name,
    categories: parseCategories(row.categories),
    archived: row.archived !== 0,
  };
}

export async function listAssets(
  options?: { includeArchived?: boolean }
): Promise<AssetWithAccount[]> {
  const db = await getDatabase();
  const includeArchived = options?.includeArchived ?? false;
  const whereClause = includeArchived ? '' : 'WHERE a.archived = 0';
  const rows = await db.getAllAsync<AssetWithAccountRow>(`
    SELECT a.id, a.account_id, a.name, a.categories, a.archived, acc.name AS account_name
    FROM asset a
    JOIN account acc ON a.account_id = acc.id
    ${whereClause}
    ORDER BY acc.name, a.name
  `);
  return rows.map((r) => ({ ...rowToAsset(r), accountName: r.account_name }));
}

export async function listAssetsByAccount(
  accountId: number,
  options?: { includeArchived?: boolean }
): Promise<Asset[]> {
  const db = await getDatabase();
  const includeArchived = options?.includeArchived ?? false;
  const sql = includeArchived
    ? 'SELECT id, account_id, name, categories, archived FROM asset WHERE account_id = ? ORDER BY name'
    : 'SELECT id, account_id, name, categories, archived FROM asset WHERE account_id = ? AND archived = 0 ORDER BY name';
  const rows = await db.getAllAsync<AssetRow>(sql, [accountId]);
  return rows.map(rowToAsset);
}

export async function getAsset(id: number): Promise<Asset | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<AssetRow>(
    'SELECT id, uuid, account_id, name, categories, archived FROM asset WHERE id = ?',
    [id]
  );
  return row ? rowToAsset(row) : null;
}

export async function createAsset(
  accountId: number,
  name: string,
  categories: Record<string, string> = {}
): Promise<number> {
  return runLedgerWrite(async (db) => {
  const { uuid, updatedAt } = await stampWrite(db, { withUuid: true });
  const result = await db.runAsync(
    'INSERT INTO asset (account_id, name, categories, uuid, updated_at) VALUES (?, ?, ?, ?, ?)',
    [accountId, name, JSON.stringify(categories), uuid, updatedAt]
  );
  bumpDirty(db);
  return result.lastInsertRowId;
  });
}

export async function updateAsset(
  id: number,
  name: string,
  categories: Record<string, string>
): Promise<void> {
  return runLedgerWrite(async (db) => {
  const { updatedAt } = await stampWrite(db, { withUuid: false });
  await db.runAsync(
    'UPDATE asset SET name = ?, categories = ?, updated_at = ? WHERE id = ?',
    [name, JSON.stringify(categories), updatedAt, id]
  );
  bumpDirty(db);
  });
}

export async function deleteAsset(id: number): Promise<void> {
  return runLedgerWrite(async (db) => {
  const deletedAt = await tick(db);
  await db.withTransactionAsync(async (db) => {
    const asset = await db.getFirstAsync<{ uuid: string }>(
      'SELECT uuid FROM asset WHERE id = ?',
      [id]
    );
    if (!asset) return;
    const snapshotKeys = await collectSnapshotTombstoneKeys(db, [id]);
    await recordTombstonesAt(db, 'asset', [asset.uuid], deletedAt);
    await recordTombstonesAt(db, 'snapshot', snapshotKeys, deletedAt);
    await db.runAsync('DELETE FROM asset WHERE id = ?', [id]);
  });
  bumpDirty(db);
  });
}

export async function setAssetArchived(
  id: number,
  archived: boolean
): Promise<void> {
  return runLedgerWrite(async (db) => {
  const { updatedAt } = await stampWrite(db, { withUuid: false });
  await db.runAsync('UPDATE asset SET archived = ?, updated_at = ? WHERE id = ?', [
    archived ? 1 : 0,
    updatedAt,
    id,
  ]);
  bumpDirty(db);
  });
}

/** Two queries for the entire active list, regardless of the number of assets. */
export async function listAssetOverview(date: string, forwardFill: boolean) {
  return readCached(['asset-overview',date,forwardFill],async()=>{
  const db = await getDatabase();
  let result!: (AssetWithAccount & { netWorth: number | null; sourceDate: string | null; lastRecorded: string | null; history: number[] })[];
  await db.withTransactionAsync(async (db) => {
  const [rows, history] = await Promise.all([
    db.getAllAsync<AssetWithAccountRow & { net_worth: number | null; source_date: string | null; last_recorded: string | null }>(`
      SELECT a.id,a.uuid,a.account_id,a.name,a.categories,a.archived,acc.name AS account_name,
             s.net_worth,s.date AS source_date,
             (SELECT MAX(date) FROM asset_snapshot WHERE asset_id=a.id AND date<=?) AS last_recorded
      FROM asset a JOIN account acc ON acc.id=a.account_id
      LEFT JOIN asset_snapshot s ON s.asset_id=a.id AND s.date=(
        SELECT MAX(p.date) FROM asset_snapshot p WHERE p.asset_id=a.id AND (p.date=? OR (?=1 AND p.date<?))
      ) WHERE a.archived=0 AND acc.archived=0 ORDER BY acc.name,a.name`, [date,date,forwardFill?1:0,date]),
    db.getAllAsync<{ asset_id: number; net_worth: number }>(`
      SELECT asset_id,net_worth FROM (
        SELECT s.asset_id,s.date,s.net_worth,ROW_NUMBER() OVER(PARTITION BY s.asset_id ORDER BY s.date DESC) AS n
        FROM asset_snapshot s JOIN asset a ON a.id=s.asset_id
        WHERE a.archived=0 AND s.date<=?
      ) WHERE n<=12 ORDER BY asset_id,date`, [date]),
  ]);
  const values = new Map<number,number[]>();
  for (const row of history) { const list=values.get(row.asset_id)??[];list.push(row.net_worth);values.set(row.asset_id,list); }
  result = rows.map(row=>({...rowToAsset(row),accountName:row.account_name,netWorth:row.net_worth,sourceDate:row.source_date,lastRecorded:row.last_recorded,history:values.get(row.id)??[]}));
  });
  return result;
  });
}
