import { getDatabase } from './database';
import type { Asset, AssetWithAccount } from '../utils/types';

type AssetRow = {
  id: number;
  account_id: number;
  name: string;
  categories: string;
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
  };
}

export async function listAssets(): Promise<AssetWithAccount[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<AssetWithAccountRow>(`
    SELECT a.id, a.account_id, a.name, a.categories, acc.name AS account_name
    FROM asset a
    JOIN account acc ON a.account_id = acc.id
    ORDER BY acc.name, a.name
  `);
  return rows.map(r => ({ ...rowToAsset(r), accountName: r.account_name }));
}

export async function listAssetsByAccount(accountId: number): Promise<Asset[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<AssetRow>(
    'SELECT id, account_id, name, categories FROM asset WHERE account_id = ? ORDER BY name',
    [accountId]
  );
  return rows.map(rowToAsset);
}

export async function getAsset(id: number): Promise<Asset | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<AssetRow>(
    'SELECT id, account_id, name, categories FROM asset WHERE id = ?',
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
