import * as SQLite from 'expo-sqlite';
import { serializeExpoDatabase } from './serialized-db';

import { migrate, resetSchema, type CicadaDB } from './migrations';

// Native (iOS / Android) database. Web and desktop use database.web.ts.

const DB_NAME = 'cicada.db';

let dbPromise: Promise<CicadaDB> | null = null;

export function getDatabase(): Promise<CicadaDB> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = serializeExpoDatabase(await SQLite.openDatabaseAsync(DB_NAME));
      await migrate(db);
      return db;
    })().catch((error) => { dbPromise = null; throw error; });
  }
  return dbPromise;
}

export async function resetDatabase(): Promise<void> {
  const db = await getDatabase();
  await resetSchema(db);
}
