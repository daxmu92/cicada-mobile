import * as SQLite from 'expo-sqlite';

import { migrate, resetSchema, type CicadaDB } from './migrations';

// Web target. Two backends:
//   - Tauri desktop  -> native SQLite via tauri-plugin-sql (no OPFS needed)
//   - Browser / PWA  -> expo-sqlite's WASM engine (OPFS; works in Chromium)
// Mobile uses database.ts instead.

const DB_NAME = 'cicada.db';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

let dbPromise: Promise<CicadaDB> | null = null;

export function getDatabase(): Promise<CicadaDB> {
  if (!dbPromise) {
    dbPromise = (async () => {
      let db: CicadaDB;
      if (isTauri()) {
        // Lazy-load so the plugin bundle only ships in the desktop chunk and is
        // never evaluated in a plain browser.
        const { openTauriDatabase } = await import('./tauri-sqlite');
        db = await openTauriDatabase();
      } else {
        db = (await SQLite.openDatabaseAsync(DB_NAME)) as unknown as CicadaDB;
      }
      await migrate(db);
      return db;
    })();
  }
  return dbPromise;
}

export async function resetDatabase(): Promise<void> {
  const db = await getDatabase();
  await resetSchema(db);
}
