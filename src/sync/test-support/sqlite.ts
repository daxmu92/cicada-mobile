// TEST-ONLY. Imports better-sqlite3 (a native dev dependency) and must never be
// imported by app/runtime code — only by *.test.ts files. Gives the real
// migrate() and apply code a genuine in-memory SQLite to run against. All three
// production backends are SQLite, so this is a faithful behavioral proxy.

import Database from 'better-sqlite3';
import { migrate, type CicadaDB, type SqlParam } from '../../db/migrations';

export function makeMemoryDb(): { db: CicadaDB; raw: Database.Database } {
  const raw = new Database(':memory:');
  raw.pragma('foreign_keys = ON');

  const db: CicadaDB = {
    async getAllAsync<T = any>(sql: string, params: SqlParam[] = []): Promise<T[]> {
      return raw.prepare(sql).all(...params) as T[];
    },
    async getFirstAsync<T = any>(sql: string, params: SqlParam[] = []): Promise<T | null> {
      return (raw.prepare(sql).get(...params) ?? null) as T | null;
    },
    async runAsync(sql: string, params: SqlParam[] = []) {
      const r = raw.prepare(sql).run(...params);
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: r.changes };
    },
    async execAsync(sql: string): Promise<void> {
      raw.exec(sql);
    },
    async withTransactionAsync(task: () => Promise<void>): Promise<void> {
      // better-sqlite3's own transaction wrapper is sync-only; for tests we just
      // run the task (atomicity is not what these tests exercise).
      await task();
    },
  };
  return { db, raw };
}

export async function makeMigratedDb(): Promise<{ db: CicadaDB; raw: Database.Database }> {
  const h = makeMemoryDb();
  await migrate(h.db);
  return h;
}
