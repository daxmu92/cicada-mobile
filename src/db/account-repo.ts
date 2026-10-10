import {readCached} from './query-cache';
import { runLedgerWrite } from '../services/ledger-write';
import { tick } from '../sync/clock';
import { getDatabase } from './database';
import { stampWrite, recordTombstonesAt } from '../sync/stamp';
import { collectSnapshotTombstoneKeys } from './snapshot-repo';
import { bumpDirty } from '../sync/dirty';
import type { Account } from '../utils/types';

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
  return readCached(['accounts',options?.includeArchived??false],async()=>{
  const db = await getDatabase();
  const includeArchived = options?.includeArchived ?? false;
  const sql = includeArchived
    ? 'SELECT id, name, archived FROM account ORDER BY name'
    : 'SELECT id, name, archived FROM account WHERE archived = 0 ORDER BY name';
  const rows = await db.getAllAsync<AccountRow>(sql);
  return rows.map(rowToAccount);
  });
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
  return runLedgerWrite(async (db) => {
  const { uuid, updatedAt } = await stampWrite(db, { withUuid: true });
  const result = await db.runAsync(
    'INSERT INTO account (name, uuid, updated_at) VALUES (?, ?, ?)',
    [name, uuid, updatedAt]
  );
  bumpDirty(db);
  return result.lastInsertRowId;
  });
}

export async function renameAccount(id: number, name: string): Promise<void> {
  return runLedgerWrite(async (db) => {
  const { updatedAt } = await stampWrite(db, { withUuid: false });
  await db.runAsync('UPDATE account SET name = ?, updated_at = ? WHERE id = ?', [
    name,
    updatedAt,
    id,
  ]);
  bumpDirty(db);
  });
}

export async function deleteAccount(id: number): Promise<void> {
  return runLedgerWrite(async (db) => {
  const deletedAt = await tick(db);
  await db.withTransactionAsync(async (db) => {
    const account = await db.getFirstAsync<{ uuid: string }>(
      'SELECT uuid FROM account WHERE id = ?',
      [id]
    );
    if (!account) return;
    const assets = await db.getAllAsync<{ id: number; uuid: string }>(
      'SELECT id, uuid FROM asset WHERE account_id = ?',
      [id]
    );
    const snapshotKeys = await collectSnapshotTombstoneKeys(
      db,
      assets.map((a) => a.id)
    );
    // Record tombstones BEFORE the delete (the rows still exist to read).
    await recordTombstonesAt(db, 'account', [account.uuid], deletedAt);
    await recordTombstonesAt(db, 'asset', assets.map((a) => a.uuid), deletedAt);
    await recordTombstonesAt(db, 'snapshot', snapshotKeys, deletedAt);
    // FK ON DELETE CASCADE clears assets + snapshots locally.
    await db.runAsync('DELETE FROM account WHERE id = ?', [id]);
  });
  bumpDirty(db);
  });
}

export async function setAccountArchived(
  id: number,
  archived: boolean
): Promise<void> {
  return runLedgerWrite(async (db) => {
  const flag = archived ? 1 : 0;
  const { updatedAt } = await stampWrite(db, { withUuid: false });
  await db.withTransactionAsync(async (db) => {
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
  bumpDirty(db);
  });
}
