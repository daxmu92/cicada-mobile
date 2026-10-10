import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMigratedDb } from '../sync/test-support/sqlite';
import { monthValuation, monthlyValuations } from './valuation';
async function seed() {
  const h = await makeMigratedDb();
  await h.db.execAsync("INSERT INTO account(id,name) VALUES(1,'Bank'); INSERT INTO asset(id,account_id,name) VALUES(1,1,'A'),(2,1,'B'); INSERT INTO asset_snapshot(asset_id,date,net_worth,profit,inflow) VALUES(1,'2026-01',100,0,0),(2,'2026-01',100,0,0),(2,'2026-02',200,10,90);");
  return h;
}
test('monthly cards and range totals share forward-fill policy and do not repeat flows', async () => {
  const {db} = await seed();
  const rows = await monthValuation(db, '2026-02', {forwardFill: true});
  assert.equal(rows.reduce((sum,row)=>sum+row.netWorth,0),300);
  assert.equal(rows.find(row=>row.assetId===1)!.estimated,true);
  assert.deepEqual(await monthlyValuations(db,'2026-01','2026-02',{forwardFill:true}),[{date:'2026-01',netWorth:200,profit:0,inflow:0},{date:'2026-02',netWorth:300,profit:10,inflow:90}]);
});
test('archive preserves recorded history and stops inferred future balances', async () => {
  const {db} = await seed();await db.runAsync('UPDATE asset SET archived=1 WHERE id=1');
  assert.equal((await monthlyValuations(db,'2026-01','2026-01'))[0].netWorth,200);
  assert.equal((await monthlyValuations(db,'2026-02','2026-02',{forwardFill:true}))[0].netWorth,200);
  assert.equal((await monthlyValuations(db,'2026-01','2026-01',{includeArchived:false}))[0].netWorth,100);
});
