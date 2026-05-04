import * as SQLite from 'expo-sqlite';

const DB_NAME = 'cicada.db';
const SCHEMA_VERSION = 1;

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await migrate(db);
      return db;
    })();
  }
  return dbPromise;
}

async function getUserVersion(db: SQLite.SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
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

async function columnExists(
  db: SQLite.SQLiteDatabase,
  table: string,
  column: string
): Promise<boolean> {
  const rows = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(${table})`
  );
  return rows.some((r) => r.name === column);
}

export async function resetDatabase(): Promise<void> {
  const db = await getDatabase();
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
