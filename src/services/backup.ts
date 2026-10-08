import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';

import { getDatabase } from '../db/database';
import { tick } from '../sync/clock';
import { buildBackupDoc, parseBackup, replaceBackupDoc, latestRecoveryBackup, type ImportCounts } from './backup-core';
import { notifyDataChanged } from '../db/changes';
import { syncScheduler } from '../sync/scheduler';

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
  const db = await getDatabase();
  const backup = await buildBackupDoc(db, new Date().toISOString());
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
  return syncScheduler.runExclusive(async (sync) => {
    await sync().catch(() => {}); // Offline replacement remains local until retry.
    const db = await getDatabase();
    const deletedAt = await tick();
    const freshStamp = await tick();
    const counts = await replaceBackupDoc(db, parsed, { deletedAt, freshStamp });
    notifyDataChanged();
    syncScheduler.markDirty();
    await sync().catch(() => {});
    return counts;
  });
}

export async function exportRecoveryBackup(): Promise<void> {
  const content = await latestRecoveryBackup(await getDatabase());
  if (!content) throw new Error('NO_RECOVERY_BACKUP');
  const filename = `cicada-recovery-${new Date().toISOString().slice(0, 10)}.json`;
  if (Platform.OS === 'web') { downloadJsonWeb(filename, content); return; }
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create(); file.write(content);
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json' });
}
