import { getDatabase } from './database';
import type { Account } from '../utils/types';
import { stampWrite } from '../sync/stamp';

type AccountRow = {
  id: number;
  name: string;
  archived: number;
};

function rowToAccount(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    archived: row.archived !== 0,
  };
}

export async function listAccounts(
  options?: { includeArchived?: boolean }
): Promise<Account[]> {
  const db = await getDatabase();
  const includeArchived = options?.includeArchived ?? false;
  const sql = includeArchived
    ? 'SELECT id, name, archived FROM account ORDER BY name'
    : 'SELECT id, name, archived FROM account WHERE archived = 0 ORDER BY name';
  const rows = await db.getAllAsync<AccountRow>(sql);
  return rows.map(rowToAccount);
}

export async function getAccount(id: number): Promise<Account | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<AccountRow>(
    'SELECT id, name, archived FROM account WHERE id = ?',
    [id]
  );
  return row ? rowToAccount(row) : null;
}

export async function createAccount(name: string): Promise<number> {
  const db = await getDatabase();
  const { uuid, updatedAt } = await stampWrite(db, { withUuid: true });
  const result = await db.runAsync(
    'INSERT INTO account (name, uuid, updated_at) VALUES (?, ?, ?)',
    [name, uuid, updatedAt]
  );
  return result.lastInsertRowId;
}

export async function renameAccount(id: number, name: string): Promise<void> {
  const db = await getDatabase();
  const { updatedAt } = await stampWrite(db, { withUuid: false });
  await db.runAsync('UPDATE account SET name = ?, updated_at = ? WHERE id = ?', [
    name,
    updatedAt,
    id,
  ]);
}

export async function deleteAccount(id: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM account WHERE id = ?', [id]);
}

export async function setAccountArchived(
  id: number,
  archived: boolean
): Promise<void> {
  const db = await getDatabase();
  const flag = archived ? 1 : 0;
  const { updatedAt } = await stampWrite(db, { withUuid: false });
  await db.withTransactionAsync(async () => {
    await db.runAsync('UPDATE account SET archived = ?, updated_at = ? WHERE id = ?', [
      flag,
      updatedAt,
      id,
    ]);
    // Archiving an account cascades to all its assets; un-archiving does NOT
    // un-archive assets — user must explicitly un-archive each one.
    if (archived) {
      await db.runAsync(
        'UPDATE asset SET archived = 1, updated_at = ? WHERE account_id = ?',
        [updatedAt, id]
      );
    }
  });
}
