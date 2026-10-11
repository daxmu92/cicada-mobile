import { getLedgerMode, type LedgerMode } from '../ledger/mode';
import * as SQLite from 'expo-sqlite';
import { serializeExpoDatabase } from './serialized-db';

import { migrate, resetSchema, type CicadaDB } from './migrations';

// Native (iOS / Android) database. Web and desktop use database.web.ts.

const databases = new Map<string, Promise<CicadaDB>>();



export function getDatabase(mode: LedgerMode = getLedgerMode()): Promise<CicadaDB> {
  const name = mode === 'demo' ? 'cicada-demo.db' : 'cicada.db';
  let dbPromise = databases.get(name);
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = serializeExpoDatabase(await SQLite.openDatabaseAsync(name));
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
