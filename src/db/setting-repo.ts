import { getDatabase } from './database';
import { stampWrite } from '../sync/stamp';

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM setting WHERE key = ?',
    [key]
  );
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDatabase();
  const { updatedAt } = await stampWrite(db, { withUuid: false });
  await db.runAsync(
    `INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, updatedAt]
  );
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    'SELECT key, value FROM setting'
  );
  const result: Record<string, string> = {};
  for (const r of rows) result[r.key] = r.value;
  return result;
}
