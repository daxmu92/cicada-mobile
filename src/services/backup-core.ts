import { requireRecord, requireText, requireAmount, requireId, requireMonth, requireDate, requireStamp, requireCategories, requireArchived, uniqueKey, validateTombstones } from '../utils/validation';
import type { CicadaDB } from '../db/migrations';

export const BACKUP_VERSION = 3;

export type BackupAccount = { id: number; name: string; archived?: number; uuid?: string; updated_at?: string };
export type BackupAsset = { id: number; accountId: number; name: string; categories: string; archived?: number; uuid?: string; updated_at?: string };
export type BackupSnapshot = { assetId: number; date: string; netWorth: number; inflow: number; profit: number; updated_at?: string };
export type BackupTran = { id: number; date: string; type: string; value: number; cat: string; note: string; uuid?: string; updated_at?: string };
export type BackupSettingV3 = { key: string; value: string; updated_at: string };
export type BackupTombstone = { entity: string; uuid: string; deleted_at: string };

export type BackupFile = {
  version: number;
  exportedAt: string;
  accounts: BackupAccount[];
  assets: BackupAsset[];
  snapshots: BackupSnapshot[];
  transactions: BackupTran[];
  // v3: array form; v1/v2: Record<string,string>
  settings: BackupSettingV3[] | Record<string, string>;
  tombstones?: BackupTombstone[];
};

/** Imported v3 rows may carry clocks ahead of this device's wall time. */
export function maxBackupStamp(doc:BackupFile):string|null {
  let max:string|null=null;
  const consider=(stamp?:string)=>{if(stamp&&(max===null||stamp>max))max=stamp;};
  for(const rows of [doc.accounts,doc.assets,doc.snapshots,doc.transactions])for(const row of rows)consider(row.updated_at);
  if(Array.isArray(doc.settings))for(const row of doc.settings)consider(row.updated_at);
  for(const row of doc.tombstones??[])consider(row.deleted_at);
  return max;
}

export type ImportCounts = { accounts: number; assets: number; snapshots: number; transactions: number };

export async function buildBackupDoc(db: CicadaDB, exportedAt: string): Promise<BackupFile> {
  let result!: BackupFile;
  await db.withTransactionAsync(async tx => { result = await readBackupDoc(tx, exportedAt); });
  return result;
}
async function readBackupDoc(db: CicadaDB, exportedAt: string): Promise<BackupFile> {
  const [accounts, assets, snapshots, transactions, settingsRaw, tombstones] = await Promise.all([
    db.getAllAsync<{ id: number; name: string; archived: number; uuid: string; updated_at: string }>(
      'SELECT id, name, archived, uuid, updated_at FROM account'
    ),
    db.getAllAsync<{ id: number; account_id: number; name: string; categories: string; archived: number; uuid: string; updated_at: string }>(
      'SELECT id, account_id, name, categories, archived, uuid, updated_at FROM asset'
    ),
    db.getAllAsync<{ asset_id: number; date: string; net_worth: number; inflow: number; profit: number; updated_at: string }>(
      'SELECT asset_id, date, net_worth, inflow, profit, updated_at FROM asset_snapshot'
    ),
    db.getAllAsync<BackupTran>(
      'SELECT id, date, type, value, cat, note, uuid, updated_at FROM tran'
    ),
    db.getAllAsync<{ key: string; value: string; updated_at: string }>(
      'SELECT key, value, updated_at FROM setting'
    ),
    db.getAllAsync<BackupTombstone>(
      'SELECT entity, uuid, deleted_at FROM tombstone'
    ),
  ]);

  return {
    version: BACKUP_VERSION,
    exportedAt,
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, archived: a.archived, uuid: a.uuid, updated_at: a.updated_at })),
    assets: assets.map((a) => ({ id: a.id, accountId: a.account_id, name: a.name, categories: a.categories, archived: a.archived, uuid: a.uuid, updated_at: a.updated_at })),
    snapshots: snapshots.map((s) => ({ assetId: s.asset_id, date: s.date, netWorth: s.net_worth, inflow: s.inflow, profit: s.profit, updated_at: s.updated_at })),
    transactions,
    settings: settingsRaw.map((s) => ({ key: s.key, value: s.value, updated_at: s.updated_at })),
    tombstones,
  };
}

