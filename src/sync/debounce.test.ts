import { test } from 'node:test';
import assert from 'node:assert';
import { createDebouncer } from './debounce';

// Manual fake clock + scheduler.
function harness() {
  let t = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let id = 0;
  const now = () => t;
  const schedule = (ms: number, fn: () => void) => { const i = ++id; timers.set(i, { at: t + ms, fn }); return i as any; };
  const cancel = (i: any) => { timers.delete(i); };
  const advance = (ms: number) => {
    t += ms;
    for (const [i, e] of [...timers]) if (e.at <= t) { timers.delete(i); e.fn(); }
  };
  return { now, schedule, cancel, advance };
}

test('fires once after the quiet window when writes settle', () => {
  const h = harness();
  let fired = 0;
  const d = createDebouncer({ delayMs: 3000, maxWaitMs: 30000, now: h.now, schedule: h.schedule, cancel: h.cancel }, () => { fired++; });
  d.bump(); h.advance(1000); d.bump(); h.advance(1000); d.bump(); // resets each time
  assert.equal(fired, 0);
  h.advance(3000); // 3s of quiet
  assert.equal(fired, 1);
});

test('fires at the ceiling even under a continuous stream', () => {
  const h = harness();
  let fired = 0;
  const d = createDebouncer({ delayMs: 3000, maxWaitMs: 30000, now: h.now, schedule: h.schedule, cancel: h.cancel }, () => { fired++; });
  for (let i = 0; i < 60; i++) { d.bump(); h.advance(1000); } // a bump every 1s for 60s
  assert.ok(fired >= 2, `expected >=2 ceiling flushes, got ${fired}`);
});
