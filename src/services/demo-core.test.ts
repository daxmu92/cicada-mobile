import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeMigratedDb} from '../sync/test-support/sqlite';
import {prepareDemo} from './demo-core';
test('demo initialization carries preferences; missing preferences restore defaults and erasing does not re-seed',async()=>{
  const {db}=await makeMigratedDb();await prepareDemo(db,{language:'zh',currency:'¥',theme:'nordic'});
  assert.equal((await db.getFirstAsync<{n:number}>('SELECT COUNT(*) AS n FROM asset_snapshot'))?.n,144);
  assert.equal((await db.getFirstAsync<{value:string}>('SELECT value FROM setting WHERE key=?',['language']))?.value,'zh');
  await prepareDemo(db,{language:'en'});
  assert.equal(await db.getFirstAsync('SELECT value FROM setting WHERE key=?',['currency']),null);
  await db.runAsync('DELETE FROM tran');await db.runAsync('DELETE FROM account');
  await prepareDemo(db,{language:'en'});
  assert.equal((await db.getFirstAsync<{n:number}>('SELECT COUNT(*) AS n FROM account'))?.n,0);
});
