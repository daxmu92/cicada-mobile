import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeMigratedDb} from '../sync/test-support/sqlite';
import {serializeDatabase} from './serialized-db';
test('unrelated writes wait for commit and are not rolled back with a failed transaction',async()=>{
 const h=await makeMigratedDb();const db=serializeDatabase(h.db);let release!:()=>void;
 const transaction=db.withTransactionAsync(async tx=>{
  await tx.runAsync("INSERT INTO account(name) VALUES('temporary')");
  await new Promise<void>(r=>release=r);throw Error('failure');
 });
 await new Promise<void>(resolve=>setImmediate(resolve));
 const write=db.runAsync("INSERT INTO account(name) VALUES('outside')");
 release();await assert.rejects(()=>transaction,/failure/);await write;
 assert.deepEqual(await db.getAllAsync('SELECT name FROM account'),[{name:'outside'}]);
 h.raw.close();
});