export function validateBackup(value: unknown): asserts value is BackupFile {
  const o = requireRecord(value, 'backup');
  if (![1, 2, 3].includes(Number(o.version)) || typeof o.version !== 'number') throw new Error('Unsupported backup version');
  for (const name of ['accounts', 'assets', 'snapshots', 'transactions']) {
    if (!Array.isArray(o[name])) throw new Error(`backup.${name}: expected an array`);
  }
  const ids = new Set<string | number>(); const names = new Set<string | number>(); const uuids = new Set<string | number>();
  const accountIds = new Set<number>(); const assetIds = new Set<number>();
  const identity = (r: Record<string, unknown>, label: string) => {
    if (r.uuid !== undefined) { requireText(r.uuid, `${label}.uuid`); uniqueKey(uuids, `${label}|${r.uuid}`, label); }
    if (r.updated_at !== undefined) requireStamp(r.updated_at, `${label}.updated_at`);
    if (r.archived !== undefined) requireArchived(r.archived, `${label}.archived`);
  };
  for (const entry of o.accounts as unknown[]) {
    const r = requireRecord(entry, 'account'); requireId(r.id, 'account.id'); requireText(r.name, 'account.name');
    uniqueKey(ids, `account|${r.id}`, 'account.id'); uniqueKey(names, `account|${r.name}`, 'account.name'); identity(r, 'account'); accountIds.add(r.id);
  }
  for (const entry of o.assets as unknown[]) {
    const r = requireRecord(entry, 'asset'); requireId(r.id, 'asset.id'); requireId(r.accountId, 'asset.accountId'); requireText(r.name, 'asset.name');
    if (!accountIds.has(r.accountId)) throw new Error('asset: missing account');
    uniqueKey(ids, `asset|${r.id}`, 'asset.id'); uniqueKey(names, `asset|${r.accountId}|${r.name}`, 'asset.name');
    if (r.categories !== undefined) requireCategories(r.categories, 'asset.categories'); identity(r, 'asset'); assetIds.add(r.id);
  }
  for (const entry of o.snapshots as unknown[]) {
    const r = requireRecord(entry, 'snapshot'); requireId(r.assetId, 'snapshot.assetId'); requireMonth(r.date, 'snapshot.date');
    if (!assetIds.has(r.assetId)) throw new Error('snapshot: missing asset');
    uniqueKey(ids, `snapshot|${r.assetId}|${r.date}`, 'snapshot');
    for (const key of ['netWorth', 'inflow', 'profit']) requireAmount(r[key], `snapshot.${key}`);
    if (r.updated_at !== undefined) requireStamp(r.updated_at, 'snapshot.updated_at');
  }
  for (const entry of o.transactions as unknown[]) {
    const r = requireRecord(entry, 'transaction'); requireId(r.id, 'transaction.id'); requireDate(r.date, 'transaction.date'); requireAmount(r.value, 'transaction.value');
    if (!['INCOME', 'OUTLAY'].includes(String(r.type))) throw new Error('transaction: invalid type or amount');
    uniqueKey(ids, `tran|${r.id}`, 'transaction.id'); identity(r, 'tran');
    for (const key of ['cat', 'note']) if (r[key] !== undefined) requireText(r[key], `transaction.${key}`, true);
  }
  if (Array.isArray(o.settings)) {
    const keys = new Set<string | number>();
    for (const entry of o.settings) {
      const r = requireRecord(entry, 'setting'); requireText(r.key, 'setting.key'); requireText(r.value, 'setting.value', true); requireStamp(r.updated_at, 'setting.updated_at'); uniqueKey(keys, r.key, 'setting');
    }
  } else if (o.settings !== undefined) {
    const settings = requireRecord(o.settings, 'settings');
    for (const value of Object.values(settings)) requireText(value, 'setting.value', true);
  }
  if (o.tombstones !== undefined) validateTombstones(o.tombstones);
}

export function parseBackup(content: string): BackupFile {
  const parsed: unknown = JSON.parse(content);
  validateBackup(parsed);
  return parsed;
}

