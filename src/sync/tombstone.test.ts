import { test } from 'node:test';
import assert from 'node:assert';
import { makeMigratedDb } from './test-support/sqlite';
import { recordTombstonesAt } from './tombstone';

const HLC = (n: number, dev: string) => `${String(n).padStart(15, '0')}-00000-${dev.padStart(6, '0')}`;

test('recordTombstonesAt writes a tombstone per uuid at the given stamp', async () => {
  const { db } = await makeMigratedDb();
  await recordTombstonesAt(db, 'account', ['u1', 'u2'], HLC(5, 'aaaaaa'));
  const rows = await db.getAllAsync<{ entity: string; uuid: string; deleted_at: string }>(
    'SELECT entity, uuid, deleted_at FROM tombstone ORDER BY uuid'
  );
  assert.deepEqual(rows.map((r) => r.uuid), ['u1', 'u2']);
  assert.equal(rows[0].deleted_at, HLC(5, 'aaaaaa'));
});

test('recordTombstonesAt keeps the MAX deleted_at on conflict', async () => {
  const { db } = await makeMigratedDb();
  await recordTombstonesAt(db, 'tran', ['t1'], HLC(9, 'aaaaaa'));
  await recordTombstonesAt(db, 'tran', ['t1'], HLC(3, 'aaaaaa')); // older -> ignored
  const row = await db.getFirstAsync<{ deleted_at: string }>(
    "SELECT deleted_at FROM tombstone WHERE entity='tran' AND uuid='t1'"
  );
  assert.equal(row!.deleted_at, HLC(9, 'aaaaaa'));
});

test('recordTombstonesAt is a no-op for an empty uuid list', async () => {
  const { db } = await makeMigratedDb();
  await recordTombstonesAt(db, 'asset', [], HLC(1, 'aaaaaa'));
  const rows = await db.getAllAsync('SELECT 1 FROM tombstone');
  assert.equal(rows.length, 0);
});
