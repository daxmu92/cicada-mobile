import type { CicadaDB } from '../db/migrations';
import { SCHEMA_VERSION } from '../db/migrations';
import {
  buildDocument,
  serializeDocument,
  parseDocument,
  type SyncDocument,
} from './document';
import { merge } from './merge';
import { applyMerge } from './apply';
import { compareHlc, parseHlc } from './hlc';
import { ConflictError, type SyncRemote, type WritePrecondition } from './providers/types';

export const LAST_SYNCED_KEY = 'cloud_last_synced_at';
export const SYNC_IN_PROGRESS_KEY = 'sync_in_progress';

export const TOMBSTONE_RETENTION_DAYS = 90;
const DAY_MS = 86_400_000;

/** Prune tombstones whose deletion is older than the retention window. Age is
 *  read from the HLC physical component (ms-epoch). Returns rows pruned. */
export async function gcTombstones(
  db: CicadaDB,
  nowMs: number,
  retentionDays: number = TOMBSTONE_RETENTION_DAYS
): Promise<number> {
  const cutoff = nowMs - retentionDays * DAY_MS;
  const rows = await db.getAllAsync<{ entity: string; uuid: string; deleted_at: string }>(
    'SELECT entity, uuid, deleted_at FROM tombstone'
  );
  let pruned = 0;
  for (const r of rows) {
    if (parseHlc(r.deleted_at).phys < cutoff) {
      await db.runAsync('DELETE FROM tombstone WHERE entity = ? AND uuid = ?', [r.entity, r.uuid]);
      pruned++;
    }
  }
  return pruned;
}

export class UnsupportedRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedRemoteError';
  }
}

export type RunSyncDeps = {
  db: CicadaDB;
  remote: SyncRemote;
  deviceId: string;
  now: () => number;
  getState: (key: string) => Promise<string | null>;
  setState: (key: string, value: string) => Promise<void>;
  receiveRemote: (remoteHlc: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
};

export type SyncOutcome = {
  status: 'seeded' | 'merged';
  suffixed: string[];
};

/** Greatest HLC stamp anywhere in a remote document (updated_at + deleted_at), or null. */
export function maxRemoteStamp(doc: SyncDocument): string | null {
  let max: string | null = null;
  const consider = (s: string) => {
    if (max === null || compareHlc(s, max) > 0) max = s;
  };
  for (const r of doc.tables.account) consider(r.updated_at);
  for (const r of doc.tables.asset) consider(r.updated_at);
  for (const r of doc.tables.snapshot) consider(r.updated_at);
  for (const r of doc.tables.tran) consider(r.updated_at);
  for (const r of doc.tables.setting) consider(r.updated_at);
  for (const t of doc.tombstones) consider(t.deleted_at);
  return max;
}

function backoffMs(attempt: number): number {
  return 200 * 2 ** (attempt - 1) + Math.floor(Math.random() * 100);
}

function assertCompatible(doc: SyncDocument): void {
  if (doc.enc !== 'none') {
    throw new UnsupportedRemoteError(`remote document is encrypted (enc="${doc.enc}") — please update the app`);
  }
  if (doc.schemaVersion > SCHEMA_VERSION) {
    throw new UnsupportedRemoteError(
      `remote schemaVersion ${doc.schemaVersion} is newer than this app (${SCHEMA_VERSION}) — please update the app`
    );
  }
}

export async function runSync(deps: RunSyncDeps): Promise<SyncOutcome> {
  const { db, remote, deviceId, now, setState, receiveRemote } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxRetries = deps.maxRetries ?? 5;

  const buildLocal = () =>
    buildDocument(db, { generatedBy: deviceId, generatedAt: new Date(now()).toISOString() });

  let pulled = await remote.read();

  // Seed an empty remote. ifNoneMatch is the only path that MKCOLs the folder.
  if (pulled === null) {
    try {
      await remote.write(serializeDocument(await buildLocal()), { kind: 'ifNoneMatch' });
      const t = now();
      await setState(LAST_SYNCED_KEY, String(t));
      await gcTombstones(db, t);
      return { status: 'seeded', suffixed: [] };
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
      // Another device seeded between our read and write — fall through to merge.
      pulled = await remote.read();
      if (pulled === null) throw new Error('remote vanished after create conflict');
    }
  }

  for (let attempt = 0; ; ) {
    const remoteDoc = parseDocument(pulled.content);
    assertCompatible(remoteDoc);

    await setState(SYNC_IN_PROGRESS_KEY, '1');
    const merged = merge(await buildLocal(), remoteDoc);
    const applied = await applyMerge(db, merged);

    const max = maxRemoteStamp(remoteDoc);
    if (max) await receiveRemote(max);

    // Rebuild AFTER apply so we push the canonical merged local state.
    const outDoc = serializeDocument(await buildLocal());
    const pre: WritePrecondition = pulled.etag
      ? { kind: 'ifMatch', etag: pulled.etag }
      : { kind: 'none' };

    try {
      await remote.write(outDoc, pre);
      const t = now();
      await setState(LAST_SYNCED_KEY, String(t));
      await setState(SYNC_IN_PROGRESS_KEY, '0');
      await gcTombstones(db, t);
      return { status: 'merged', suffixed: applied.suffixed };
    } catch (e) {
      if (e instanceof ConflictError && attempt < maxRetries) {
        attempt++;
        await sleep(backoffMs(attempt));
        const re = await remote.read();
        if (re === null) throw new Error('remote vanished during retry');
        pulled = re;
        continue;
      }
      throw e;
    }
  }
}

/** Run a full sync against the configured remote. Returns null if sync is
 *  unavailable on this platform or no credentials are stored. */
export async function syncNow(): Promise<SyncOutcome | null> {
  // Dynamic imports keep platform-specific modules (react-native, expo-secure-store,
  // expo-sqlite) out of the module graph at test time.
  const [{ isSyncAvailable }, { loadRemote }, { getDatabase }, { getDeviceId }, { getSyncState, setSyncState }, { receiveRemote: recv }] =
    await Promise.all([
      import('./available'),
      import('./remote'),
      import('../db/database'),
      import('./device'),
      import('./sync-state-repo'),
      import('./clock'),
    ]);
  if (!isSyncAvailable()) return null;
  const remote = await loadRemote();
  if (!remote) return null;
  const db = await getDatabase();
  const deviceId = await getDeviceId();
  return runSync({
    db,
    remote,
    deviceId,
    now: () => Date.now(),
    getState: getSyncState,
    setState: setSyncState,
    receiveRemote: recv,
  });
}

/** Discard the remote document and replace it with this device's state.
 *  The corrupt-remote / first-connect "Replace" escape hatch (spec §8). */
export async function overwriteCloud(): Promise<void> {
  const [{ isSyncAvailable }, { loadRemote }, { getDatabase }, { getDeviceId }, { setSyncState }] =
    await Promise.all([
      import('./available'),
      import('./remote'),
      import('../db/database'),
      import('./device'),
      import('./sync-state-repo'),
    ]);
  if (!isSyncAvailable()) return;
  const remote = await loadRemote();
  if (!remote) return;
  const db = await getDatabase();
  const deviceId = await getDeviceId();
  const doc = serializeDocument(
    await buildDocument(db, { generatedBy: deviceId, generatedAt: new Date().toISOString() })
  );
  const existing = await remote.read();
  // ifNoneMatch only on a truly-absent file (it MKCOLs the folder); else overwrite.
  await remote.write(doc, existing === null ? { kind: 'ifNoneMatch' } : { kind: 'none' });
  await setSyncState(LAST_SYNCED_KEY, String(Date.now()));
}
