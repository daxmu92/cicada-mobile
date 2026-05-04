import { File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';

import { getDatabase, resetDatabase } from '../db/database';
import { getAllSettings } from '../db/setting-repo';

const BACKUP_VERSION = 2;

type BackupAccount = { id: number; name: string; archived?: number };
type BackupAsset = {
  id: number;
  accountId: number;
  name: string;
  categories: string;
  archived?: number;
};
type BackupSnapshot = {
  assetId: number;
  date: string;
  netWorth: number;
  inflow: number;
  profit: number;
};
type BackupTran = {
  id: number;
  date: string;
  type: string;
  value: number;
  cat: string;
  note: string;
};

type BackupFile = {
  version: number;
  exportedAt: string;
  accounts: BackupAccount[];
  assets: BackupAsset[];
  snapshots: BackupSnapshot[];
  transactions: BackupTran[];
  settings: Record<string, string>;
};

export async function exportBackup(): Promise<void> {
  const db = await getDatabase();

  const [accountsRaw, assetsRaw, snapshotsRaw, transactionsRaw, settings] = await Promise.all([
    db.getAllAsync<{ id: number; name: string; archived: number }>(
      'SELECT id, name, archived FROM account'
    ),
    db.getAllAsync<{
      id: number;
      account_id: number;
      name: string;
      categories: string;
      archived: number;
    }>('SELECT id, account_id, name, categories, archived FROM asset'),
    db.getAllAsync<{ asset_id: number; date: string; net_worth: number; inflow: number; profit: number }>(
      'SELECT asset_id, date, net_worth, inflow, profit FROM asset_snapshot'
    ),
    db.getAllAsync<BackupTran>('SELECT id, date, type, value, cat, note FROM tran'),
    getAllSettings(),
  ]);

  const backup: BackupFile = {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    accounts: accountsRaw.map((a) => ({
      id: a.id,
      name: a.name,
      archived: a.archived,
    })),
    assets: assetsRaw.map((a) => ({
      id: a.id,
      accountId: a.account_id,
      name: a.name,
      categories: a.categories,
      archived: a.archived,
    })),
    snapshots: snapshotsRaw.map((s) => ({
      assetId: s.asset_id,
      date: s.date,
      netWorth: s.net_worth,
      inflow: s.inflow,
      profit: s.profit,
    })),
    transactions: transactionsRaw,
    settings,
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = new File(Paths.cache, `cicada-backup-${timestamp}.json`);
  if (file.exists) file.delete();
  file.create();
  file.write(JSON.stringify(backup, null, 2));

  const available = await Sharing.isAvailableAsync();
  if (!available) {
    throw new Error('Sharing is not available on this device');
  }
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/json',
    dialogTitle: 'Save Cicada Backup',
    UTI: 'public.json',
  });
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

export async function importBackup(): Promise<{
  accounts: number;
  assets: number;
  snapshots: number;
  transactions: number;
}> {
  const pick = await DocumentPicker.getDocumentAsync({
    type: 'application/json',
    copyToCacheDirectory: true,
  });
  if (pick.canceled) {
    throw new Error('CANCELLED');
  }

  const asset = pick.assets[0];
  const file = new File(asset.uri);
  const content = await file.text();
  const parsed: unknown = JSON.parse(content);
  if (!validateBackup(parsed)) {
    throw new Error('Invalid backup file format');
  }
  if (parsed.version > BACKUP_VERSION) {
    throw new Error(`Unsupported backup version: ${parsed.version}`);
  }

  const backupVersion = parsed.version;

  await resetDatabase();
  const db = await getDatabase();

  await db.withTransactionAsync(async () => {
    for (const acc of parsed.accounts) {
      const archived = backupVersion < 2 ? 0 : acc.archived ?? 0;
      await db.runAsync(
        'INSERT INTO account (id, name, archived) VALUES (?, ?, ?)',
        [acc.id, acc.name, archived]
      );
    }
    for (const a of parsed.assets) {
      const archived = backupVersion < 2 ? 0 : a.archived ?? 0;
      await db.runAsync(
        'INSERT INTO asset (id, account_id, name, categories, archived) VALUES (?, ?, ?, ?, ?)',
        [a.id, a.accountId, a.name, a.categories ?? '{}', archived]
      );
    }
    for (const s of parsed.snapshots) {
      await db.runAsync(
        'INSERT INTO asset_snapshot (asset_id, date, net_worth, inflow, profit) VALUES (?, ?, ?, ?, ?)',
        [s.assetId, s.date, s.netWorth, s.inflow, s.profit]
      );
    }
    for (const t of parsed.transactions) {
      await db.runAsync(
        'INSERT INTO tran (id, date, type, value, cat, note) VALUES (?, ?, ?, ?, ?, ?)',
        [t.id, t.date, t.type, t.value, t.cat ?? '', t.note ?? '']
      );
    }
    if (parsed.settings) {
      for (const [key, value] of Object.entries(parsed.settings)) {
        await db.runAsync(
          `INSERT INTO setting (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          [key, String(value)]
        );
      }
    }
  });

  return {
    accounts: parsed.accounts.length,
    assets: parsed.assets.length,
    snapshots: parsed.snapshots.length,
    transactions: parsed.transactions.length,
  };
}