export async function restoreBackupDoc(
  db: CicadaDB,
  parsed: BackupFile,
  opts: { freshStamp: string; restamp?: boolean }
): Promise<ImportCounts> {
  validateBackup(parsed);
  const v = parsed.version;
  const stampOf = (backupStamp?: string) =>
    opts.restamp ? opts.freshStamp : (backupStamp ?? opts.freshStamp);

  await db.withTransactionAsync(async (db) => {
    for (const acc of parsed.accounts) {
      const archived = v < 2 ? 0 : acc.archived ?? 0;
      if (v >= 3 && acc.uuid) {
        await db.runAsync('INSERT INTO account (id, name, archived, uuid, updated_at) VALUES (?, ?, ?, ?, ?)',
          [acc.id, acc.name, archived, acc.uuid, stampOf(acc.updated_at)]);
      } else {
        await db.runAsync('INSERT INTO account (id, name, archived) VALUES (?, ?, ?)', [acc.id, acc.name, archived]);
      }
    }
    for (const a of parsed.assets) {
      const archived = v < 2 ? 0 : a.archived ?? 0;
      if (v >= 3 && a.uuid) {
        await db.runAsync('INSERT INTO asset (id, account_id, name, categories, archived, uuid, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [a.id, a.accountId, a.name, a.categories ?? '{}', archived, a.uuid, stampOf(a.updated_at)]);
      } else {
        await db.runAsync('INSERT INTO asset (id, account_id, name, categories, archived) VALUES (?, ?, ?, ?, ?)',
          [a.id, a.accountId, a.name, a.categories ?? '{}', archived]);
      }
    }
    for (const s of parsed.snapshots) {
      if ((v >= 3 && s.updated_at) || opts.restamp) {
        await db.runAsync('INSERT INTO asset_snapshot (asset_id, date, net_worth, inflow, profit, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
          [s.assetId, s.date, s.netWorth, s.inflow, s.profit, stampOf(s.updated_at)]);
      } else {
        await db.runAsync('INSERT INTO asset_snapshot (asset_id, date, net_worth, inflow, profit) VALUES (?, ?, ?, ?, ?)',
          [s.assetId, s.date, s.netWorth, s.inflow, s.profit]);
      }
    }
    for (const t of parsed.transactions) {
      if (v >= 3 && t.uuid) {
        await db.runAsync('INSERT INTO tran (id, date, type, value, cat, note, uuid, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [t.id, t.date, t.type, t.value, t.cat ?? '', t.note ?? '', t.uuid, stampOf(t.updated_at)]);
      } else {
        await db.runAsync('INSERT INTO tran (id, date, type, value, cat, note) VALUES (?, ?, ?, ?, ?, ?)',
          [t.id, t.date, t.type, t.value, t.cat ?? '', t.note ?? '']);
      }
    }

    // Settings: v3 = array with updated_at; v1/v2 = Record (no updated_at).
    if (Array.isArray(parsed.settings)) {
      for (const s of parsed.settings) {
        await db.runAsync(
          `INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
          [s.key, String(s.value), stampOf(s.updated_at)]
        );
      }
    } else if (parsed.settings) {
      for (const [key, value] of Object.entries(parsed.settings)) {
        await db.runAsync(
          `INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
          [key, String(value), opts.freshStamp]
        );
      }
    }

    // v3 tombstones travel verbatim.
    if (v >= 3 && parsed.tombstones) {
      for (const t of parsed.tombstones) {
        await db.runAsync(
          `INSERT INTO tombstone (entity, uuid, deleted_at) VALUES (?, ?, ?)
           ON CONFLICT(entity, uuid) DO UPDATE SET deleted_at = MAX(deleted_at, excluded.deleted_at)`,
          [t.entity, t.uuid, t.deleted_at]
        );
      }
    }

    // Legacy backfill: any NULL sync identity becomes fresh, sync-capable data.
    await db.runAsync(`UPDATE account SET uuid = lower(hex(randomblob(16))) WHERE uuid IS NULL`);
    await db.runAsync(`UPDATE asset   SET uuid = lower(hex(randomblob(16))) WHERE uuid IS NULL`);
    await db.runAsync(`UPDATE tran    SET uuid = lower(hex(randomblob(16))) WHERE uuid IS NULL`);
    await db.runAsync(`UPDATE account        SET updated_at = ? WHERE updated_at IS NULL`, [opts.freshStamp]);
    await db.runAsync(`UPDATE asset          SET updated_at = ? WHERE updated_at IS NULL`, [opts.freshStamp]);
    await db.runAsync(`UPDATE asset_snapshot SET updated_at = ? WHERE updated_at IS NULL`, [opts.freshStamp]);
    await db.runAsync(`UPDATE tran           SET updated_at = ? WHERE updated_at IS NULL`, [opts.freshStamp]);
    await db.runAsync(`UPDATE setting        SET updated_at = ? WHERE updated_at IS NULL`, [opts.freshStamp]);
  });

  return {
    accounts: parsed.accounts.length,
    assets: parsed.assets.length,
    snapshots: parsed.snapshots.length,
    transactions: parsed.transactions.length,
  };
}

/** Keep five local recovery copies; never include them in exported/synced data. */
export async function saveRecoveryBackup(db: CicadaDB, createdAt = new Date().toISOString()): Promise<void> {
  await db.withTransactionAsync(async (tx) => {
    const content = JSON.stringify(await buildBackupDoc(tx, createdAt));
    await tx.runAsync('INSERT INTO local_backup(created_at,content) VALUES(?,?)', [createdAt, content]);
    await tx.runAsync('DELETE FROM local_backup WHERE id NOT IN (SELECT id FROM local_backup ORDER BY id DESC LIMIT 5)');
  });
}
export async function latestRecoveryBackup(db: CicadaDB): Promise<string | null> {
  const row = await db.getFirstAsync<{ content: string }>('SELECT content FROM local_backup ORDER BY id DESC LIMIT 1');
  return row?.content ?? null;
}

export async function replaceBackupDoc(db: CicadaDB, parsed: BackupFile, opts: { deletedAt: string; freshStamp: string }): Promise<ImportCounts> {
  validateBackup(parsed); // Reject before even taking a recovery snapshot.
  await saveRecoveryBackup(db);
  const { eraseAllData } = await import('../sync/erase');
  let counts!: ImportCounts;
  await db.withTransactionAsync(async (tx) => {
    await eraseAllData(tx, { tick: async () => opts.deletedAt });
    counts = await restoreBackupDoc(tx, parsed, { freshStamp: opts.freshStamp, restamp: true });
  });
  return counts;
}
