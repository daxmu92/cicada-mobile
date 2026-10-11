import { getLedgerMode, type LedgerMode } from '../ledger/mode';
import * as SQLite from 'expo-sqlite';
import { serializeExpoDatabase } from './serialized-db';

import { migrate, resetSchema, type CicadaDB } from './migrations';

// Web target. Two backends:
//   - Tauri desktop  -> native SQLite via tauri-plugin-sql (no OPFS needed)
//   - Browser / PWA  -> expo-sqlite's WASM engine (OPFS; works in Chromium)
// Mobile uses database.ts instead.

const databases = new Map<string, Promise<CicadaDB>>();

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}



export function getDatabase(mode: LedgerMode = getLedgerMode()): Promise<CicadaDB> {
  const name = mode === 'demo' ? 'cicada-demo.db' : 'cicada.db';
  let dbPromise = databases.get(name);
  if (!dbPromise) {
    dbPromise = (async () => {
      let db: CicadaDB;
      if (isTauri()) {
        // Lazy-load so the plugin bundle only ships in the desktop chunk and is
        // never evaluated in a plain browser.
        const { openTauriDatabase } = await import('./tauri-sqlite');
        db = await openTauriDatabase(name);
      } else {
        db = serializeExpoDatabase(await SQLite.openDatabaseAsync(name));
      }
      db.ledgerMode=mode;
      await migrate(db);
      return db;
    })().catch((error) => { databases.delete(name); throw error; });
    databases.set(name, dbPromise);
  }
  return dbPromise;
}

export async function resetDatabase(): Promise<void> {
  const db = await getDatabase();
  await resetSchema(db);
}
