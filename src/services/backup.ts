import { Platform } from 'react-native';
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

type ImportCounts = {
  accounts: number;
  assets: number;
  snapshots: number;
  transactions: number;
};

// ---------------------------------------------------------------------------
// Shared (platform-independent) serialization / restore
// ---------------------------------------------------------------------------

async function buildBackup(): Promise<BackupFile> {
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

  return {
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

function parseBackup(content: string): BackupFile {
  const parsed: unknown = JSON.parse(content);
  if (!validateBackup(parsed)) {
    throw new Error('Invalid backup file format');
  }
  if (parsed.version > BACKUP_VERSION) {
    throw new Error(`Unsupported backup version: ${parsed.version}`);
  }
  return parsed;
}

async function restoreBackup(parsed: BackupFile): Promise<ImportCounts> {
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

// ---------------------------------------------------------------------------
// Web (browser / Tauri webview) file I/O
// ---------------------------------------------------------------------------

function downloadJsonWeb(filename: string, json: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Defer revocation so the download has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function pickJsonWeb(): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.display = 'none';
    let settled = false;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      input.remove();
      fn();
    };

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        finish(() => reject(new Error('CANCELLED')));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => finish(() => resolve(String(reader.result ?? '')));
      reader.onerror = () => finish(() => reject(new Error('Failed to read file')));
      reader.readAsText(file);
    });

    // Modern browsers fire 'cancel' when the picker is dismissed with no file.
    input.addEventListener('cancel', () => finish(() => reject(new Error('CANCELLED'))));

    document.body.appendChild(input);
    input.click();
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function exportBackup(): Promise<void> {
  const backup = await buildBackup();
  const json = JSON.stringify(backup, null, 2);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `cicada-backup-${timestamp}.json`;

  if (Platform.OS === 'web') {
    downloadJsonWeb(filename, json);
    return;
  }

  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  file.write(json);

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

export async function importBackup(): Promise<ImportCounts> {
  let content: string;

  if (Platform.OS === 'web') {
    content = await pickJsonWeb();
  } else {
    const pick = await DocumentPicker.getDocumentAsync({
      type: 'application/json',
      copyToCacheDirectory: true,
    });
    if (pick.canceled) {
      throw new Error('CANCELLED');
    }
    const asset = pick.assets[0];
    const file = new File(asset.uri);
    content = await file.text();
  }

  const parsed = parseBackup(content);
  return restoreBackup(parsed);
}
