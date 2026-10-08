import { requireRecord, requireText, requireAmount, requireMonth, requireDate, requireStamp, requireCategories, requireArchived, uniqueKey, validateTombstones } from '../utils/validation';
import type { CicadaDB } from '../db/migrations';
import { SCHEMA_VERSION } from '../db/migrations';

// The cicada-sync.json wire format. Foreign keys travel as the PARENT'S uuid
// (accountUuid / assetUuid) so two devices' independent integer-id spaces line up.

export type AccountRecord = {
  uuid: string;
  name: string;
  archived: number;
  updated_at: string;
};

export type AssetRecord = {
  uuid: string;
  accountUuid: string;
  name: string;
  categories: string; // JSON string, stored verbatim
  archived: number;
  updated_at: string;
};

export type SnapshotRecord = {
  assetUuid: string;
  date: string; // "YYYY-MM"
  netWorth: number;
  inflow: number;
  profit: number;
  updated_at: string;
};

export type TranRecord = {
  uuid: string;
  date: string;
  type: string;
  value: number;
  cat: string;
  note: string;
  updated_at: string;
};

export type SettingRecord = {
  key: string;
  value: string;
  updated_at: string;
};

export type TombstoneRecord = {
  entity: string;
  uuid: string; // for snapshots: "<assetUuid>|<date>"
  deleted_at: string;
};

export type SyncTables = {
  account: AccountRecord[];
  asset: AssetRecord[];
  snapshot: SnapshotRecord[];
  tran: TranRecord[];
  setting: SettingRecord[];
};

export type SyncDocument = {
  syncFormatVersion: 1;
  enc: 'none';
  schemaVersion: number;
  generatedAt: string;
  generatedBy: string;
  tables: SyncTables;
  tombstones: TombstoneRecord[];
};

const TABLE_NAMES: (keyof SyncTables)[] = ['account', 'asset', 'snapshot', 'tran', 'setting'];

/**
 * Read the whole local DB into a SyncDocument. SELECT-only (never writes).
 * FKs are resolved to parent uuids via joins. `archived` comes back as 0/1.
 */
export async function buildDocument(db: CicadaDB, meta: { generatedBy: string; generatedAt: string }): Promise<SyncDocument> {
  let result!: SyncDocument;
  await db.withTransactionAsync(async tx => { result = await readDocument(tx, meta); });
  return result;
}
async function readDocument(db: CicadaDB, meta: { generatedBy: string; generatedAt: string }): Promise<SyncDocument> {
  const account = await db.getAllAsync<AccountRecord>(
    'SELECT uuid, name, archived, updated_at FROM account'
  );
  const asset = await db.getAllAsync<AssetRecord>(
    `SELECT a.uuid AS uuid, acc.uuid AS accountUuid, a.name AS name,
            a.categories AS categories, a.archived AS archived, a.updated_at AS updated_at
       FROM asset a
       JOIN account acc ON a.account_id = acc.id`
  );
  const snapshot = await db.getAllAsync<SnapshotRecord>(
    `SELECT a.uuid AS assetUuid, s.date AS date, s.net_worth AS netWorth,
            s.inflow AS inflow, s.profit AS profit, s.updated_at AS updated_at
       FROM asset_snapshot s
       JOIN asset a ON s.asset_id = a.id`
  );
  const tran = await db.getAllAsync<TranRecord>(
    'SELECT uuid, date, type, value, cat, note, updated_at FROM tran'
  );
  const setting = await db.getAllAsync<SettingRecord>(
    'SELECT key, value, updated_at FROM setting'
  );
  const tombstones = await db.getAllAsync<TombstoneRecord>(
    'SELECT entity, uuid, deleted_at FROM tombstone'
  );

  return {
    syncFormatVersion: 1,
    enc: 'none',
    schemaVersion: SCHEMA_VERSION,
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    tables: { account, asset, snapshot, tran, setting },
    tombstones,
  };
}

