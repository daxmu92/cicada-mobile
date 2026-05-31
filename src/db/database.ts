import * as SQLite from 'expo-sqlite';

import { migrate, resetSchema, type CicadaDB } from './migrations';

// Native (iOS / Android) database. Web and desktop use database.web.ts.

const DB_NAME = 'cicada.db';

let dbPromise: Promise<CicadaDB> | null = null;

export function getDatabase(): Promise<CicadaDB> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = (await SQLite.openDatabaseAsync(DB_NAME)) as unknown as CicadaDB;
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
