import { test } from 'node:test';
import assert from 'node:assert';
import { makeMigratedDb } from './test-support/sqlite';
import { eraseAllData } from './erase';

const HLC = (n: number, dev: string) => `${String(n).padStart(15, '0')}-00000-${dev.padStart(6, '0')}`;

async function seed(db: any) {
  await db.runAsync("INSERT INTO account (id, name, archived, uuid, updated_at) VALUES (1,'Bank',0,'acc-1',?)", [HLC(1, 'aaaaaa')]);
  await db.runAsync("INSERT INTO asset (id, account_id, name, categories, archived, uuid, updated_at) VALUES (1,1,'Checking','{}',0,'as-1',?)", [HLC(1, 'aaaaaa')]);
  await db.runAsync("INSERT INTO asset_snapshot (asset_id, date, net_worth, inflow, profit, updated_at) VALUES (1,'2026-01',100,0,0,?)", [HLC(1, 'aaaaaa')]);
  await db.runAsync("INSERT INTO tran (id, date, type, value, cat, note, uuid, updated_at) VALUES (1,'2026-01-05','OUTLAY',5,'food','',? ,?)", ['tr-1', HLC(1, 'aaaaaa')]);
  await db.runAsync("INSERT INTO setting (key, value, updated_at) VALUES ('currency','€',?)", [HLC(1, 'aaaaaa')]);
}

function fixedTick(stamp: string) {
  return { tick: async () => stamp };
}

test('eraseAllData deletes all data rows but keeps settings', async () => {
  const { db } = await makeMigratedDb();
  await seed(db);
  await eraseAllData(db, fixedTick(HLC(9, 'aaaaaa')));
  for (const t of ['account', 'asset', 'asset_snapshot', 'tran']) {
    const rows = await db.getAllAsync(`SELECT 1 FROM ${t}`);
    assert.equal(rows.length, 0, `${t} should be empty`);
  }
  const settings = await db.getAllAsync('SELECT 1 FROM setting');
  assert.equal(settings.length, 1, 'settings preserved');
});

test('eraseAllData tombstones every entity at the erase stamp', async () => {
  const { db } = await makeMigratedDb();
  await seed(db);
  await eraseAllData(db, fixedTick(HLC(9, 'aaaaaa')));
  const toms = await db.getAllAsync<{ entity: string; uuid: string; deleted_at: string }>(
    'SELECT entity, uuid, deleted_at FROM tombstone ORDER BY entity, uuid'
  );
  assert.deepEqual(toms.map((t) => `${t.entity}:${t.uuid}`).sort(), [
    'account:acc-1', 'asset:as-1', 'snapshot:as-1|2026-01', 'tran:tr-1',
  ].sort());
  for (const t of toms) assert.equal(t.deleted_at, HLC(9, 'aaaaaa'));
});

test('eraseAllData on an empty DB is a no-op', async () => {
  const { db } = await makeMigratedDb();
  await eraseAllData(db, fixedTick(HLC(9, 'aaaaaa')));
  const toms = await db.getAllAsync('SELECT 1 FROM tombstone');
  assert.equal(toms.length, 0);
});
