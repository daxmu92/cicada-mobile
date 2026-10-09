import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterTransactions } from './transaction-filter';
import type { Transaction } from './types';
test('search and exact tags combine with transaction types without changing the source',()=>{
  const rows:Transaction[]=[{id:1,date:'2026-01-01',type:'INCOME',value:100.15,cat:'Salary, Bank',note:'Monthly pay'},{id:2,date:'2026-01-02',type:'OUTLAY',value:15,cat:'Banking',note:'BANK fee'}];
  assert.deepEqual(filterTransactions(rows,{search:'BANK',type:'ALL',tag:'Bank'}).map(r=>r.id),[1]);
  assert.deepEqual(filterTransactions(rows,{search:'fee',type:'OUTLAY',tag:''}).map(r=>r.id),[2]);
  assert.deepEqual(filterTransactions(rows,{search:'100.15',type:'ALL',tag:''}).map(r=>r.id),[1]);
  assert.equal(rows.length,2);
});
