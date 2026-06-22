import { test } from 'node:test';
import assert from 'node:assert';
import { makeMigratedDb } from './test-support/sqlite';
import { buildDocument, serializeDocument, parseDocument, type SyncDocument } from './document';
import { ConflictError } from './providers/types';
import type { SyncRemote, WritePrecondition } from './providers/types';
import { runSync, maxRemoteStamp, gcTombstones, TOMBSTONE_RETENTION_DAYS, SYNC_IN_PROGRESS_KEY, CLOUD_ETAG_KEY } from './sync';
import type { CicadaDB } from '../db/migrations';
import { eraseAllData } from './erase';
import { restoreBackupDoc } from '../services/backup-core';

// ---- in-memory fake remote -------------------------------------------------
function makeFakeRemote(opts: { honorIfMatch?: boolean; returnEtag?: boolean } = {}) {
  const honor = opts.honorIfMatch ?? true;
  const withEtag = opts.returnEtag ?? true;
  let content: string | null = null;
  let version = 0;
  const etag = () => (content === null ? null : withEtag ? `v${version}` : null);
  const remote: SyncRemote & { _content(): string | null; _seed(c: string): void } = {
    isConnected: () => true,
    testConnection: async () => {},
    read: async (opts?: { ifNoneMatch?: string }) => {
      if (content === null) return null;
      if (opts?.ifNoneMatch && opts.ifNoneMatch === etag()) return 'not-modified';
      return { content, etag: etag() };
    },
    write: async (c: string, pre: WritePrecondition) => {
      if (pre.kind === 'ifNoneMatch' && content !== null && honor) throw new ConflictError();
      if (pre.kind === 'ifMatch' && honor && pre.etag !== etag()) throw new ConflictError();
      content = c; version++;
      return { etag: etag() };
    },
    _content: () => content,
    _seed: (c: string) => { content = c; version++; },
  };
  return remote;
}

