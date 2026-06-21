import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMigratedDb } from './test-support/sqlite';
import { applyMerge } from './apply';
import type { MergeResult } from './merge';

const ts = (p: number, c = 0, d = 'aaaaaa') =>
  `${String(p).padStart(15, '0')}-${String(c).padStart(5, '0')}-${d}`;

function emptyMerge(): MergeResult {
  return { tables: { account: [], asset: [], snapshot: [], tran: [], setting: [] }, tombstones: [] };
}

test('applyMerge inserts a fresh account/asset/snapshot/tran/setting', async () => {
  const { db } = await makeMigratedDb();
  const m = emptyMerge();
  m.tables.account = [{ uuid: 'acc1', name: 'Bank', archived: 0, updated_at: ts(1) }];
  m.tables.asset = [{ uuid: 'as1', accountUuid: 'acc1', name: 'Savings', categories: '{}', archived: 0, updated_at: ts(2) }];
  m.tables.snapshot = [{ assetUuid: 'as1', date: '2026-06', netWorth: 100, inflow: 10, profit: 5, updated_at: ts(3) }];
  m.tables.tran = [{ uuid: 'tr1', date: '2026-06-01', type: 'INCOME', value: 50, cat: 'x', note: 'n', updated_at: ts(4) }];
  m.tables.setting = [{ key: 'currency', value: '$', updated_at: ts(5) }];

  const res = await applyMerge(db, m);
  assert.deepEqual(res.suffixed, []);

  const acc = await db.getFirstAsync<{ id: number; uuid: string }>('SELECT id, uuid FROM account');
  assert.equal(acc?.uuid, 'acc1');
  const as = await db.getFirstAsync<{ account_id: number; uuid: string }>('SELECT account_id, uuid FROM asset');
  assert.equal(as?.account_id, acc?.id); // FK resolved via uuid->id map
  const sn = await db.getFirstAsync<{ net_worth: number }>('SELECT net_worth FROM asset_snapshot');
  assert.equal(sn?.net_worth, 100);
  const tr = await db.getFirstAsync<{ value: number }>('SELECT value FROM tran');
  assert.equal(tr?.value, 50);
  const st = await db.getFirstAsync<{ value: string }>("SELECT value FROM setting WHERE key='currency'");
  assert.equal(st?.value, '$');
});

test('applyMerge updates an existing row by uuid', async () => {
  const { db } = await makeMigratedDb();
  const first = emptyMerge();
  first.tables.account = [{ uuid: 'acc1', name: 'Bank', archived: 0, updated_at: ts(1) }];
  await applyMerge(db, first);

  const second = emptyMerge();
  second.tables.account = [{ uuid: 'acc1', name: 'Renamed', archived: 1, updated_at: ts(9) }];
  await applyMerge(db, second);

  const rows = await db.getAllAsync<{ name: string; archived: number }>('SELECT name, archived FROM account');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Renamed');
  assert.equal(rows[0].archived, 1);
});

test('first-connect: same account name with a different uuid is adopted, not duplicated', async () => {
  const { db, raw } = await makeMigratedDb();
  // Local row created independently (its own uuid).
  raw.prepare('INSERT INTO account (name, archived, uuid, updated_at) VALUES (?, ?, ?, ?)')
    .run('Bank', 0, 'local-uuid', ts(1));
  // Remote brings "Bank" under a different uuid.
  const m = emptyMerge();
  m.tables.account = [{ uuid: 'remote-uuid', name: 'Bank', archived: 0, updated_at: ts(2) }];
  await applyMerge(db, m);

  const rows = await db.getAllAsync<{ uuid: string }>('SELECT uuid FROM account');
  assert.equal(rows.length, 1); // adopted, not duplicated
  assert.equal(rows[0].uuid, 'remote-uuid');
});

test('first-connect: same account name unifies even when the local copy is newer', async () => {
  const { db, raw } = await makeMigratedDb();
  // Local "Bank" is NEWER than the incoming remote record.
  raw.prepare('INSERT INTO account (name, archived, uuid, updated_at) VALUES (?, ?, ?, ?)')
    .run('Bank', 0, 'localUuid', ts(5));
  const m = emptyMerge();
  m.tables.account = [{ uuid: 'remoteUuid', name: 'Bank', archived: 0, updated_at: ts(1) }];
  await applyMerge(db, m);

  const rows = await db.getAllAsync<{ uuid: string }>('SELECT uuid FROM account');
  assert.equal(rows.length, 1);            // unified, not two
  assert.equal(rows[0].uuid, 'remoteUuid'); // remote uuid adopted onto the local row
});

test('genuine uuid collision auto-suffixes (adoption blocked because the uuid already exists locally)', async () => {
  const { db, raw } = await makeMigratedDb();
  raw.prepare('INSERT INTO account (name, archived, uuid, updated_at) VALUES (?, ?, ?, ?)')
    .run('Bank', 0, 'uuidX', ts(1));
  raw.prepare('INSERT INTO account (name, archived, uuid, updated_at) VALUES (?, ?, ?, ?)')
    .run('Other', 0, 'uuidY', ts(1));
  // Remote renames uuidY to "Bank" — adoption is blocked (uuidY already exists),
  // so the upsert rename collides with uuidX's "Bank" and must auto-suffix.
  const m = emptyMerge();
  m.tables.account = [{ uuid: 'uuidY', name: 'Bank', archived: 0, updated_at: ts(9) }];
  const res = await applyMerge(db, m);

  const rows = await db.getAllAsync<{ uuid: string; name: string }>('SELECT uuid, name FROM account ORDER BY uuid');
  assert.equal(rows.length, 2);
  assert.equal(rows.find(r => r.uuid === 'uuidX')?.name, 'Bank');
  assert.equal(rows.find(r => r.uuid === 'uuidY')?.name, 'Bank (2)');
  assert.ok(res.suffixed.includes('account:Bank'));
});

test('asset re-parenting moves the asset to the new account', async () => {
  const { db } = await makeMigratedDb();
  const base = emptyMerge();
  base.tables.account = [
    { uuid: 'accA', name: 'A', archived: 0, updated_at: ts(1) },
    { uuid: 'accB', name: 'B', archived: 0, updated_at: ts(1) },
  ];
  base.tables.asset = [{ uuid: 'as1', accountUuid: 'accA', name: 'X', categories: '{}', archived: 0, updated_at: ts(2) }];
  await applyMerge(db, base);

  const move = emptyMerge();
  move.tables.account = base.tables.account;
  move.tables.asset = [{ uuid: 'as1', accountUuid: 'accB', name: 'X', categories: '{}', archived: 0, updated_at: ts(9) }];
  await applyMerge(db, move);

  const row = await db.getFirstAsync<{ account_id: number }>('SELECT account_id FROM asset WHERE uuid = ?', ['as1']);
  const accB = await db.getFirstAsync<{ id: number }>("SELECT id FROM account WHERE uuid = 'accB'");
  assert.equal(row?.account_id, accB?.id);
});
