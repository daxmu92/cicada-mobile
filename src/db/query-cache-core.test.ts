import test from 'node:test';
import assert from 'node:assert/strict';
import {createQueryCache} from './query-cache-core';
test('reads deduplicate, reuse data and invalidate on financial revision or ledger switch',async()=>{
 let token='live:0';let calls=0;const read=createQueryCache(()=>token);
 let finish!:(rows:number[])=>void;
 const load=()=>{calls++;return new Promise<number[]>(r=>{finish=r;});};
 const a=read(['month','2026-10',false],load);const b=read(['month','2026-10',false],load);assert.equal(a,b);finish([1]);await a;
 assert.deepEqual(await read(['month','2026-10',false],load),[1]);assert.equal(calls,1);
 token='demo:0';const c=read(['month','2026-10',false],load);finish([2]);await c;assert.equal(calls,2);
 token='live:1';const d=read(['month','2026-10',false],load);finish([3]);await d;assert.equal(calls,3);
 const option=read(['month','2026-10',true],load);finish([4]);await option;assert.equal(calls,4);
});
test('failed reads retry and old pending ledger results never replace a new ledger cache',async()=>{
 let token='live';const read=createQueryCache(()=>token);
 await assert.rejects(read(['assets'],async()=>{throw new Error('offline');}));
 assert.deepEqual(await read(['assets'],async()=>[1]),[1]);
 let finish!:(v:number[])=>void;const old=read(['pending'],()=>new Promise<number[]>(r=>{finish=r;}));
 token='demo';assert.deepEqual(await read(['pending'],async()=>[2]),[2]);finish([99]);await old;
 assert.deepEqual(await read(['pending'],async()=>[3]),[2]);
});
