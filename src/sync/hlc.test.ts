import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeHlc,
  parseHlc,
  advanceLocal,
  compareHlc,
  HLC_COUNTER_MAX,
} from './hlc';

test('encodeHlc pads to frozen fixed widths', () => {
  assert.equal(encodeHlc(1, 0, 'a1b2c3'), '000000000000001-00000-a1b2c3');
  assert.equal(encodeHlc(1717300000000, 3, 'a1b2c3'), '001717300000000-00003-a1b2c3');
});

test('parseHlc round-trips encodeHlc', () => {
  const ts = encodeHlc(1717300000000, 42, 'a1b2c3');
  assert.deepEqual(parseHlc(ts), { phys: 1717300000000, counter: 42, deviceId: 'a1b2c3' });
});

test('fixed widths make ordinal compare correct across a digit boundary', () => {
  // phys 9 must sort before phys 10 — only true because phys is zero-padded.
  const a = encodeHlc(9, 0, 'aaaaaa');
  const b = encodeHlc(10, 0, 'aaaaaa');
  assert.equal(compareHlc(a, b), -1);
  assert.equal(compareHlc(b, a), 1);
  assert.equal(compareHlc(a, a), 0);
});

test('compare breaks ties by counter then deviceId', () => {
  assert.equal(compareHlc(encodeHlc(5, 1, 'aaaaaa'), encodeHlc(5, 2, 'aaaaaa')), -1);
  assert.equal(compareHlc(encodeHlc(5, 2, 'aaaaaa'), encodeHlc(5, 2, 'bbbbbb')), -1);
});

test('advanceLocal increments counter when physical time has not moved', () => {
  assert.deepEqual(advanceLocal({ phys: 100, counter: 0 }, 100), { phys: 100, counter: 1 });
  assert.deepEqual(advanceLocal({ phys: 100, counter: 5 }, 50), { phys: 100, counter: 6 });
});

test('advanceLocal resets counter when physical time moves forward', () => {
  assert.deepEqual(advanceLocal({ phys: 100, counter: 9 }, 200), { phys: 200, counter: 0 });
});

test('advanceLocal rolls physical time on counter overflow', () => {
  assert.deepEqual(
    advanceLocal({ phys: 100, counter: HLC_COUNTER_MAX }, 100),
    { phys: 101, counter: 0 }
  );
});
