import { test } from 'node:test';
import assert from 'node:assert/strict';
import { merge } from './merge';
import type { SyncDocument } from './document';

// HLC strings are fixed-width; a bigger phys sorts later. Helper for readability.
const ts = (phys: number, counter = 0, dev = 'aaaaaa') =>
  `${String(phys).padStart(15, '0')}-${String(counter).padStart(5, '0')}-${dev}`;

function emptyDoc(): SyncDocument {
  return {
    syncFormatVersion: 1, enc: 'none', schemaVersion: 2,
    generatedAt: 'x', generatedBy: 'dev',
    tables: { account: [], asset: [], snapshot: [], tran: [], setting: [] },
    tombstones: [],
  };
}

test('disjoint records from both sides are unioned', () => {
  const local = emptyDoc();
  local.tables.account = [{ uuid: 'a', name: 'A', archived: 0, updated_at: ts(1) }];
  const remote = emptyDoc();
  remote.tables.account = [{ uuid: 'b', name: 'B', archived: 0, updated_at: ts(1) }];
  const r = merge(local, remote);
  assert.deepEqual(r.tables.account.map(a => a.uuid).sort(), ['a', 'b']);
});

test('same uuid: the greater updated_at wins (remote newer)', () => {
  const local = emptyDoc();
  local.tables.account = [{ uuid: 'a', name: 'old', archived: 0, updated_at: ts(1) }];
  const remote = emptyDoc();
  remote.tables.account = [{ uuid: 'a', name: 'new', archived: 0, updated_at: ts(2) }];
  const r = merge(local, remote);
  assert.equal(r.tables.account.length, 1);
  assert.equal(r.tables.account[0].name, 'new');
});

test('same uuid: local newer wins', () => {
  const local = emptyDoc();
  local.tables.account = [{ uuid: 'a', name: 'localnew', archived: 0, updated_at: ts(5) }];
  const remote = emptyDoc();
  remote.tables.account = [{ uuid: 'a', name: 'remoteold', archived: 0, updated_at: ts(2) }];
  const r = merge(local, remote);
  assert.equal(r.tables.account[0].name, 'localnew');
});

test('tombstone newer than the record suppresses it', () => {
  const local = emptyDoc();
  local.tables.tran = [{ uuid: 't', date: 'd', type: 'INCOME', value: 1, cat: '', note: '', updated_at: ts(1) }];
  const remote = emptyDoc();
  remote.tombstones = [{ entity: 'tran', uuid: 't', deleted_at: ts(2) }];
  const r = merge(local, remote);
  assert.equal(r.tables.tran.length, 0);
  assert.deepEqual(r.tombstones, [{ entity: 'tran', uuid: 't', deleted_at: ts(2) }]);
});

test('record newer than the tombstone (resurrection) keeps the record', () => {
  const local = emptyDoc();
  local.tables.tran = [{ uuid: 't', date: 'd', type: 'INCOME', value: 1, cat: '', note: '', updated_at: ts(5) }];
  const remote = emptyDoc();
  remote.tombstones = [{ entity: 'tran', uuid: 't', deleted_at: ts(2) }];
  const r = merge(local, remote);
  assert.equal(r.tables.tran.length, 1);
});

test('tombstones union keeps the greater deleted_at', () => {
  const local = emptyDoc();
  local.tombstones = [{ entity: 'asset', uuid: 'x', deleted_at: ts(1) }];
  const remote = emptyDoc();
  remote.tombstones = [{ entity: 'asset', uuid: 'x', deleted_at: ts(9) }];
  const r = merge(local, remote);
  assert.deepEqual(r.tombstones, [{ entity: 'asset', uuid: 'x', deleted_at: ts(9) }]);
});

test('snapshot identity is composite (assetUuid|date)', () => {
  const local = emptyDoc();
  local.tables.snapshot = [{ assetUuid: 'as', date: '2026-06', netWorth: 1, inflow: 0, profit: 0, updated_at: ts(1) }];
  const remote = emptyDoc();
  remote.tables.snapshot = [
    { assetUuid: 'as', date: '2026-06', netWorth: 2, inflow: 0, profit: 0, updated_at: ts(2) }, // same cell, newer
    { assetUuid: 'as', date: '2026-07', netWorth: 3, inflow: 0, profit: 0, updated_at: ts(1) }, // different cell
  ];
  const r = merge(local, remote);
  const june = r.tables.snapshot.find(s => s.date === '2026-06');
  const july = r.tables.snapshot.find(s => s.date === '2026-07');
  assert.equal(june?.netWorth, 2);
  assert.equal(july?.netWorth, 3);
  assert.equal(r.tables.snapshot.length, 2);
});

test('a snapshot tombstone uses the composite key', () => {
  const local = emptyDoc();
  local.tables.snapshot = [{ assetUuid: 'as', date: '2026-06', netWorth: 1, inflow: 0, profit: 0, updated_at: ts(1) }];
  const remote = emptyDoc();
  remote.tombstones = [{ entity: 'snapshot', uuid: 'as|2026-06', deleted_at: ts(2) }];
  const r = merge(local, remote);
  assert.equal(r.tables.snapshot.length, 0);
});

test('settings merge by key and are never tombstone-suppressed', () => {
  const local = emptyDoc();
  local.tables.setting = [{ key: 'currency', value: '$', updated_at: ts(1) }];
  const remote = emptyDoc();
  remote.tables.setting = [{ key: 'currency', value: '¥', updated_at: ts(2) }];
  remote.tombstones = [{ entity: 'setting', uuid: 'currency', deleted_at: ts(9) }]; // must be ignored
  const r = merge(local, remote);
  assert.equal(r.tables.setting.length, 1);
  assert.equal(r.tables.setting[0].value, '¥');
});

test('merge is commutative on the live set', () => {
  const a = emptyDoc();
  a.tables.account = [{ uuid: 'a', name: 'A1', archived: 0, updated_at: ts(1) }];
  a.tables.tran = [{ uuid: 't', date: 'd', type: 'INCOME', value: 1, cat: '', note: '', updated_at: ts(3) }];
  const b = emptyDoc();
  b.tables.account = [{ uuid: 'a', name: 'A2', archived: 0, updated_at: ts(2) }];
  b.tombstones = [{ entity: 'tran', uuid: 't', deleted_at: ts(2) }];
  const ab = merge(a, b);
  const ba = merge(b, a);
  const norm = (xs: { uuid: string; name: string }[]) => xs.map(x => `${x.uuid}:${x.name}`).sort();
  assert.deepEqual(norm(ab.tables.account), norm(ba.tables.account));
  assert.equal(ab.tables.tran.length, ba.tables.tran.length);
  assert.equal(ab.tables.tran.length, 1); // tran edit (ts3) beats tombstone (ts2)
});

test('merge is idempotent: merging a built result with one input is stable', () => {
  const a = emptyDoc();
  a.tables.account = [{ uuid: 'a', name: 'A', archived: 0, updated_at: ts(2) }];
  const b = emptyDoc();
  b.tables.account = [{ uuid: 'a', name: 'A', archived: 0, updated_at: ts(1) }];
  const once = merge(a, b);
  const asDoc: SyncDocument = { ...a, tables: once.tables, tombstones: once.tombstones };
  const twice = merge(asDoc, b);
  assert.deepEqual(twice.tables.account, once.tables.account);
});