export function serializeDocument(doc: SyncDocument): string {
  return JSON.stringify(doc);
}

/**
 * Structural validation only. Policy checks (enc !== 'none', schemaVersion ahead
 * of this app) are the orchestrator's job, not this function's.
 */
export function parseDocument(content: string): SyncDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('sync document is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('sync document is not an object');
  }
  const d = parsed as Record<string, unknown>;
  if (d.syncFormatVersion !== 1) {
    throw new Error(`unsupported syncFormatVersion: ${String(d.syncFormatVersion)}`);
  }
  if (!d.tables || typeof d.tables !== 'object') {
    throw new Error('sync document missing tables');
  }
  const tables = d.tables as Record<string, unknown>;
  for (const name of TABLE_NAMES) {
    if (!Array.isArray(tables[name])) {
      throw new Error(`sync document tables.${name} is not an array`);
    }
  }
  if (!Array.isArray(d.tombstones)) {
    throw new Error('sync document tombstones is not an array');
  }
  if (!Number.isSafeInteger(d.schemaVersion) || Number(d.schemaVersion) < 0) throw new Error('sync document: invalid schemaVersion');
  requireText(d.enc, 'sync document.enc');
  const accounts = new Set<string | number>(); const assets = new Set<string | number>(); const transactions = new Set<string | number>();
  const snapshots = new Set<string | number>(); const settings = new Set<string | number>();
  for (const entry of tables.account as unknown[]) {
    const r = requireRecord(entry, 'account'); requireText(r.uuid, 'account.uuid'); requireText(r.name, 'account.name'); requireArchived(r.archived, 'account.archived'); requireStamp(r.updated_at, 'account.updated_at'); uniqueKey(accounts, r.uuid, 'account.uuid');
  }
  for (const entry of tables.asset as unknown[]) {
    const r = requireRecord(entry, 'asset'); requireText(r.uuid, 'asset.uuid'); requireText(r.accountUuid, 'asset.accountUuid'); requireText(r.name, 'asset.name'); requireCategories(r.categories, 'asset.categories'); requireArchived(r.archived, 'asset.archived'); requireStamp(r.updated_at, 'asset.updated_at');
    if (!accounts.has(r.accountUuid)) throw new Error('asset: missing account');
    uniqueKey(assets, r.uuid, 'asset.uuid');
  }
  for (const entry of tables.snapshot as unknown[]) {
    const r = requireRecord(entry, 'snapshot'); requireText(r.assetUuid, 'snapshot.assetUuid'); requireMonth(r.date, 'snapshot.date'); requireStamp(r.updated_at, 'snapshot.updated_at');
    if (!assets.has(r.assetUuid)) throw new Error('snapshot: missing asset');
    for (const key of ['netWorth', 'inflow', 'profit']) requireAmount(r[key], `snapshot.${key}`);
    uniqueKey(snapshots, `${r.assetUuid}|${r.date}`, 'snapshot');
  }
  for (const entry of tables.tran as unknown[]) {
    const r = requireRecord(entry, 'transaction'); requireText(r.uuid, 'transaction.uuid'); requireDate(r.date, 'transaction.date'); requireAmount(r.value, 'transaction.value'); requireStamp(r.updated_at, 'transaction.updated_at');
    if (!['INCOME', 'OUTLAY'].includes(String(r.type))) throw new Error('transaction: invalid type or amount');
    requireText(r.cat, 'transaction.cat', true); requireText(r.note, 'transaction.note', true); uniqueKey(transactions, r.uuid, 'transaction.uuid');
  }
  for (const entry of tables.setting as unknown[]) {
    const r = requireRecord(entry, 'setting'); requireText(r.key, 'setting.key'); requireText(r.value, 'setting.value', true); requireStamp(r.updated_at, 'setting.updated_at'); uniqueKey(settings, r.key, 'setting.key');
  }
  validateTombstones(d.tombstones);
  return parsed as SyncDocument;
}
