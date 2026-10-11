import { test } from 'node:test';
import assert from 'node:assert';
import { makeMigratedDb } from '../sync/test-support/sqlite';
import { buildBackupDoc, parseBackup, restoreBackupDoc, BACKUP_VERSION, maxBackupStamp,replaceBackupDoc } from './backup-core';
import { updateDatabaseClock } from '../sync/clock-core';
import { encodeHlc } from '../sync/hlc';
import { buildDocument } from '../sync/document';
import { merge } from '../sync/merge';
import { applyMerge } from '../sync/apply';

const STAMP = '000000000000123-00000-aaaaaa';

test('future backup clocks do not let an older imported tombstone erase a restored live row',async()=>{
  const {db}=await makeMigratedDb();
  const future=Date.now()+365*86400000;
  const doc=parseBackup(JSON.stringify({version:3,exportedAt:new Date().toISOString(),accounts:[],assets:[],snapshots:[],transactions:[{id:1,uuid:'future-row',updated_at:encodeHlc(future,1,'aaaaaa'),date:'2026-10-09',type:'INCOME',value:1,cat:'',note:''}],settings:[],tombstones:[{entity:'tran',uuid:'future-row',deleted_at:encodeHlc(future,0,'aaaaaa')}]}));
  await updateDatabaseClock(db,Date.now(),maxBackupStamp(doc)!);
  const deletedAt=await updateDatabaseClock(db,Date.now());const freshStamp=await updateDatabaseClock(db,Date.now());
  await replaceBackupDoc(db,doc,{deletedAt,freshStamp});
  const local=await buildDocument(db,{generatedBy:'test',generatedAt:new Date().toISOString()});
  await applyMerge(db,merge(local,local));
  assert.equal((await db.getFirstAsync<{value:number}>('SELECT value FROM tran WHERE uuid=?',['future-row']))?.value,1);
  assert.ok(freshStamp>maxBackupStamp(doc)!);
});

async function seed(db: any) {
  await db.runAsync('INSERT INTO account (id, name, archived, uuid, updated_at) VALUES (1, ?, 0, ?, ?)', ['Cash', 'acc-1', STAMP]);
  await db.runAsync('INSERT INTO asset (id, account_id, name, categories, archived, uuid, updated_at) VALUES (10, 1, ?, ?, 0, ?, ?)', ['Checking', '{}', 'as-10', STAMP]);
  await db.runAsync('INSERT INTO asset_snapshot (asset_id, date, net_worth, inflow, profit, updated_at) VALUES (10, ?, 100, 0, 0, ?)', ['2026-01', STAMP]);
  await db.runAsync('INSERT INTO tran (id, date, type, value, cat, note, uuid, updated_at) VALUES (1, ?, ?, 5, ?, ?, ?, ?)', ['2026-01-02', 'OUTLAY', 'food', '', 'tr-1', STAMP]);
  await db.runAsync('INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)', ['currency', '$', STAMP]);
  await db.runAsync('INSERT INTO tombstone (entity, uuid, deleted_at) VALUES (?, ?, ?)', ['tran', 'tr-deleted', STAMP]);
}

test('v3 build is version 3 and carries uuid/updated_at/tombstones', async () => {
  const { db } = await makeMigratedDb();
  await seed(db);
  const doc = await buildBackupDoc(db, '2026-06-21T00:00:00Z');
  assert.equal(doc.version, BACKUP_VERSION);
  assert.equal(doc.version, 3);
  assert.equal(doc.accounts[0].uuid, 'acc-1');
  assert.equal(doc.accounts[0].updated_at, STAMP);
  assert.equal(doc.tombstones!.length, 1);
  assert.equal(doc.tombstones![0].uuid, 'tr-deleted');
  const settings = doc.settings as import('./backup-core').BackupSettingV3[];
  assert.equal(settings[0].key, 'currency');
  assert.equal(settings[0].updated_at, STAMP);
});

test('v3 round-trip: build -> parse -> restore preserves sync identity', async () => {
  const { db: src } = await makeMigratedDb();
  await seed(src);
  const json = JSON.stringify(await buildBackupDoc(src, '2026-06-21T00:00:00Z'));

  const { db: dst } = await makeMigratedDb();
  const counts = await restoreBackupDoc(dst, parseBackup(json), { freshStamp: 'unused-for-v3' });
  assert.deepEqual(counts, { accounts: 1, assets: 1, snapshots: 1, transactions: 1 });
  const acc = await dst.getFirstAsync<{ uuid: string; updated_at: string }>('SELECT uuid, updated_at FROM account WHERE id = 1');
  assert.equal(acc!.uuid, 'acc-1');
  assert.equal(acc!.updated_at, STAMP);
  const tomb = await dst.getAllAsync<{ uuid: string }>('SELECT uuid FROM tombstone');
  assert.deepEqual(tomb.map((t) => t.uuid), ['tr-deleted']);
});

