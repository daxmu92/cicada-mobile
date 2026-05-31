// Shared schema + migrations, written against a minimal DB interface so the
// same logic runs on every backend: expo-sqlite (native + web) and the
// tauri-plugin-sql adapter (desktop). See database.ts / database.web.ts.

export type SqlParam = string | number | null;

/** The subset of expo-sqlite's SQLiteDatabase the app actually uses. */
export interface CicadaDB {
  getAllAsync<T = any>(sql: string, params?: SqlParam[]): Promise<T[]>;
  getFirstAsync<T = any>(sql: string, params?: SqlParam[]): Promise<T | null>;
  runAsync(
    sql: string,
    params?: SqlParam[]
  ): Promise<{ lastInsertRowId: number; changes: number }>;
  /** Executes one or more `;`-separated statements (no bind params). */
  execAsync(sql: string): Promise<void>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

export const SCHEMA_VERSION = 1;

export async function migrate(db: CicadaDB): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS account (
      id        INTEGER PRIMARY KEY,
      name      TEXT NOT NULL UNIQUE,
      archived  INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS asset (
      id          INTEGER PRIMARY KEY,
      account_id  INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      categories  TEXT NOT NULL DEFAULT '{}',
      archived    INTEGER NOT NULL DEFAULT 0,
      UNIQUE(account_id, name)
    );

    CREATE TABLE IF NOT EXISTS asset_snapshot (
      asset_id    INTEGER NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
      date        TEXT NOT NULL,
      net_worth   REAL NOT NULL DEFAULT 0,
      inflow      REAL NOT NULL DEFAULT 0,
      profit      REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (asset_id, date)
    );

    CREATE TABLE IF NOT EXISTS tran (
      id      INTEGER PRIMARY KEY,
      date    TEXT NOT NULL,
      type    TEXT NOT NULL CHECK(type IN ('INCOME', 'OUTLAY')),
      value   REAL NOT NULL,
      cat     TEXT NOT NULL DEFAULT '',
      note    TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS setting (
      key     TEXT PRIMARY KEY,
      value   TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_snapshot_date ON asset_snapshot(date);
    CREATE INDEX IF NOT EXISTS idx_tran_date ON tran(date);
    CREATE INDEX IF NOT EXISTS idx_tran_type ON tran(type);
  `);

  const currentVersion = await getUserVersion(db);

  if (currentVersion < 1) {
    // Migration to v1: add `archived` column to account and asset.
    // For freshly-created DBs, `CREATE TABLE IF NOT EXISTS` above already
    // includes the column, so ALTER TABLE would fail with "duplicate column".
    // We detect that case by inspecting PRAGMA table_info and skip the ALTER
    // when the column is already present.
    const accountHasArchived = await columnExists(db, 'account', 'archived');
    if (!accountHasArchived) {
      await db.execAsync(
        'ALTER TABLE account ADD COLUMN archived INTEGER NOT NULL DEFAULT 0'
      );
    }
    const assetHasArchived = await columnExists(db, 'asset', 'archived');
    if (!assetHasArchived) {
      await db.execAsync(
        'ALTER TABLE asset ADD COLUMN archived INTEGER NOT NULL DEFAULT 0'
      );
    }
    await db.execAsync(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }
}

export async function resetSchema(db: CicadaDB): Promise<void> {
  await db.execAsync(`
    DROP TABLE IF EXISTS tran;
    DROP TABLE IF EXISTS asset_snapshot;
    DROP TABLE IF EXISTS asset;
    DROP TABLE IF EXISTS account;
    DROP TABLE IF EXISTS setting;
    PRAGMA user_version = 0;
  `);
  await migrate(db);
}

async function getUserVersion(db: CicadaDB): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>(
    'PRAGMA user_version'
  );
  return row?.user_version ?? 0;
}

async function columnExists(
  db: CicadaDB,
  table: string,
  column: string
): Promise<boolean> {
  const rows = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(${table})`
  );
  return rows.some((r) => r.name === column);
}
