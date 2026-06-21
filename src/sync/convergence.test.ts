import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMigratedDb } from './test-support/sqlite';
import { buildDocument } from './document';
import { merge } from './merge';
import { applyMerge } from './apply';
import type { CicadaDB } from '../db/migrations';

const ts = (p: number, c = 0, d = 'aaaaaa') =>
  `${String(p).padStart(15, '0')}-${String(c).padStart(5, '0')}-${d}`;

// Snapshot of the domain tables for equality comparison (ignores local ids).
async function snapshotState(db: CicadaDB) {
  const norm = (rows: any[], keys: string[]) =>
    rows
      .map((r) => keys.map((k) => `${k}=${r[k]}`).join('|'))
      .sort();
  return {
    account: norm(await db.getAllAsync('SELECT uuid, name, archived FROM account'), ['uuid', 'name', 'archived']),
    asset: norm(
      await db.getAllAsync('SELECT a.uuid AS uuid, acc.uuid AS p, a.name AS name FROM asset a JOIN account acc ON a.account_id = acc.id'),
      ['uuid', 'p', 'name']
    ),
    snapshot: norm(
      await db.getAllAsync('SELECT a.uuid AS p, s.date AS date, s.net_worth AS nw FROM asset_snapshot s JOIN asset a ON s.asset_id = a.id'),
      ['p', 'date', 'nw']
    ),
    tran: norm(await db.getAllAsync('SELECT uuid, value FROM tran'), ['uuid', 'value']),
  };
}

// One full sync round between two DBs via a shared document (A pushes, B pulls+pushes, A pulls).
async function syncRound(a: { db: CicadaDB }, b: { db: CicadaDB }) {
  const docA = await buildDocument(a.db, { generatedBy: 'A', generatedAt: 'x' });
  const docB = await buildDocument(b.db, { generatedBy: 'B', generatedAt: 'x' });
  await applyMerge(b.db, merge(docB, docA)); // B merges in A
  const docB2 = await buildDocument(b.db, { generatedBy: 'B', generatedAt: 'x' });
  await applyMerge(a.db, merge(docA, docB2)); // A merges in B's merged result
}

test('two devices with disjoint offline edits converge to the same state', async () => {
  const A = await makeMigratedDb();
  const B = await makeMigratedDb();
  // A creates account+asset; B creates a transaction. Independent uuids.
  await applyMerge(A.db, {
    tables: {
      account: [{ uuid: 'accA', name: 'Bank', archived: 0, updated_at: ts(1) }],
      asset: [{ uuid: 'asA', accountUuid: 'accA', name: 'S', categories: '{}', archived: 0, updated_at: ts(2) }],
      snapshot: [], tran: [], setting: [],
    },
    tombstones: [],
  });
  await applyMerge(B.db, {
    tables: { account: [], asset: [], snapshot: [],
      tran: [{ uuid: 'trB', date: 'd', type: 'INCOME', value: 7, cat: '', note: '', updated_at: ts(3) }],
      setting: [] },
    tombstones: [],
  });

  await syncRound(A, B);

  assert.deepEqual(await snapshotState(A.db), await snapshotState(B.db));
  // Both ended up with the account, asset, and the transaction.
  assert.equal((await A.db.getAllAsync('SELECT * FROM account')).length, 1);
  assert.equal((await A.db.getAllAsync('SELECT * FROM tran')).length, 1);
});

test('a delete on A propagates to B and a second round changes nothing (idempotent)', async () => {
  const A = await makeMigratedDb();
  const B = await makeMigratedDb();
  const seed = {
    tables: { account: [], asset: [], snapshot: [],
      tran: [{ uuid: 'tr1', date: 'd', type: 'INCOME', value: 1, cat: '', note: '', updated_at: ts(1) }],
      setting: [] },
    tombstones: [],
  };
  await applyMerge(A.db, seed);
  await applyMerge(B.db, seed);
  // A deletes the transaction.
  await applyMerge(A.db, {
    tables: { account: [], asset: [], snapshot: [], tran: [], setting: [] },
    tombstones: [{ entity: 'tran', uuid: 'tr1', deleted_at: ts(5) }],
  });

  await syncRound(A, B);
  assert.equal((await B.db.getAllAsync('SELECT * FROM tran')).length, 0); // delete propagated
  const stateAfterFirst = await snapshotState(B.db);

  await syncRound(A, B); // second round
  assert.deepEqual(await snapshotState(B.db), stateAfterFirst); // no change — idempotent
  assert.deepEqual(await snapshotState(A.db), await snapshotState(B.db));
});

test('first-connect: both devices independently created the same-named account -> one account', async () => {
  const A = await makeMigratedDb();
  const B = await makeMigratedDb();
  await applyMerge(A.db, {
    tables: { account: [{ uuid: 'accA', name: 'Cash', archived: 0, updated_at: ts(1) }], asset: [], snapshot: [], tran: [], setting: [] },
    tombstones: [],
  });
  await applyMerge(B.db, {
    tables: { account: [{ uuid: 'accB', name: 'Cash', archived: 0, updated_at: ts(2) }], asset: [], snapshot: [], tran: [], setting: [] },
    tombstones: [],
  });

  await syncRound(A, B);
  await syncRound(A, B); // a second round to let adoption settle both directions

  assert.deepEqual(await snapshotState(A.db), await snapshotState(B.db));
  assert.equal((await A.db.getAllAsync('SELECT * FROM account')).length, 1); // adopted into one
});
