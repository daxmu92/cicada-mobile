import type { CicadaDB } from '../db/migrations';
import type { AccountRecord, AssetRecord } from './document';

// Natural-key uuid adoption. When a remote record's natural key matches a LOCAL
// row that has a DIFFERENT uuid (the onboarding case: both devices created the
// "same" account independently), adopt the remote uuid onto the local row so the
// subsequent upsert-by-uuid UPDATEs it instead of colliding on UNIQUE(name).
// Only adopt when no local row already holds the remote uuid (that would violate
// the uuid unique index). tran/snapshot/setting need no adoption — their natural
// key already IS the upsert key.

export async function adoptAccountUuid(db: CicadaDB, rec: AccountRecord): Promise<void> {
  const local = await db.getFirstAsync<{ id: number; uuid: string; updated_at: string }>(
    'SELECT id, uuid, updated_at FROM account WHERE name = ?',
    [rec.name]
  );
  if (!local || local.uuid === rec.uuid) return;
  const clash = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM account WHERE uuid = ?',
    [rec.uuid]
  );
  if (clash) return;
  await db.runAsync('UPDATE account SET uuid = ? WHERE id = ?', [rec.uuid, local.id]);
}

export async function adoptAssetUuid(
  db: CicadaDB,
  rec: AssetRecord,
  accountId: number
): Promise<void> {
  const local = await db.getFirstAsync<{ id: number; uuid: string; updated_at: string }>(
    'SELECT id, uuid, updated_at FROM asset WHERE account_id = ? AND name = ?',
    [accountId, rec.name]
  );
  if (!local || local.uuid === rec.uuid) return;
  const clash = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM asset WHERE uuid = ?',
    [rec.uuid]
  );
  if (clash) return;
  await db.runAsync('UPDATE asset SET uuid = ? WHERE id = ?', [rec.uuid, local.id]);
}
