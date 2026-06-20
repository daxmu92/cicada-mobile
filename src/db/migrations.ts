// Shared schema + migrations, written against a minimal DB interface so the
// same logic runs on every backend: expo-sqlite (native + web) and the
// tauri-plugin-sql adapter (desktop). See database.ts / database.web.ts.

import { encodeHlc } from '../sync/hlc';

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

export const SCHEMA_VERSION = 2;

export async function migrate(db: CicadaDB): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS account (
      id          INTEGER PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      archived    INTEGER NOT NULL DEFAULT 0,
      uuid        TEXT,
      updated_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS asset (
      id          INTEGER PRIMARY KEY,
      account_id  INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      categories  TEXT NOT NULL DEFAULT '{}',
      archived    INTEGER NOT NULL DEFAULT 0,
      uuid        TEXT,
      updated_at  TEXT,
      UNIQUE(account_id, name)
    );

    CREATE TABLE IF NOT EXISTS asset_snapshot (
      asset_id    INTEGER NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
      date        TEXT NOT NULL,
      net_worth   REAL NOT NULL DEFAULT 0,
      inflow      REAL NOT NULL DEFAULT 0,
      profit      REAL NOT NULL DEFAULT 0,
      updated_at  TEXT,
      PRIMARY KEY (asset_id, date)
    );

    CREATE TABLE IF NOT EXISTS tran (
      id      INTEGER PRIMARY KEY,
      date    TEXT NOT NULL,
      type    TEXT NOT NULL CHECK(type IN ('INCOME', 'OUTLAY')),
      value   REAL NOT NULL,
      cat     TEXT NOT NULL DEFAULT '',
      note    TEXT NOT NULL DEFAULT '',
      uuid        TEXT,
      updated_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS setting (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL,
      updated_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS tombstone (
      entity      TEXT NOT NULL,
      uuid        TEXT NOT NULL,
      deleted_at  TEXT NOT NULL,
      PRIMARY KEY (entity, uuid)
    );

    CREATE TABLE IF NOT EXISTS sync_state (
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
    await db.execAsync(`PRAGMA user_version = 1`);
  }

  if (currentVersion < 2) {
    // v2 (cloud sync, Phase 1): additive sync columns + tombstone/sync_state.
    // Re-entrant — Tauri has no atomic transaction, so every step is safe to
    // re-run, and `PRAGMA user_version = 2` is written strictly last.
    await addColumnIfMissing(db, 'account', 'uuid', 'TEXT');
    await addColumnIfMissing(db, 'account', 'updated_at', 'TEXT');
    await addColumnIfMissing(db, 'asset', 'uuid', 'TEXT');
    await addColumnIfMissing(db, 'asset', 'updated_at', 'TEXT');
    await addColumnIfMissing(db, 'asset_snapshot', 'updated_at', 'TEXT');
    await addColumnIfMissing(db, 'tran', 'uuid', 'TEXT');
    await addColumnIfMissing(db, 'tran', 'updated_at', 'TEXT');
    await addColumnIfMissing(db, 'setting', 'updated_at', 'TEXT');

    // Stable device id; also used for the one-time migration HLC stamp.
    const deviceId = await ensureDeviceId(db);
    const migrationPhys = Date.now();
    const migrationStamp = encodeHlc(migrationPhys, 0, deviceId);

    // Backfill uuids — re-entrant (only NULLs). randomblob/hex/lower are core
    // SQLite, identical on all three backends.
    await db.execAsync(`UPDATE account SET uuid = lower(hex(randomblob(16))) WHERE uuid IS NULL`);
    await db.execAsync(`UPDATE asset   SET uuid = lower(hex(randomblob(16))) WHERE uuid IS NULL`);
    await db.execAsync(`UPDATE tran    SET uuid = lower(hex(randomblob(16))) WHERE uuid IS NULL`);

    // Backfill updated_at with the single migration stamp (all pre-existing
    // rows on this device share it — see spec §4 "first-merge caveat").
    await db.runAsync(`UPDATE account        SET updated_at = ? WHERE updated_at IS NULL`, [migrationStamp]);
    await db.runAsync(`UPDATE asset          SET updated_at = ? WHERE updated_at IS NULL`, [migrationStamp]);
    await db.runAsync(`UPDATE asset_snapshot SET updated_at = ? WHERE updated_at IS NULL`, [migrationStamp]);
    await db.runAsync(`UPDATE tran           SET updated_at = ? WHERE updated_at IS NULL`, [migrationStamp]);
    await db.runAsync(`UPDATE setting        SET updated_at = ? WHERE updated_at IS NULL`, [migrationStamp]);

    // Seed HLC state so later local ticks sort AFTER the migration stamp.
    // DO NOTHING keeps an already-advanced clock if the migration re-runs.
    await db.runAsync(
      `INSERT INTO sync_state (key, value) VALUES ('hlc', ?)
         ON CONFLICT(key) DO NOTHING`,
      [JSON.stringify({ phys: migrationPhys, counter: 0 })]
    );

    // Unique index on uuid AFTER backfill (idempotent on re-run).
    await db.execAsync(`CREATE UNIQUE INDEX IF NOT EXISTS idx_account_uuid ON account(uuid)`);
    await db.execAsync(`CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_uuid   ON asset(uuid)`);
    await db.execAsync(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tran_uuid    ON tran(uuid)`);

    await db.execAsync(`PRAGMA user_version = 2`);
  }
}

export async function resetSchema(db: CicadaDB): Promise<void> {
  await db.execAsync(`
    DROP TABLE IF EXISTS tran;
    DROP TABLE IF EXISTS asset_snapshot;
    DROP TABLE IF EXISTS asset;
    DROP TABLE IF EXISTS account;
    DROP TABLE IF EXISTS setting;
    DROP TABLE IF EXISTS tombstone;
    DROP TABLE IF EXISTS sync_state;
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

async function addColumnIfMissing(
  db: CicadaDB,
  table: string,
  column: string,
  type: string
): Promise<void> {
  if (!(await columnExists(db, table, column))) {
    await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

/** Read the persisted device id, generating + persisting one if absent. */
async function ensureDeviceId(db: CicadaDB): Promise<string> {
  const existing = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM sync_state WHERE key = 'deviceId'`
  );
  if (existing?.value) return existing.value;
  // 3 random bytes -> 6 lowercase hex chars (matches HLC_DEVICE_DIGITS).
  const generated = await db.getFirstAsync<{ id: string }>(
    `SELECT lower(hex(randomblob(3))) AS id`
  );
  await db.runAsync(
    `INSERT INTO sync_state (key, value) VALUES ('deviceId', ?)
       ON CONFLICT(key) DO NOTHING`,
    [generated!.id]
  );
  const persisted = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM sync_state WHERE key = 'deviceId'`
  );
  return persisted!.value;
}
