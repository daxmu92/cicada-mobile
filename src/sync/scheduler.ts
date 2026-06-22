import { createDebouncer } from './debounce';

export type SyncReason = 'launch' | 'write' | 'periodic' | 'lifecycle' | 'manual';
export type SchedulerDeps = {
  execute: (mode: 'full' | 'conditional') => Promise<void>;
  now: () => number;
  schedule: (ms: number, fn: () => void) => unknown;
  cancel: (t: unknown) => void;
  debounceMs: number;
  ceilingMs: number;
  periodicMs: number;
};
export type Scheduler = {
  markDirty(): void;
  requestSync(reason: SyncReason): Promise<void>;
  start(): void;
  stop(): void;
  isDirty(): boolean;
};

export function createScheduler(deps: SchedulerDeps): Scheduler {
  let dirty = false;
  let inFlight = false;
  let pending: SyncReason | null = null;
  let periodicTimer: unknown = null;

  const debouncer = createDebouncer(
    { delayMs: deps.debounceMs, maxWaitMs: deps.ceilingMs, now: deps.now, schedule: deps.schedule, cancel: deps.cancel },
    () => { void requestSync('write'); }
  );

  async function run(reason: SyncReason): Promise<void> {
    if (inFlight) { pending = reason; return; }
    inFlight = true;
    const mode: 'full' | 'conditional' =
      reason === 'launch' || reason === 'manual' || dirty ? 'full' : 'conditional';
    try {
      await deps.execute(mode);
      if (mode === 'full') dirty = false;
    } catch {
      // errors are surfaced by `execute` itself (status/lastError); never throw
    } finally {
      inFlight = false;
      if (pending !== null) { const r = pending; pending = null; await run(r); }
    }
  }

  function requestSync(reason: SyncReason): Promise<void> { return run(reason); }

  function startPeriodic(): void {
    const tick = () => { periodicTimer = deps.schedule(deps.periodicMs, tick); void requestSync('periodic'); };
    periodicTimer = deps.schedule(deps.periodicMs, tick);
  }

  return {
    markDirty() { dirty = true; debouncer.bump(); },
    requestSync,
    start() { if (periodicTimer === null) startPeriodic(); },
    stop() { debouncer.cancel(); if (periodicTimer !== null) { deps.cancel(periodicTimer); periodicTimer = null; } },
    isDirty() { return dirty; },
  };
}

// ---------------------------------------------------------------------------
// Production singleton
// ---------------------------------------------------------------------------

export type SyncSnapshot = {
  status: 'idle' | 'syncing' | 'ok' | 'offline' | 'authError' | 'error';
  lastError: string | null;
};

let snapshot: SyncSnapshot = { status: 'idle', lastError: null };
const subscribers = new Set<(s: SyncSnapshot) => void>();
function setSnapshot(s: SyncSnapshot) { snapshot = s; subscribers.forEach((cb) => cb(s)); }

function classify(e: unknown): SyncSnapshot {
  // AuthError/offline classification mirrors the old SyncContext.classify.
  const name = (e as { name?: string })?.name;
  if (name === 'AuthError') return { status: 'authError', lastError: (e as Error).message };
  if (e instanceof TypeError) return { status: 'offline', lastError: 'network unavailable' };
  const message = e instanceof Error ? e.message : String(e);
  return { status: 'error', lastError: message };
}

export const syncScheduler: Scheduler & {
  subscribe(cb: (s: SyncSnapshot) => void): () => void;
  getSnapshot(): SyncSnapshot;
} = (() => {
  const base = createScheduler({
    execute: async (mode) => {
      setSnapshot({ status: 'syncing', lastError: null });
      try {
        const { syncOnce } = await import('./sync');
        await syncOnce(mode);
        setSnapshot({ status: 'ok', lastError: null });
      } catch (e) {
        setSnapshot(classify(e));
        // swallow: scheduler must not throw (best-effort flushes call this)
      }
    },
    now: () => Date.now(),
    schedule: (ms, fn) => setTimeout(fn, ms),
    cancel: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
    debounceMs: 2500,
    ceilingMs: 15000,
    periodicMs: 300000,
  });
  return {
    ...base,
    subscribe(cb) { subscribers.add(cb); return () => subscribers.delete(cb); },
    getSnapshot() { return snapshot; },
  };
})();
