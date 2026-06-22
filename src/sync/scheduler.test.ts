import { test } from 'node:test';
import assert from 'node:assert';
import { createScheduler } from './scheduler';

function harness() {
  let t = 0; const timers = new Map<number, { at: number; fn: () => void }>(); let id = 0;
  return {
    now: () => t,
    schedule: (ms: number, fn: () => void) => { const i = ++id; timers.set(i, { at: t + ms, fn }); return i; },
    cancel: (i: any) => { timers.delete(i); },
    advance: (ms: number) => { t += ms; for (const [i, e] of [...timers]) if (e.at <= t) { timers.delete(i); e.fn(); } },
  };
}

test('markDirty triggers one full sync after the debounce window', async () => {
  const h = harness(); const modes: string[] = [];
  const s = createScheduler({ execute: async (m) => { modes.push(m); }, now: h.now, schedule: h.schedule, cancel: h.cancel, debounceMs: 2500, ceilingMs: 15000, periodicMs: 300000 });
  s.markDirty(); h.advance(2500); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(modes, ['full']);
  assert.equal(s.isDirty(), false); // cleared after a successful full sync
});

test('periodic sync is conditional when clean', async () => {
  const h = harness(); const modes: string[] = [];
  const s = createScheduler({ execute: async (m) => { modes.push(m); }, now: h.now, schedule: h.schedule, cancel: h.cancel, debounceMs: 2500, ceilingMs: 15000, periodicMs: 300000 });
  s.start(); h.advance(300000); await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(modes, ['conditional']);
});

test('launch forces a full sync even when clean', async () => {
  const h = harness(); const modes: string[] = [];
  const s = createScheduler({ execute: async (m) => { modes.push(m); }, now: h.now, schedule: h.schedule, cancel: h.cancel, debounceMs: 2500, ceilingMs: 15000, periodicMs: 300000 });
  await s.requestSync('launch');
  assert.deepEqual(modes, ['full']);
});

test('a request during an in-flight sync runs exactly once more', async () => {
  const h = harness(); const modes: string[] = []; let release!: () => void;
  const s = createScheduler({ execute: async (m) => { modes.push(m); if (modes.length === 1) await new Promise<void>(r => { release = r; }); }, now: h.now, schedule: h.schedule, cancel: h.cancel, debounceMs: 2500, ceilingMs: 15000, periodicMs: 300000 });
  const p1 = s.requestSync('manual');      // starts, blocks
  await Promise.resolve();
  const p2 = s.requestSync('periodic');    // in-flight -> pending
  release(); await p1; await p2;
  assert.equal(modes.length, 2, 'one in-flight + one pending re-run');
});
