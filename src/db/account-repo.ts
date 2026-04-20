import { getDatabase } from './database';
import type { Account } from '../utils/types';

export async function listAccounts(): Promise<Account[]> {
  const db = await getDatabase();
  return db.getAllAsync<Account>('SELECT id, name FROM account ORDER BY name');
}

export async function getAccount(id: number): Promise<Account | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<Account>(
    'SELECT id, name FROM account WHERE id = ?',
    [id]
  );
  return row ?? null;
}

export async function createAccount(name: string): Promise<number> {
  const db = await getDatabase();
  const result = await db.runAsync('INSERT INTO account (name) VALUES (?)', [name]);
  return result.lastInsertRowId;
}

export async function renameAccount(id: number, name: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE account SET name = ? WHERE id = ?', [name, id]);
}

export async function deleteAccount(id: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM account WHERE id = ?', [id]);
}
