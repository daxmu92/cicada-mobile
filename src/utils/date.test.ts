import { test } from 'node:test';
import assert from 'node:assert';
import { minusMonths } from './date';

test('minusMonths subtracts within a year', () => {
  assert.equal(minusMonths('2026-06', 3), '2026-03');
});
test('minusMonths rolls over the year boundary', () => {
  assert.equal(minusMonths('2026-02', 3), '2025-11');
});
test('minusMonths with n=0 is identity', () => {
  assert.equal(minusMonths('2026-06', 0), '2026-06');
});
test('minusMonths 1Y window (11) and 3Y window (35)', () => {
  assert.equal(minusMonths('2026-06', 11), '2025-07');
  assert.equal(minusMonths('2026-06', 35), '2023-07');
});
