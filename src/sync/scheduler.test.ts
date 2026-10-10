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
  await Promise.resolve(); release(); await p1; await p2;
  assert.equal(modes.length, 2, 'one in-flight + one pending re-run');
});

test('a failed upload keeps local changes dirty and retry uses full sync', async () => {
  const h = harness(); const modes: string[] = [];
  const s = createScheduler({ execute: async mode => { modes.push(mode); if (modes.length === 1) throw Error('offline'); }, now: h.now, schedule: h.schedule, cancel: h.cancel, debounceMs: 2500, ceilingMs: 15000, periodicMs: 300000 });
  s.markDirty(); await s.requestSync('manual');
  assert.equal(s.isDirty(), true);
  await s.requestSync('periodic'); assert.deepEqual(modes, ['full', 'full']); assert.equal(s.isDirty(), false);
});
test('an edit during upload remains dirty and receives a second full sync', async () => {
  const h = harness(); const modes: string[] = []; let release!: () => void;
  const s = createScheduler({ execute: async mode => { modes.push(mode); if (modes.length === 1) await new Promise<void>(r => { release = r; }); }, now: h.now, schedule: h.schedule, cancel: h.cancel, debounceMs: 2500, ceilingMs: 15000, periodicMs: 300000 });
  const first = s.requestSync('manual');
  await Promise.resolve(); await Promise.resolve();
  s.markDirty(); release(); await first; assert.equal(s.isDirty(), true);
  await s.requestSync('periodic'); assert.deepEqual(modes, ['full', 'full']);
});
test('a queued request waits for its own completed sync', async () => {
  const h = harness(); let release!: () => void; let calls = 0; let returned = false;
  const s = createScheduler({ execute: async () => { if (++calls === 1) await new Promise<void>(r => { release = r; }); }, now: h.now, schedule: h.schedule, cancel: h.cancel, debounceMs: 2500, ceilingMs: 15000, periodicMs: 300000 });
  const first = s.requestSync('manual'); await Promise.resolve(); await Promise.resolve();
  const second = s.requestSync('manual').then(() => { returned = true; });
  await Promise.resolve(); assert.equal(returned, false); release(); await first; await second; assert.equal(calls, 2);
});
test('maintenance blocks background sync, and its flush does not deadlock', async () => {
  const h = harness(); const events: string[] = []; let release!: () => void;
  const s = createScheduler({ execute: async () => { events.push('sync'); }, now: h.now, schedule: h.schedule, cancel: h.cancel, debounceMs: 2500, ceilingMs: 15000, periodicMs: 300000 });
  const maintenance = s.runExclusive(async flush => { events.push('maintenance'); await new Promise<void>(r => { release = r; }); await flush(); events.push('commit'); });
  await Promise.resolve(); const sync = s.requestSync('periodic'); await Promise.resolve(); assert.deepEqual(events, ['maintenance']);
  release(); await maintenance; await sync; assert.deepEqual(events, ['maintenance', 'sync', 'commit', 'sync']);
});
