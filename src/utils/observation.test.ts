import { abbrev } from './chart';
import test from 'node:test';
import assert from 'node:assert/strict';
import { compareRecordedAssets, completeTrend, trendPath } from './observation';
import type { SnapshotWithAsset } from './types';
const row = (id: number, netWorth: number, inflow = 0, profit = 0, estimated = false): SnapshotWithAsset => ({assetId:id,date:'2026-07',assetName:'Synthetic',accountName:'Test',netWorth,inflow,profit,estimated});
test('comparison excludes missing assets and inferred values; preserves cents and separates residual', () => {
  const result = compareRecordedAssets([row(1,110.15,5.05,4.1),row(2,500),row(3,200,0,0,true)], [row(1,100),row(4,1000),row(3,190)]);
  assert.deepEqual(result,{count:1,change:10.15,percent:10.15,inflow:5.05,profit:4.1,residual:1});
  assert.equal(compareRecordedAssets([row(2,100)],[row(1,100)]).change,null);
  assert.equal(compareRecordedAssets([row(1,10)],[row(1,0)]).percent,null);
});
test('monthly axis retains missing months; paths break instead of interpolating across gaps', () => {
 const points=completeTrend('2026-01','2026-04',[{date:'2026-01',netWorth:0},{date:'2026-02',netWorth:10},{date:'2026-04',netWorth:30}]);
 assert.deepEqual(points.map(p=>p.value),[0,10,null,30]);
 assert.equal(trendPath(points,i=>i,v=>v),'M0,0 L1,10  M3,30');
});
test('calendar compares matching records instead of interpreting omitted assets as a loss',async()=>{
 const {calendarChanges}=await import('./observation');
 const rows=[{...row(1,100),date:'2026-01'},{...row(2,1000),date:'2026-01'},{...row(1,110),date:'2026-02'}];
 const result=calendarChanges('2026-02','2026-03',rows);
 assert.equal(result[0].change,10);assert.equal(result[0].count,1);assert.equal(result[1].change,null);
});

test('trend labels retain meaningful differences for narrow monetary ranges',()=>{
 assert.deepEqual([10000,10200,10400].map(value=>abbrev(value,200)),['10K','10.2K','10.4K']);
 assert.deepEqual([.1,.2,.3].map(value=>abbrev(value,.1)),['0.1','0.2','0.3']);
});