test('legacy v2 restore backfills non-NULL uuid/updated_at and restores no tombstones', async () => {
  const v2 = JSON.stringify({
    version: 2,
    exportedAt: '2026-01-01T00:00:00Z',
    accounts: [{ id: 1, name: 'Cash', archived: 0 }],
    assets: [{ id: 10, accountId: 1, name: 'Checking', categories: '{}', archived: 0 }],
    snapshots: [{ assetId: 10, date: '2026-01', netWorth: 100, inflow: 0, profit: 0 }],
    transactions: [{ id: 1, date: '2026-01-02', type: 'OUTLAY', value: 5, cat: 'food', note: '' }],
    settings: { currency: '$' },
  });
  const { db } = await makeMigratedDb();
  await restoreBackupDoc(db, parseBackup(v2), { freshStamp: STAMP });
  const acc = await db.getFirstAsync<{ uuid: string; updated_at: string }>('SELECT uuid, updated_at FROM account WHERE id = 1');
  assert.ok(acc!.uuid && acc!.uuid.length === 32, 'fresh uuid backfilled');
  assert.equal(acc!.updated_at, STAMP);
  const tran = await db.getFirstAsync<{ uuid: string }>('SELECT uuid FROM tran WHERE id = 1');
  assert.ok(tran!.uuid && tran!.uuid.length === 32, 'fresh tran uuid backfilled');
  const tomb = await db.getAllAsync('SELECT * FROM tombstone');
  assert.equal(tomb.length, 0);
});

test('parseBackup rejects version > 3', () => {
  assert.throws(() => parseBackup(JSON.stringify({ version: 4, accounts: [], assets: [], snapshots: [], transactions: [] })));
});

test('restoreBackupDoc with restamp forces freshStamp on all updated_at', async () => {
  const { db } = await makeMigratedDb();
  const parsed = {
    version: 3,
    exportedAt: 'x',
    accounts: [{ id: 1, name: 'Bank', archived: 0, uuid: 'acc-1', updated_at: '000000000000005-00000-bbbbbb' }],
    assets: [],
    snapshots: [],
    transactions: [],
    settings: [{ key: 'currency', value: '€', updated_at: '000000000000005-00000-bbbbbb' }],
    tombstones: [],
  };
  const fresh = '000000000000999-00000-aaaaaa';
  await restoreBackupDoc(db, parsed as any, { freshStamp: fresh, restamp: true });
  const acc = await db.getFirstAsync<{ updated_at: string }>("SELECT updated_at FROM account WHERE uuid='acc-1'");
  const setting = await db.getFirstAsync<{ updated_at: string }>("SELECT updated_at FROM setting WHERE key='currency'");
  assert.equal(acc!.updated_at, fresh);
  assert.equal(setting!.updated_at, fresh);
});

test('invalid backup is rejected before any existing financial data is erased', async () => {
  const { replaceBackupDoc } = await import('./backup-core');
  const { db } = await makeMigratedDb(); await seed(db);
  const invalid = { version: 3, accounts: [{ id: 2 }], assets: [], snapshots: [], transactions: [] };
  assert.throws(() => parseBackup(JSON.stringify(invalid)), /name/);
  await assert.rejects(() => replaceBackupDoc(db, invalid as any, { deletedAt: STAMP, freshStamp: STAMP }));
  assert.equal((await db.getAllAsync('SELECT * FROM account')).length, 1);
  assert.equal((await db.getAllAsync('SELECT * FROM asset_snapshot')).length, 1);
});
test('a failed replacement rolls back deletes, partial inserts and tombstones', async () => {
  const { replaceBackupDoc, latestRecoveryBackup } = await import('./backup-core');
  const { db } = await makeMigratedDb(); await seed(db);
  const before = await buildBackupDoc(db, 'x');
  await db.execAsync("CREATE TRIGGER fail_restore BEFORE INSERT ON asset_snapshot BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END;");
  await assert.rejects(() => replaceBackupDoc(db, before, { deletedAt: '000000000000124-00000-aaaaaa', freshStamp: '000000000000125-00000-aaaaaa' }), /disk failure/);
  assert.equal((await db.getFirstAsync<{ net_worth: number }>('SELECT net_worth FROM asset_snapshot'))!.net_worth, 100);
  assert.equal((await db.getAllAsync('SELECT * FROM tombstone')).length, 1);
  assert.ok(await latestRecoveryBackup(db));
});
test('backup validation catches dangling ids, duplicates and invalid dates', () => {
  const valid = { version: 2, accounts: [{id: 1, name: 'Bank'}], assets: [{id: 1, accountId: 1, name: 'Fund', categories: '{}'}], snapshots: [], transactions: [], settings: {} };
  assert.throws(() => parseBackup(JSON.stringify({...valid, assets: [{...valid.assets[0], accountId: 2}]})), /missing account/);
  assert.throws(() => parseBackup(JSON.stringify({...valid, accounts: [...valid.accounts, ...valid.accounts]})), /duplicate/);
  assert.throws(() => parseBackup(JSON.stringify({...valid, transactions: [{id:1,date:'2026-02-30',type:'OUTLAY',value:1}]})), /date/);
});

for (const version of [1, 2]) {
  test(`v${version} replacement stamps imported settings above cloud values`, async () => {
    const { db } = await makeMigratedDb();
    await seed(db);
    const freshStamp = '000000000000200-00000-aaaaaa';
    const { replaceBackupDoc } = await import('./backup-core');
    await replaceBackupDoc(db, parseBackup(JSON.stringify({version,exportedAt:'2026-01-01T00:00:00Z',accounts:[],assets:[],snapshots:[],transactions:[],settings:{currency:'¥'}})), {deletedAt:STAMP,freshStamp});
    assert.deepEqual(await db.getFirstAsync('SELECT value,updated_at FROM setting WHERE key=?',['currency']),{value:'¥',updated_at:freshStamp});
    const { applyMerge } = await import('../sync/apply');
    await applyMerge(db,{tables:{account:[],asset:[],snapshot:[],tran:[],setting:[{key:'currency',value:'$',updated_at:'000000000000150-00000-bbbbbb'}]},tombstones:[]});
    assert.equal((await db.getFirstAsync<{value:string}>('SELECT value FROM setting WHERE key=?',['currency']))?.value,'¥');
  });
}
