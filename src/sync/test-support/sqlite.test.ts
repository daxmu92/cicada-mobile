import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMemoryDb, makeMigratedDb } from './sqlite';

test('makeMemoryDb exposes the CicadaDB interface over better-sqlite3', async () => {
  const { db } = makeMemoryDb();
  await db.execAsync('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
  const r = await db.runAsync('INSERT INTO t (v) VALUES (?)', ['hi']);
  assert.equal(r.changes, 1);
  assert.ok(r.lastInsertRowId > 0);
  const row = await db.getFirstAsync<{ v: string }>('SELECT v FROM t WHERE id = ?', [r.lastInsertRowId]);
  assert.equal(row?.v, 'hi');
  const all = await db.getAllAsync<{ v: string }>('SELECT v FROM t');
  assert.equal(all.length, 1);
});

test('makeMigratedDb produces a v2 schema with sync_state seeded', async () => {
  const { db } = await makeMigratedDb();
  const ver = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  assert.equal(ver?.user_version, 2);
  // Phase-1 migration seeds deviceId + hlc into sync_state.
  const dev = await db.getFirstAsync<{ value: string }>("SELECT value FROM sync_state WHERE key = 'deviceId'");
  assert.ok(dev?.value && dev.value.length === 6);
  // Core tables exist and are queryable.
  for (const t of ['account', 'asset', 'asset_snapshot', 'tran', 'setting', 'tombstone']) {
    const rows = await db.getAllAsync(`SELECT * FROM ${t}`);
    assert.ok(Array.isArray(rows));
  }
});
