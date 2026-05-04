import { getDatabase } from './database';
import type { Asset, AssetWithAccount } from '../utils/types';

type AssetRow = {
  id: number;
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
    'SELECT id, account_id, name, categories, archived FROM asset WHERE id = ?',
    [id]
  );
  return row ? rowToAsset(row) : null;
}

export async function createAsset(
  accountId: number,
  name: string,
  categories: Record<string, string> = {}
): Promise<number> {
  const db = await getDatabase();
  const result = await db.runAsync(
    'INSERT INTO asset (account_id, name, categories) VALUES (?, ?, ?)',
    [accountId, name, JSON.stringify(categories)]
  );
  return result.lastInsertRowId;
}

export async function updateAsset(
  id: number,
  name: string,
  categories: Record<string, string>
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE asset SET name = ?, categories = ? WHERE id = ?',
    [name, JSON.stringify(categories), id]
  );
}

export async function deleteAsset(id: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM asset WHERE id = ?', [id]);
}

export async function setAssetArchived(
  id: number,
  archived: boolean
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE asset SET archived = ? WHERE id = ?', [
    archived ? 1 : 0,
    id,
  ]);
}
