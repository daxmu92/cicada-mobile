import test from 'node:test';
import assert from 'node:assert/strict';
import {makeMigratedDb} from '../sync/test-support/sqlite';
import {readLocalDraft,saveLocalDraft,removeLocalDraft,parseLocalDraft} from './local-draft-core';
import {buildDocument} from '../sync/document';
test('drafts persist across readers, stay isolated from other ledgers, and never enter sync documents',async()=>{
 const live=await makeMigratedDb(),demo=await makeMigratedDb();
 await saveLocalDraft(live.db,'transaction:new','new',{note:'Synthetic unsaved input'});
 assert.deepEqual((await readLocalDraft(live.db,'transaction:new'))!.value,{note:'Synthetic unsaved input'});
 assert.equal(await readLocalDraft(demo.db,'transaction:new'),null);
 const doc=await buildDocument(live.db,{generatedAt:'x',generatedBy:'test'});
 assert(!JSON.stringify(doc).includes('Synthetic unsaved input'));
 await removeLocalDraft(live.db,'transaction:new');assert.equal(await readLocalDraft(live.db,'transaction:new'),null);
 assert.throws(()=>parseLocalDraft('{"version":9}'));
});
test('financial commit and draft consumption roll back together when cleanup fails',async()=>{
 const {db}=await makeMigratedDb();
 await saveLocalDraft(db,'transaction:new','new',['OUTLAY','2026-10-10','10','','Synthetic']);
 await db.execAsync("CREATE TRIGGER block_cleanup BEFORE DELETE ON local_draft BEGIN SELECT RAISE(ABORT,'Synthetic cleanup failure'); END;");
 const {writeWithDraftConsumption}=await import('./local-draft-core');
 const write=(tx:typeof db)=>tx.runAsync("INSERT INTO tran(date,type,value,cat,note,uuid,updated_at) VALUES('2026-10-10','OUTLAY',10,'','Synthetic','test-id','000000000000001-00000-aaaaaa')");
 await assert.rejects(writeWithDraftConsumption(db,{key:'transaction:new'},write),/Synthetic cleanup failure/);
 assert.equal((await db.getFirstAsync<{n:number}>('SELECT COUNT(*) AS n FROM tran'))!.n,0);assert(await readLocalDraft(db,'transaction:new'));
 await db.execAsync('DROP TRIGGER block_cleanup');await writeWithDraftConsumption(db,{key:'transaction:new'},write);
 assert.equal((await db.getFirstAsync<{n:number}>('SELECT COUNT(*) AS n FROM tran'))!.n,1);assert.equal(await readLocalDraft(db,'transaction:new'),null);
});
test('a partial batch save consumes only the committed asset draft',async()=>{
 const {db}=await makeMigratedDb();const {writeWithDraftConsumption}=await import('./local-draft-core');
 await saveLocalDraft(db,'batch:2026-10','batch:2026-10',[{uuid:'a',draft:'first'},{uuid:'b',draft:'second'}]);
 await writeWithDraftConsumption(db,{key:'batch:2026-10',assetUuid:'a'},async()=>{});
 assert.deepEqual((await readLocalDraft(db,'batch:2026-10'))!.value,[{uuid:'b',draft:'second'}]);
});
