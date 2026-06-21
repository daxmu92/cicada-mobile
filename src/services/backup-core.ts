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

export type ImportCounts = { accounts: number; assets: number; snapshots: number; transactions: number };

export async function buildBackupDoc(db: CicadaDB, exportedAt: string): Promise<BackupFile> {
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

function validateBackup(obj: unknown): obj is BackupFile {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  if (typeof o.version !== 'number') return false;
  if (!Array.isArray(o.accounts)) return false;
  if (!Array.isArray(o.assets)) return false;
  if (!Array.isArray(o.snapshots)) return false;
  if (!Array.isArray(o.transactions)) return false;
  return true;
}

export function parseBackup(content: string): BackupFile {
  const parsed: unknown = JSON.parse(content);
  if (!validateBackup(parsed)) throw new Error('Invalid backup file format');
  if (parsed.version > BACKUP_VERSION) throw new Error(`Unsupported backup version: ${parsed.version}`);
  return parsed;
}

export async function restoreBackupDoc(
  db: CicadaDB,
  parsed: BackupFile,
  opts: { freshStamp: string }
): Promise<ImportCounts> {
  const v = parsed.version;
  await db.withTransactionAsync(async () => {
    for (const acc of parsed.accounts) {
      const archived = v < 2 ? 0 : acc.archived ?? 0;
      if (v >= 3 && acc.uuid) {
        await db.runAsync('INSERT INTO account (id, name, archived, uuid, updated_at) VALUES (?, ?, ?, ?, ?)',
          [acc.id, acc.name, archived, acc.uuid, acc.updated_at ?? opts.freshStamp]);
      } else {
        await db.runAsync('INSERT INTO account (id, name, archived) VALUES (?, ?, ?)', [acc.id, acc.name, archived]);
      }
    }
    for (const a of parsed.assets) {
      const archived = v < 2 ? 0 : a.archived ?? 0;
      if (v >= 3 && a.uuid) {
        await db.runAsync('INSERT INTO asset (id, account_id, name, categories, archived, uuid, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [a.id, a.accountId, a.name, a.categories ?? '{}', archived, a.uuid, a.updated_at ?? opts.freshStamp]);
      } else {
        await db.runAsync('INSERT INTO asset (id, account_id, name, categories, archived) VALUES (?, ?, ?, ?, ?)',
          [a.id, a.accountId, a.name, a.categories ?? '{}', archived]);
      }
    }
    for (const s of parsed.snapshots) {
      if (v >= 3 && s.updated_at) {
        await db.runAsync('INSERT INTO asset_snapshot (asset_id, date, net_worth, inflow, profit, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
          [s.assetId, s.date, s.netWorth, s.inflow, s.profit, s.updated_at]);
      } else {
        await db.runAsync('INSERT INTO asset_snapshot (asset_id, date, net_worth, inflow, profit) VALUES (?, ?, ?, ?, ?)',
          [s.assetId, s.date, s.netWorth, s.inflow, s.profit]);
      }
    }
    for (const t of parsed.transactions) {
      if (v >= 3 && t.uuid) {
        await db.runAsync('INSERT INTO tran (id, date, type, value, cat, note, uuid, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [t.id, t.date, t.type, t.value, t.cat ?? '', t.note ?? '', t.uuid, t.updated_at ?? opts.freshStamp]);
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
          [s.key, String(s.value), s.updated_at ?? opts.freshStamp]
        );
      }
    } else if (parsed.settings) {
      for (const [key, value] of Object.entries(parsed.settings)) {
        await db.runAsync(
          `INSERT INTO setting (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          [key, String(value)]
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
