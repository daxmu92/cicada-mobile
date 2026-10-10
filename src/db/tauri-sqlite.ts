import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
import { serializeDatabase } from './serialized-db';

import type { CicadaDB, SqlParam } from './migrations';

// Native SQLite for the Tauri desktop build via tauri-plugin-sql (sqlx). Used
// instead of expo-sqlite's WASM/OPFS engine because the desktop webviews
// (WebKitGTK on Linux, WKWebView on macOS) don't reliably expose OPFS.
//
// The DB file lives in the OS app-config dir (resolved by the plugin).


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

export async function openTauriDatabase(name = 'cicada.db'): Promise<CicadaDB> {
  const DB_URL = `sqlite:${name}`;
  const db = await Database.load(DB_URL);

  return serializeDatabase({
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

    async withTransactionAsync(task: (tx: CicadaDB) => Promise<void>): Promise<void> {
      const transactionId = await invoke<string>('cicada_begin_transaction', { databaseUrl: DB_URL });
      const query = <T>(sql: string, params: SqlParam[] = [], select = true) => invoke<T>(
        'cicada_transaction_query', { transactionId, sql: toNumberedPlaceholders(sql), params, select }
      );
      const tx: CicadaDB = {
        getAllAsync: (sql, params) => query(sql, params),
        getFirstAsync: async (sql, params) => (await query<any[]>(sql, params))[0] ?? null,
        runAsync: (sql, params) => query(sql, params, false),
        execAsync: async (sql) => { for (const statement of splitStatements(sql)) await query(statement, [], false); },
        withTransactionAsync: (nested) => nested(tx),
      };
      try {
        await task(tx);
        await invoke('cicada_end_transaction', { transactionId, commit: true });
      } catch (error) {
        await invoke('cicada_end_transaction', { transactionId, commit: false }).catch(() => {});
        throw error;
      }
    },
  });
}
