import { test } from 'node:test';
import assert from 'node:assert';
import { makeMigratedDb } from './test-support/sqlite';
import { buildDocument, serializeDocument, parseDocument, type SyncDocument } from './document';
import { ConflictError } from './providers/types';
import type { SyncRemote, WritePrecondition } from './providers/types';
import { runSync, maxRemoteStamp, gcTombstones, TOMBSTONE_RETENTION_DAYS } from './sync';
import type { CicadaDB } from '../db/migrations';

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
    read: async () => (content === null ? null : { content, etag: etag() }),
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
