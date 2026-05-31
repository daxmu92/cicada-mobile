import Database from '@tauri-apps/plugin-sql';

import type { CicadaDB, SqlParam } from './migrations';

// Native SQLite for the Tauri desktop build via tauri-plugin-sql (sqlx). Used
// instead of expo-sqlite's WASM/OPFS engine because the desktop webviews
// (WebKitGTK on Linux, WKWebView on macOS) don't reliably expose OPFS.
//
// The DB file lives in the OS app-config dir (resolved by the plugin).
const DB_URL = 'sqlite:cicada.db';

// The repos use "?" placeholders (expo-sqlite style); tauri-plugin-sql's SQLite
// driver uses "$1, $2, …". None of our queries contain "?" inside string
// literals, so a positional rewrite is safe.
function toNumberedPlaceholders(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// execAsync receives multi-statement DDL scripts. tauri-plugin-sql's execute()
// runs a single statement, so split on ";". Our schema/reset scripts only use
// ";" as a statement separator (never inside a literal).
function splitStatements(sql: string): string[] {
  return sql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function openTauriDatabase(): Promise<CicadaDB> {
  const db = await Database.load(DB_URL);

  return {
    async getAllAsync<T>(sql: string, params: SqlParam[] = []): Promise<T[]> {
      return (await db.select(toNumberedPlaceholders(sql), params)) as T[];
    },

    async getFirstAsync<T>(
      sql: string,
      params: SqlParam[] = []
    ): Promise<T | null> {
      const rows = (await db.select(
        toNumberedPlaceholders(sql),
        params
      )) as T[];
      return rows.length > 0 ? rows[0] : null;
    },

    async runAsync(sql: string, params: SqlParam[] = []) {
      const res = await db.execute(toNumberedPlaceholders(sql), params);
      return {
        lastInsertRowId: res.lastInsertId ?? 0,
        changes: res.rowsAffected ?? 0,
      };
    },

    async execAsync(sql: string): Promise<void> {
      for (const statement of splitStatements(sql)) {
        await db.execute(statement);
      }
    },

    async withTransactionAsync(task: () => Promise<void>): Promise<void> {
      // tauri-plugin-sql runs each statement on a pooled connection, so a
      // JS-issued BEGIN/COMMIT can't reliably wrap later calls (they may land
      // on a different connection). Run the task directly — statements
      // autocommit individually. Fine for this single-user, sequential app;
      // the only trade-off is loss of all-or-nothing atomicity.
      await task();
    },
  };
}
