import { test } from 'node:test';
import assert from 'node:assert';
import {
  ACCOUNT_DIMENSION,
  compositionDimensions,
  compositionSlices,
  type CompositionInput,
} from './composition';

const LBL = { uncategorized: 'Uncat', others: 'Others' };

const sample: CompositionInput[] = [
  { assetId: 1, accountName: 'Bank', categories: { Risk: 'Low', Type: 'Cash' }, netWorth: 100 },
  { assetId: 2, accountName: 'Bank', categories: { Risk: 'Low', Type: 'Bond' }, netWorth: 50 },
  { assetId: 3, accountName: 'Broker', categories: { Risk: 'High' }, netWorth: 200 },
  { assetId: 4, accountName: 'Broker', categories: {}, netWorth: 30 },
];

test('dimensions: account first, then sorted category keys present', () => {
  assert.deepEqual(compositionDimensions(sample), [ACCOUNT_DIMENSION, 'Risk', 'Type']);
});

test('group by account sums net worth and sorts desc', () => {
  const r = compositionSlices(sample, ACCOUNT_DIMENSION, LBL);
  assert.deepEqual(r.slices.map((s) => [s.label, s.value]), [['Broker', 230], ['Bank', 150]]);
  assert.equal(r.chartedTotal, 380);
  assert.equal(r.trueTotal, 380);
  assert.equal(r.excludedCount, 0);
});

test('group by category with missing key falls into uncategorized', () => {
  const r = compositionSlices(sample, 'Type', LBL);
  const byLabel = Object.fromEntries(r.slices.map((s) => [s.label, s.value]));
  assert.equal(byLabel['Cash'], 100);
  assert.equal(byLabel['Bond'], 50);
  assert.equal(byLabel['Uncat'], 230); // assets 3 and 4 lack "Type"
});

test('net-negative buckets are excluded; trueTotal keeps them', () => {
  const items: CompositionInput[] = [
    { assetId: 1, accountName: 'Bank', categories: {}, netWorth: 100 },
    { assetId: 2, accountName: 'Loan', categories: {}, netWorth: -40 },
  ];
  const r = compositionSlices(items, ACCOUNT_DIMENSION, LBL);
  assert.deepEqual(r.slices.map((s) => s.label), ['Bank']);
  assert.equal(r.chartedTotal, 100);
  assert.equal(r.trueTotal, 60);
  assert.equal(r.excludedCount, 1);
});

test('caps to 8 slices with an others bucket', () => {
  const items: CompositionInput[] = Array.from({ length: 10 }, (_, i) => ({
    assetId: i,
    accountName: `A${String(i).padStart(2, '0')}`,
    categories: {},
    netWorth: 100 - i, // descending 100..91
  }));
  const r = compositionSlices(items, ACCOUNT_DIMENSION, LBL);
  assert.equal(r.slices.length, 8);
  assert.equal(r.slices[7].label, 'Others');
  // others = sum of the 3 smallest (93+92+91)
  assert.equal(r.slices[7].value, 276);
  assert.equal(r.chartedTotal, items.reduce((s, x) => s + x.netWorth, 0));
});
