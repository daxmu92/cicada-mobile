import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount } from './money';
import { computeProfit, computeInflow } from './snapshot-calc';
test('amount grouping is parsed completely and invalid prefixes are rejected', () => {
  assert.equal(parseAmount('1,000.15'), 1000.15);
  for (const input of ['1,00', '100abc', 'Infinity', 'NaN', '0x10', '1.234', '']) assert.throws(() => parseAmount(input));
  assert.equal(parseAmount('', true), 0);
  assert.equal(parseAmount('-10.15'), -10.15);
});
test('automatic cash-flow calculations preserve cents and remove subtraction noise', () => {
  assert.equal(computeProfit(100.15, 100, 0), 0.15);
  assert.equal(computeInflow(100.15, 100, 0.05), 0.10);
  assert.equal(computeProfit(0.3, 0.2, 0.1), 0);
  assert.equal(computeProfit(99.85, 100, 0), -0.15);
});
