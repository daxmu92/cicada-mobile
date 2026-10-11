import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createScheduler } from '../sync/scheduler';
import { createLedgerMaintenance } from './maintenance-core';
import { makeMigratedDb } from '../sync/test-support/sqlite';
import type { LedgerMode } from './mode';
test('a queued demo task cannot mutate the live ledger after a queued switch',async()=>{
  const live=await makeMigratedDb(); const demo=await makeMigratedDb(); let mode:LedgerMode='demo';
  const scheduler=createScheduler({execute:async()=>{},now:Date.now,schedule:()=>0,cancel:()=>{},debounceMs:1,ceilingMs:1,periodicMs:1});
  const gate=createLedgerMaintenance({runExclusive:scheduler.runExclusive,getMode:()=>mode,getDatabase:async()=>mode==='live'?live.db:demo.db});
  let release!:()=>void; const blocked=new Promise<void>(resolve=>{release=resolve;});
  const first=scheduler.runExclusive(async()=>{await blocked;});
  const switching=scheduler.runExclusive(async()=>{mode='live';});
  let ran=false;
  const resetting=gate('demo',async db=>{ran=true;await db.runAsync('DELETE FROM account');});
  const rejected=assert.rejects(resetting,/LEDGER_CHANGED/);
  release();await Promise.all([first,switching,rejected]);assert.equal(ran,false);
});