// state closures over a harness db's sync_state table
function stateOf(db: CicadaDB) {
  return {
    getState: async (k: string) =>
      (await db.getFirstAsync<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', [k]))?.value ?? null,
    setState: async (k: string, v: string) =>
      void (await db.runAsync(
        'INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [k, v]
      )),
  };
}

function depsFor(db: CicadaDB, remote: SyncRemote, deviceId: string, now = 1_000_000) {
  const received: string[] = [];
  return {
    deps: {
      db, remote, deviceId,
      now: () => now,
      ...stateOf(db),
      receiveRemote: async (h: string) => { received.push(h); },
      sleep: async () => {},
    },
    received,
  };
}

// insert a stamped account directly (uuid + updated_at HLC) — mirror the helper
// apply.test.ts already uses if present; otherwise inline this:
async function addAccount(db: CicadaDB, uuid: string, name: string, updatedAt: string) {
  await db.runAsync('INSERT INTO account (name, archived, uuid, updated_at) VALUES (?, 0, ?, ?)', [name, uuid, updatedAt]);
}

const HLC = (n: number, dev: string) => `${String(n).padStart(15, '0')}-00000-${dev.padStart(6, '0')}`;

test('seed: empty remote gets the local document via ifNoneMatch', async () => {
  const { db } = await makeMigratedDb();
  await addAccount(db, 'acc-a', 'Cash', HLC(10, 'aaaaaa'));
  const remote = makeFakeRemote();
  const { deps } = depsFor(db, remote, 'aaaaaa');
  const out = await runSync(deps);
  assert.equal(out.status, 'seeded');
  const pushed = parseDocument(remote._content()!);
  assert.equal(pushed.tables.account.length, 1);
  assert.equal(pushed.tables.account[0].name, 'Cash');
});

test('two devices converge through one remote', async () => {
  const { db: dbA } = await makeMigratedDb();
  const { db: dbB } = await makeMigratedDb();
  await addAccount(dbA, 'acc-a', 'Cash', HLC(10, 'aaaaaa'));
  await addAccount(dbB, 'acc-b', 'Brokerage', HLC(11, 'bbbbbb'));
  const remote = makeFakeRemote();
  await runSync(depsFor(dbA, remote, 'aaaaaa').deps); // A seeds {Cash}
  await runSync(depsFor(dbB, remote, 'bbbbbb').deps); // B merges -> {Cash, Brokerage}, pushes
  await runSync(depsFor(dbA, remote, 'aaaaaa').deps); // A pulls B's -> converges

  const docA = await buildDocument(dbA, { generatedBy: 'x', generatedAt: 'x' });
  const docB = await buildDocument(dbB, { generatedBy: 'x', generatedAt: 'x' });
  const names = (d: SyncDocument) => d.tables.account.map((a) => a.name).sort();
  assert.deepEqual(names(docA), ['Brokerage', 'Cash']);
  assert.deepEqual(names(docA), names(docB));
});

test('412 on push -> re-pull, re-merge, retry, converge', async () => {
  const { db } = await makeMigratedDb();
  await addAccount(db, 'acc-a', 'Cash', HLC(10, 'aaaaaa'));
  // remote already has a different account, with an etag
  const remote = makeFakeRemote();
  const seedDoc: SyncDocument = {
    syncFormatVersion: 1, enc: 'none', schemaVersion: 2, generatedAt: 'x', generatedBy: 'b',
    tables: { account: [{ uuid: 'acc-b', name: 'Brokerage', archived: 0, updated_at: HLC(11, 'bbbbbb') }], asset: [], snapshot: [], tran: [], setting: [] },
    tombstones: [],
  };
  remote._seed(serializeDocument(seedDoc));
  // make the FIRST ifMatch write 412 by injecting a concurrent change
  const realWrite = remote.write.bind(remote);
  let injected = false;
  remote.write = async (c, pre) => {
    if (pre.kind === 'ifMatch' && !injected) {
      injected = true;
      const concurrent: SyncDocument = { ...seedDoc,
        tables: { ...seedDoc.tables, account: [...seedDoc.tables.account, { uuid: 'acc-c', name: 'Crypto', archived: 0, updated_at: HLC(12, 'cccccc') }] } };
      remote._seed(serializeDocument(concurrent)); // remote moved on -> stale etag
      throw new ConflictError();
    }
    return realWrite(c, pre);
  };
  const out = await runSync(depsFor(db, remote, 'aaaaaa').deps);
  assert.equal(out.status, 'merged');
  const final = parseDocument(remote._content()!);
  assert.deepEqual(final.tables.account.map((a) => a.name).sort(), ['Brokerage', 'Cash', 'Crypto']);
});

test('no-ETag server falls back to unconditional write and still converges', async () => {
  const { db } = await makeMigratedDb();
  await addAccount(db, 'acc-a', 'Cash', HLC(10, 'aaaaaa'));
  const remote = makeFakeRemote({ returnEtag: false });
  const seedDoc: SyncDocument = {
    syncFormatVersion: 1, enc: 'none', schemaVersion: 2, generatedAt: 'x', generatedBy: 'b',
    tables: { account: [{ uuid: 'acc-b', name: 'Brokerage', archived: 0, updated_at: HLC(11, 'bbbbbb') }], asset: [], snapshot: [], tran: [], setting: [] },
    tombstones: [],
  };
  remote._seed(serializeDocument(seedDoc));
  const out = await runSync(depsFor(db, remote, 'aaaaaa').deps);
  assert.equal(out.status, 'merged');
  const final = parseDocument(remote._content()!);
  assert.deepEqual(final.tables.account.map((a) => a.name).sort(), ['Brokerage', 'Cash']);
});

test('rejects a remote with enc != none or a newer schemaVersion', async () => {
  const { db } = await makeMigratedDb();
  const remote = makeFakeRemote();
  remote._seed(JSON.stringify({ syncFormatVersion: 1, enc: 'aes-gcm', schemaVersion: 2, generatedAt: 'x', generatedBy: 'b', tables: { account: [], asset: [], snapshot: [], tran: [], setting: [] }, tombstones: [] }));
  await assert.rejects(() => runSync(depsFor(db, remote, 'aaaaaa').deps));
});

test('maxRemoteStamp returns the greatest HLC across tables and tombstones', () => {
  const doc: SyncDocument = {
    syncFormatVersion: 1, enc: 'none', schemaVersion: 2, generatedAt: 'x', generatedBy: 'b',
    tables: {
      account: [{ uuid: 'a', name: 'n', archived: 0, updated_at: HLC(5, 'aaaaaa') }],
      asset: [], snapshot: [], tran: [],
      setting: [{ key: 'k', value: 'v', updated_at: HLC(9, 'aaaaaa') }],
    },
    tombstones: [{ entity: 'tran', uuid: 't', deleted_at: HLC(7, 'aaaaaa') }],
  };
  assert.equal(maxRemoteStamp(doc), HLC(9, 'aaaaaa'));
});

const DAY_MS = 86_400_000;

test('gcTombstones prunes tombstones older than the retention window, keeps newer', async () => {
  const { db } = await makeMigratedDb();
  const nowMs = 1_000 * DAY_MS; // arbitrary "now" in ms
  const old = HLC(nowMs - 100 * DAY_MS, 'aaaaaa'); // 100d old -> pruned
  const fresh = HLC(nowMs - 10 * DAY_MS, 'aaaaaa'); // 10d old -> kept
  await db.runAsync('INSERT INTO tombstone (entity, uuid, deleted_at) VALUES (?, ?, ?)', ['tran', 't-old', old]);
  await db.runAsync('INSERT INTO tombstone (entity, uuid, deleted_at) VALUES (?, ?, ?)', ['tran', 't-new', fresh]);

  const pruned = await gcTombstones(db, nowMs, TOMBSTONE_RETENTION_DAYS);
  assert.equal(pruned, 1);
  const rows = await db.getAllAsync<{ uuid: string }>('SELECT uuid FROM tombstone ORDER BY uuid');
  assert.deepEqual(rows.map((r) => r.uuid), ['t-new']);
});

test('TOMBSTONE_RETENTION_DAYS is 90', () => {
  assert.equal(TOMBSTONE_RETENTION_DAYS, 90);
});

test('runSync prunes an old tombstone after a successful sync', async () => {
  const { db } = await makeMigratedDb();
  const nowMs = 1_000 * DAY_MS;
  const old = HLC(nowMs - 200 * DAY_MS, 'aaaaaa');
  await db.runAsync('INSERT INTO tombstone (entity, uuid, deleted_at) VALUES (?, ?, ?)', ['tran', 't-old', old]);
  const remote = makeFakeRemote();
  const { deps } = depsFor(db, remote, 'aaaaaa', nowMs);
  await runSync(deps);
  const rows = await db.getAllAsync<{ uuid: string }>('SELECT uuid FROM tombstone');
  assert.equal(rows.length, 0); // GC ran after the (seed) push
});

test('runSync clears sync_in_progress after a successful merge', async () => {
  const { db } = await makeMigratedDb();
  await addAccount(db, 'acc-a', 'Cash', HLC(10, 'aaaaaa'));
  const remote = makeFakeRemote();
  // seed remote with a different account so we take the merge path (not seed)
  const seedDoc = {
    syncFormatVersion: 1, enc: 'none', schemaVersion: 2, generatedAt: 'x', generatedBy: 'b',
    tables: { account: [{ uuid: 'acc-b', name: 'Brokerage', archived: 0, updated_at: HLC(11, 'bbbbbb') }], asset: [], snapshot: [], tran: [], setting: [] },
    tombstones: [],
  };
  remote._seed(JSON.stringify(seedDoc));
  const { deps } = depsFor(db, remote, 'aaaaaa');
  await runSync(deps);
  const flag = await deps.getState(SYNC_IN_PROGRESS_KEY);
  assert.equal(flag, '0');
});

test('runSync leaves sync_in_progress set when the push ultimately fails', async () => {
  const { db } = await makeMigratedDb();
  await addAccount(db, 'acc-a', 'Cash', HLC(10, 'aaaaaa'));
  const remote = makeFakeRemote();
  remote._seed(JSON.stringify({
    syncFormatVersion: 1, enc: 'none', schemaVersion: 2, generatedAt: 'x', generatedBy: 'b',
    tables: { account: [], asset: [], snapshot: [], tran: [], setting: [] }, tombstones: [],
  }));
  // every ifMatch write throws ConflictError -> retries exhausted -> runSync throws
  remote.write = async () => { throw new ConflictError(); };
  const { deps } = depsFor(db, remote, 'aaaaaa');
  await assert.rejects(() => runSync({ ...deps, maxRetries: 1 }));
  const flag = await deps.getState(SYNC_IN_PROGRESS_KEY);
  assert.equal(flag, '1'); // left set so the next launch recovers
});

// A monotonic tick that sorts AFTER any HLC(n,*) the tests use below.
function tickFrom(start: number, dev: string) {
  let n = start;
  return { tick: async () => HLC(n++, dev) };
}

test('erase propagates: device that erases empties the cloud of live data', async () => {
  const { db } = await makeMigratedDb();
  await addAccount(db, 'acc-a', 'Cash', HLC(10, 'aaaaaa'));
  const remote = makeFakeRemote();
  await runSync(depsFor(db, remote, 'aaaaaa').deps); // seed cloud with {Cash}

  await eraseAllData(db, tickFrom(100, 'aaaaaa')); // tombstone + delete locally
  await runSync(depsFor(db, remote, 'aaaaaa', 2_000_000).deps); // push tombstone

  const pushed = parseDocument(remote._content()!);
  assert.equal(pushed.tables.account.length, 0, 'no live accounts in cloud');
  assert.equal(pushed.tombstones.length, 1, 'tombstone present in cloud');
});

test('erase propagates to a second device on its next sync', async () => {
  const { db: dbA } = await makeMigratedDb();
  const { db: dbB } = await makeMigratedDb();
  await addAccount(dbA, 'acc-a', 'Cash', HLC(10, 'aaaaaa'));
  const remote = makeFakeRemote();
  await runSync(depsFor(dbA, remote, 'aaaaaa').deps);     // A seeds {Cash}
  await runSync(depsFor(dbB, remote, 'bbbbbb').deps);     // B pulls {Cash}
  let docB = await buildDocument(dbB, { generatedBy: 'x', generatedAt: 'x' });
  assert.equal(docB.tables.account.length, 1);

  await eraseAllData(dbA, tickFrom(100, 'aaaaaa'));        // A erases
  await runSync(depsFor(dbA, remote, 'aaaaaa', 2_000_000).deps); // push tombstone
  await runSync(depsFor(dbB, remote, 'bbbbbb', 3_000_000).deps); // B applies deletion

  docB = await buildDocument(dbB, { generatedBy: 'x', generatedAt: 'x' });
  assert.equal(docB.tables.account.length, 0, 'B deleted the account');
});

test('no resurrection: a second sync after erase keeps data gone', async () => {
  const { db } = await makeMigratedDb();
  await addAccount(db, 'acc-a', 'Cash', HLC(10, 'aaaaaa'));
  const remote = makeFakeRemote();
  await runSync(depsFor(db, remote, 'aaaaaa').deps);
  await eraseAllData(db, tickFrom(100, 'aaaaaa'));
  await runSync(depsFor(db, remote, 'aaaaaa', 2_000_000).deps);
  await runSync(depsFor(db, remote, 'aaaaaa', 3_000_000).deps); // run again
  const doc = await buildDocument(db, { generatedBy: 'x', generatedAt: 'x' });
  assert.equal(doc.tables.account.length, 0, 'still gone after a 2nd sync');
});

test('import-as-truth: cloud converges to the imported backup', async () => {
  const { db } = await makeMigratedDb();
  await addAccount(db, 'acc-old', 'OldBank', HLC(10, 'aaaaaa'));
  const remote = makeFakeRemote();
  await runSync(depsFor(db, remote, 'aaaaaa').deps); // cloud = {OldBank}

  // Import a backup that contains a DIFFERENT account.
  await eraseAllData(db, { tick: async () => HLC(100, 'aaaaaa') });
  const backup = {
    version: 3, exportedAt: 'x',
    accounts: [{ id: 1, name: 'NewBank', archived: 0, uuid: 'acc-new', updated_at: HLC(5, 'bbbbbb') }],
    assets: [], snapshots: [], transactions: [], settings: [], tombstones: [],
  };
  await restoreBackupDoc(db, backup as any, { freshStamp: HLC(101, 'aaaaaa'), restamp: true });
  await runSync(depsFor(db, remote, 'aaaaaa', 2_000_000).deps);

  const pushed = parseDocument(remote._content()!);
  assert.deepEqual(pushed.tables.account.map((a) => a.name), ['NewBank']);
});

test('runSync skips the write when the merged doc equals the cloud (no-op)', async () => {
  const { db } = await makeMigratedDb();
  await addAccount(db, 'acc-a', 'Cash', HLC(10, 'aaaaaa'));
  const remote = makeFakeRemote();
  await runSync(depsFor(db, remote, 'aaaaaa').deps); // seed -> cloud = {Cash}
  const before = remote._content();
  let writes = 0;
  const realWrite = remote.write.bind(remote);
  remote.write = async (c, pre) => { writes++; return realWrite(c, pre); };
  const out = await runSync(depsFor(db, remote, 'aaaaaa', 2_000_000).deps); // nothing changed
  assert.equal(out.status, 'unchanged');
  assert.equal(writes, 0, 'no PUT when content identical');
  assert.equal(remote._content(), before);
});

test('runSync with conditionalEtag returns unchanged on a 304 (no merge/write)', async () => {
  const { db } = await makeMigratedDb();
  await addAccount(db, 'acc-a', 'Cash', HLC(10, 'aaaaaa'));
  const remote = makeFakeRemote();
  await runSync(depsFor(db, remote, 'aaaaaa').deps); // seed; etag now v1
  const etag = 'v1';
  let writes = 0; const realWrite = remote.write.bind(remote);
  remote.write = async (c, p) => { writes++; return realWrite(c, p); };
  const { deps } = depsFor(db, remote, 'aaaaaa', 2_000_000);
  const out = await runSync({ ...deps, conditionalEtag: etag });
  assert.equal(out.status, 'unchanged');
  assert.equal(writes, 0);
});

test('dataFingerprint is order-independent: reversed remote row order still skips upload', async () => {
  // Insert two accounts locally in one order (acc-a first, acc-b second).
  const { db } = await makeMigratedDb();
  await addAccount(db, 'acc-a', 'Alpha', HLC(10, 'aaaaaa'));
  await addAccount(db, 'acc-b', 'Beta', HLC(11, 'aaaaaa'));

  // Seed the remote with the SAME two accounts but in REVERSED order ([acc-b, acc-a]).
  // This simulates a second device that happened to SELECT them in a different order.
  const remote = makeFakeRemote();
  const reversedDoc: SyncDocument = {
    syncFormatVersion: 1, enc: 'none', schemaVersion: 2, generatedAt: 'x', generatedBy: 'b',
    tables: {
      account: [
        { uuid: 'acc-b', name: 'Beta', archived: 0, updated_at: HLC(11, 'aaaaaa') },
        { uuid: 'acc-a', name: 'Alpha', archived: 0, updated_at: HLC(10, 'aaaaaa') },
      ],
      asset: [], snapshot: [], tran: [], setting: [],
    },
    tombstones: [],
  };
  remote._seed(serializeDocument(reversedDoc));

  let writes = 0;
  const realWrite = remote.write.bind(remote);
  remote.write = async (c, pre) => { writes++; return realWrite(c, pre); };

  const { deps } = depsFor(db, remote, 'aaaaaa', 2_000_000);
  const out = await runSync(deps);

  assert.equal(out.status, 'unchanged', 'should be unchanged — data is identical despite row-order difference');
  assert.equal(writes, 0, 'no upload when content is the same regardless of row order');
});

test('runSync persists cloud_etag after a sync', async () => {
  const { db } = await makeMigratedDb();
  await addAccount(db, 'acc-a', 'Cash', HLC(10, 'aaaaaa'));
  const remote = makeFakeRemote();
  const { deps } = depsFor(db, remote, 'aaaaaa');
  await runSync(deps);
  assert.equal(await deps.getState(CLOUD_ETAG_KEY), 'v1'); // seeded write -> etag v1
});
