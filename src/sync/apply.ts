import type { CicadaDB } from '../db/migrations';
import type { MergeResult } from './merge';
import type {
  AccountRecord,
  AssetRecord,
  SnapshotRecord,
  TranRecord,
  SettingRecord,
} from './document';
import { adoptAccountUuid, adoptAssetUuid } from './reconcile';

export type ApplyResult = { suffixed: string[] };

/** A non-colliding name for `desired`, ignoring the row that owns `exceptUuid`. */
async function uniqueAccountName(db: CicadaDB, desired: string, exceptUuid: string): Promise<string> {
  let name = desired;
  let n = 2;
  while (true) {
    const clash = await db.getFirstAsync<{ uuid: string }>(
      'SELECT uuid FROM account WHERE name = ? AND uuid != ?',
      [name, exceptUuid]
    );
    if (!clash) return name;
    name = `${desired} (${n++})`;
  }
}

async function uniqueAssetName(
  db: CicadaDB,
  accountId: number,
  desired: string,
  exceptUuid: string
): Promise<string> {
  let name = desired;
  let n = 2;
  while (true) {
    const clash = await db.getFirstAsync<{ uuid: string }>(
      'SELECT uuid FROM asset WHERE account_id = ? AND name = ? AND uuid != ?',
      [accountId, name, exceptUuid]
    );
    if (!clash) return name;
    name = `${desired} (${n++})`;
  }
}

async function upsertAccount(db: CicadaDB, rec: AccountRecord, suffixed: string[]): Promise<number> {
  const existing = await db.getFirstAsync<{ id: number }>('SELECT id FROM account WHERE uuid = ?', [rec.uuid]);
  const name = await uniqueAccountName(db, rec.name, rec.uuid);
  if (name !== rec.name) suffixed.push(`account:${rec.name}`);
  if (existing) {
    await db.runAsync('UPDATE account SET name = ?, archived = ?, updated_at = ? WHERE uuid = ?', [
      name, rec.archived, rec.updated_at, rec.uuid,
    ]);
    return existing.id;
  }
  const r = await db.runAsync('INSERT INTO account (name, archived, uuid, updated_at) VALUES (?, ?, ?, ?)', [
    name, rec.archived, rec.uuid, rec.updated_at,
  ]);
  return r.lastInsertRowId;
}

async function upsertAsset(db: CicadaDB, rec: AssetRecord, accountId: number, suffixed: string[]): Promise<number> {
  const existing = await db.getFirstAsync<{ id: number }>('SELECT id FROM asset WHERE uuid = ?', [rec.uuid]);
  const name = await uniqueAssetName(db, accountId, rec.name, rec.uuid);
  if (name !== rec.name) suffixed.push(`asset:${rec.name}`);
  if (existing) {
    await db.runAsync(
      'UPDATE asset SET account_id = ?, name = ?, categories = ?, archived = ?, updated_at = ? WHERE uuid = ?',
      [accountId, name, rec.categories, rec.archived, rec.updated_at, rec.uuid]
    );
    return existing.id;
  }
  const r = await db.runAsync(
    'INSERT INTO asset (account_id, name, categories, archived, uuid, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [accountId, name, rec.categories, rec.archived, rec.uuid, rec.updated_at]
  );
  return r.lastInsertRowId;
}

async function upsertSnapshot(db: CicadaDB, rec: SnapshotRecord, assetId: number): Promise<void> {
  await db.runAsync(
    `INSERT INTO asset_snapshot (asset_id, date, net_worth, inflow, profit, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(asset_id, date) DO UPDATE SET
       net_worth = excluded.net_worth, inflow = excluded.inflow,
       profit = excluded.profit, updated_at = excluded.updated_at`,
    [assetId, rec.date, rec.netWorth, rec.inflow, rec.profit, rec.updated_at]
  );
}

async function upsertTran(db: CicadaDB, rec: TranRecord): Promise<void> {
  const existing = await db.getFirstAsync<{ id: number }>('SELECT id FROM tran WHERE uuid = ?', [rec.uuid]);
  if (existing) {
    await db.runAsync('UPDATE tran SET date = ?, type = ?, value = ?, cat = ?, note = ?, updated_at = ? WHERE uuid = ?', [
      rec.date, rec.type, rec.value, rec.cat, rec.note, rec.updated_at, rec.uuid,
    ]);
    return;
  }
  await db.runAsync('INSERT INTO tran (date, type, value, cat, note, uuid, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    rec.date, rec.type, rec.value, rec.cat, rec.note, rec.uuid, rec.updated_at,
  ]);
}

async function upsertSetting(db: CicadaDB, rec: SettingRecord): Promise<void> {
  await db.runAsync(
    `INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [rec.key, rec.value, rec.updated_at]
  );
}

export async function applyMerge(db: CicadaDB, merged: MergeResult): Promise<ApplyResult> {
  const suffixed: string[] = [];
  await db.withTransactionAsync(async () => {
    const accountId = new Map<string, number>();
    for (const rec of merged.tables.account) {
      await adoptAccountUuid(db, rec);
      accountId.set(rec.uuid, await upsertAccount(db, rec, suffixed));
    }

    const assetId = new Map<string, number>();
    for (const rec of merged.tables.asset) {
      const accId = accountId.get(rec.accountUuid);
      if (accId === undefined) continue; // orphan (parent absent) — cascade-repair handles it (Task 3)
      await adoptAssetUuid(db, rec, accId);
      assetId.set(rec.uuid, await upsertAsset(db, rec, accId, suffixed));
    }

    for (const rec of merged.tables.snapshot) {
      const asId = assetId.get(rec.assetUuid);
      if (asId === undefined) continue; // orphan snapshot — skip
      await upsertSnapshot(db, rec, asId);
    }

    for (const rec of merged.tables.tran) await upsertTran(db, rec);
    for (const rec of merged.tables.setting) await upsertSetting(db, rec);

    // Tombstone application + cascade-repair are added in Task 3.
  });
  return { suffixed };
}
