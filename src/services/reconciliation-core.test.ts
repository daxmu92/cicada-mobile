import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMigratedDb } from '../sync/test-support/sqlite';
import { previewReconciliation,applyReconciliation } from './reconciliation-core';
import { buildSampleData } from './sample-data-core';
import { restoreBackupDoc } from './backup-core';
const old='000000000000100-00000-aaaaaa'; const fresh='000000000000200-00000-aaaaaa';
async function ledger() {
  const db=await makeMigratedDb();
  await db.db.runAsync('INSERT INTO account(id,name,uuid,updated_at) VALUES(1,?,?,?)',['Test','acc',old]);
  await db.db.runAsync('INSERT INTO asset(id,account_id,name,categories,uuid,updated_at) VALUES(1,1,?,?,?,?)',['Asset','{}','asset',old]);
  for(const [date,nw,inflow,profit] of [['2026-01',100,100,0],['2026-02',130,10,10],['2026-03',140,5,5]]) {
    await db.db.runAsync('INSERT INTO asset_snapshot(asset_id,date,net_worth,inflow,profit,updated_at) VALUES(1,?,?,?,?,?)',[date as string,nw as number,inflow as number,profit as number,old]);
  }
  return db;
}
test('preview skips the opening record and only changes confirmed profits with recovery backup',async()=>{
  const {db}=await ledger();const preview=await previewReconciliation(db,1);
  assert.deepEqual(preview.changes,[{date:'2026-02',before:10,after:20,previousDate:'2026-01'}]);
  assert.equal(await applyReconciliation(db,preview,fresh),1);
  assert.deepEqual(await db.getFirstAsync('SELECT net_worth,inflow,profit,updated_at FROM asset_snapshot WHERE date=?',['2026-02']),{net_worth:130,inflow:10,profit:20,updated_at:fresh});
  const backup=await db.getFirstAsync<{content:string}>('SELECT content FROM local_backup');
  assert.equal(JSON.parse(backup!.content).snapshots[1].profit,10);
});
test('an edited source invalidates the preview and preserves all financial data',async()=>{
  const {db}=await ledger();const preview=await previewReconciliation(db,1);
  await db.runAsync('UPDATE asset_snapshot SET net_worth=110,updated_at=? WHERE date=?',[fresh,'2026-01']);
  await assert.rejects(applyReconciliation(db,preview,fresh),/RECONCILIATION_CHANGED/);
  assert.equal((await db.getFirstAsync<{profit:number}>('SELECT profit FROM asset_snapshot WHERE date=?',['2026-02']))?.profit,10);
});
test('a failed recalculation rolls back both earlier changes and its recovery copy',async()=>{
  const {db,raw}=await ledger();await db.runAsync('UPDATE asset_snapshot SET profit=0 WHERE date=?',['2026-03']);
  const preview=await previewReconciliation(db,1);
  raw.exec("CREATE TRIGGER fail_update BEFORE UPDATE ON asset_snapshot WHEN NEW.date='2026-03' BEGIN SELECT RAISE(ABORT,'test rollback'); END");
  await assert.rejects(applyReconciliation(db,preview,fresh),/test rollback/);
  assert.equal((await db.getFirstAsync<{profit:number}>('SELECT profit FROM asset_snapshot WHERE date=?',['2026-02']))?.profit,10);
  assert.equal((await db.getFirstAsync<{n:number}>('SELECT COUNT(*) AS n FROM local_backup'))?.n,0);
});
test('generated demo snapshots are internally consistent to cents',async()=>{
  const {db}=await makeMigratedDb();await restoreBackupDoc(db,buildSampleData(),{freshStamp:old});
  for(const asset of await db.getAllAsync<{id:number}>('SELECT id FROM asset'))assert.equal((await previewReconciliation(db,asset.id)).changes.length,0);
});
