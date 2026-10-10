import {test} from 'node:test';
import assert from 'node:assert/strict';
import {allocationRows} from './allocation';
test('asset percentages use the positive subtotal while debt stays separate',()=>{
 const result=allocationRows([{label:'Cash',value:100},{label:'Debt',value:-50}],8,'Others');
 assert.equal(result.total,100);assert.equal(result.liabilities,50);assert.equal(result.visible.length,1);
});
test('allocation cap retains every positive amount in the others bucket',()=>{
 const result=allocationRows(Array.from({length:10},(_,i)=>({label:String(i),value:i+1})),8,'Others');
 assert.equal(result.visible.length,8);assert.equal(result.visible.reduce((sum,row)=>sum+row.value,0),55);assert.equal(result.visible.at(-1)!.label,'Others');
});
