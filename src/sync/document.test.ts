import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument, serializeDocument, type SyncDocument } from './document';

function sampleDoc(): SyncDocument {
  return {
    syncFormatVersion: 1,
    enc: 'none',
    schemaVersion: 2,
    generatedAt: '2026-06-20T00:00:00.000Z',
    generatedBy: 'a1b2c3',
    tables: {
      account: [{ uuid: 'acc-1', name: 'Bank', archived: 0, updated_at: '000000000000100-00000-a1b2c3' }],
      asset: [{ uuid: 'as-1', accountUuid: 'acc-1', name: 'Savings', categories: '{}', archived: 0, updated_at: '000000000000100-00001-a1b2c3' }],
      snapshot: [{ assetUuid: 'as-1', date: '2026-06', netWorth: 100, inflow: 0, profit: 0, updated_at: '000000000000100-00002-a1b2c3' }],
      tran: [{ uuid: 'tr-1', date: '2026-06-01', type: 'INCOME', value: 50, cat: '', note: '', updated_at: '000000000000100-00003-a1b2c3' }],
      setting: [{ key: 'currency', value: '$', updated_at: '000000000000100-00004-a1b2c3' }],
    },
    tombstones: [{ entity: 'tran', uuid: 'tr-old', deleted_at: '000000000000099-00000-a1b2c3' }],
  };
}

test('serializeDocument -> parseDocument round-trips', () => {
  const doc = sampleDoc();
  const back = parseDocument(serializeDocument(doc));
  assert.deepEqual(back, doc);
});

test('parseDocument rejects non-JSON', () => {
  assert.throws(() => parseDocument('{not json'), /valid JSON/);
});

test('parseDocument rejects wrong syncFormatVersion', () => {
  const doc = { ...sampleDoc(), syncFormatVersion: 2 };
  assert.throws(() => parseDocument(JSON.stringify(doc)), /syncFormatVersion/);
});

test('parseDocument rejects a missing table', () => {
  const doc: any = sampleDoc();
  delete doc.tables.tran;
  assert.throws(() => parseDocument(JSON.stringify(doc)), /tables\.tran/);
});

test('parseDocument rejects a non-array table', () => {
  const doc: any = sampleDoc();
  doc.tables.account = {};
  assert.throws(() => parseDocument(JSON.stringify(doc)), /tables\.account/);
});

test('parseDocument rejects missing tombstones array', () => {
  const doc: any = sampleDoc();
  delete doc.tombstones;
  assert.throws(() => parseDocument(JSON.stringify(doc)), /tombstones/);
});
