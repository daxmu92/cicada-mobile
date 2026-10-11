import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeMigratedDb} from './test-support/sqlite';
import {updateDatabaseClock} from './clock-core';
import {parseHlc} from './hlc';
test('clock writes remain bound to the database that owns the financial operation',async()=>{
  const live=await makeMigratedDb();const demo=await makeMigratedDb();
  await live.db.runAsync('UPDATE sync_state SET value=? WHERE key=?',['aaaaaa','deviceId']);
  await demo.db.runAsync('UPDATE sync_state SET value=? WHERE key=?',['bbbbbb','deviceId']);
  await live.db.runAsync('INSERT INTO sync_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',['hlc',JSON.stringify({phys:200,counter:0})]);
  await demo.db.runAsync('INSERT INTO sync_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',['hlc',JSON.stringify({phys:100,counter:0})]);
  assert.deepEqual(parseHlc(await updateDatabaseClock(live.db,50)),{phys:200,counter:1,deviceId:'aaaaaa'});
  assert.deepEqual(parseHlc(await updateDatabaseClock(demo.db,50)),{phys:100,counter:1,deviceId:'bbbbbb'});
});
