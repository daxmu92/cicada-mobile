import { createDebouncer } from './debounce';
import { createAsyncLock } from '../utils/async-lock';

export type SyncReason = 'launch' | 'write' | 'periodic' | 'lifecycle' | 'manual';
export type SchedulerDeps = {
  execute: (mode: 'full' | 'conditional') => Promise<void | boolean>;
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
  runExclusive<T>(task: (sync: () => Promise<void>) => Promise<T>): Promise<T>;
};

export function createScheduler(deps: SchedulerDeps): Scheduler {
  let revision = 0;
  let uploadedRevision = 0;
  let inFlight: Promise<void> | null = null;
  let pending: SyncReason | null = null;
  let waiters: (() => void)[] = [];
  let periodicTimer: unknown = null;
  const lock = createAsyncLock();
  const isDirty = () => revision !== uploadedRevision;
  const debouncer = createDebouncer(
    { delayMs: deps.debounceMs, maxWaitMs: deps.ceilingMs, now: deps.now, schedule: deps.schedule, cancel: deps.cancel },
    () => { void requestSync('write'); }
  );

  async function execute(mode: 'full' | 'conditional') {
    const capturedRevision = revision;
    const completed = await deps.execute(mode);
    if (completed !== false && mode === 'full') uploadedRevision = capturedRevision;
  }

  function requestSync(reason: SyncReason): Promise<void> {
    if (inFlight) {
      // Preserve a full-sync reason when a later clean periodic trigger arrives.
      if (pending === null || reason === 'manual' || reason === 'launch' || reason === 'write') pending = reason;
      return new Promise<void>((resolve) => waiters.push(resolve));
    }
    inFlight = (async () => {
      try {
        let current = reason;
        let completing: (() => void)[] = [];
        for (;;) {
          try {
            await lock.run(() => execute(
              current === 'launch' || current === 'manual' || current === 'write' || isDirty() ? 'full' : 'conditional'
            ));
          } catch {
            // Production execute reports the error. Failed writes remain dirty.
          }
          completing.forEach((resolve) => resolve());
          if (pending === null) break;
          current = pending;
          pending = null;
          completing = waiters;
          waiters = [];
        }
      } finally { inFlight = null; }
    })();
    return inFlight;
  }

  function startPeriodic(): void {
    const tick = () => { periodicTimer = deps.schedule(deps.periodicMs, tick); void requestSync('periodic'); };
    periodicTimer = deps.schedule(deps.periodicMs, tick);
  }

  return {
    markDirty() { revision++; debouncer.bump(); },
    requestSync,
    start() { if (periodicTimer === null) startPeriodic(); },
    stop() { debouncer.cancel(); if (periodicTimer !== null) { deps.cancel(periodicTimer); periodicTimer = null; } },
    isDirty,
    runExclusive: (task) => lock.run(() => task(() => execute('full'))),
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
        const result = await syncOnce(mode);
        if (result === null) { setSnapshot({ status: 'idle', lastError: null }); return false; }
        setSnapshot({ status: 'ok', lastError: null });
        return true;
      } catch (e) {
        setSnapshot(classify(e));
        throw e; // The scheduler must know this write was not acknowledged.
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
