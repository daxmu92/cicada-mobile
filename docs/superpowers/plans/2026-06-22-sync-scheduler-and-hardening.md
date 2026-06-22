# Sync Scheduler & Desktop Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One sync coordinator (push-on-write debounced + ~5min periodic poll + launch/lifecycle triggers) that skips no-op work via conditional GET (304) and skip-identical-write, plus desktop build hardening (no service worker, fail-fast build).

**Architecture:** Extract sync coordination out of React into a testable module `src/sync/scheduler.ts` (debounce, periodic, in-flight/pending, dirty + mode decision) that both `SyncContext` and plain services use — killing the two-entry-point race. The engine (`runSync`) gains a conditional read and a skip-identical-write guard and persists the cloud ETag. The WebDAV provider gains a conditional `read`.

**Tech Stack:** TypeScript, Expo/React Native, expo-sqlite (+ better-sqlite3 in tests), WebDAV (坚果云, honors If-None-Match/304 and If-Match/412), `node --import tsx --test`.

## Global Constraints

- Node 20+. Verify each task: `npx tsc --noEmit` and `npm run lint` clean EXCEPT one pre-existing `array-type` warning in `src/db/snapshot-repo.ts` (~line 206).
- New `*.test.ts` files MUST be added to the `test` script in `package.json`.
- Tests run via `node --import tsx --test <file>`; logic a test drives must take INJECTED deps (timers/remote/state) — never the global `getDatabase()`/`tick()`/`Date.now()` directly in tested paths (mirror `runSync`'s deps and `createDebouncer`'s injected `now/schedule/cancel`).
- Timing constants (single source, tunable): debounce **2500 ms**, ceiling **15000 ms**, periodic **300000 ms** (5 min).
- ETag is stored in `sync_state` under key `cloud_etag`. `LAST_SYNCED_KEY='cloud_last_synced_at'`, `SYNC_IN_PROGRESS_KEY='sync_in_progress'` already exist in `sync.ts`.
- 坚果云 conditional GET: `If-None-Match: <etag>` → `304` unchanged, `200`+body changed, `404` absent. `If-Match` → `412`.
- Commit after each task; end commit messages with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

## File Structure

- `app/+html.tsx` (modify) — gate service-worker registration to web only; unregister on desktop.
- `scripts/build-windows.sh` (modify) — fail-fast if `tauri build` errors.
- `src/sync/providers/types.ts` (modify) — `read` gains optional `{ ifNoneMatch }` and a `'not-modified'` result.
- `src/sync/providers/webdav.ts` (modify) — conditional GET.
- `src/sync/providers/webdav.test.ts` (modify) — conditional-read tests.
- `src/sync/sync.ts` (modify) — conditional read, skip-identical-write, ETag persistence, `'unchanged'` outcome.
- `src/sync/sync.test.ts` (modify) — skip-identical + conditional tests; update `makeFakeRemote`.
- `src/sync/scheduler.ts` (create) — `createScheduler` (pure, injected deps) + `syncScheduler` singleton wired to production.
- `src/sync/scheduler.test.ts` (create) — scheduler logic with a fake clock.
- `src/hooks/SyncContext.tsx` (modify) — thin adapter over `syncScheduler` + DOM lifecycle triggers.
- `src/db/{account,asset,snapshot,tran}-repo.ts`, `src/db/setting-repo.ts` (modify) — `bumpDirty()` → `syncScheduler.markDirty()` (via `dirty.ts` shim, see Task 6).
- `src/services/erase-data.ts`, `src/services/backup.ts`, `src/services/sample-data.ts` (modify) — route sync through the scheduler instead of direct `syncNow()`.

---

## Task 1: Desktop build hardening (service worker + fail-fast)

Independent, no unit-test harness (config/script); verified by tsc/lint + reasoning. Land first — it unblocks reliable rebuilds.

**Files:**
- Modify: `app/+html.tsx`
- Modify: `scripts/build-windows.sh`

- [ ] **Step 1: Read `app/+html.tsx`** to find the existing service-worker registration block (`if ('serviceWorker' in navigator) { ... navigator.serviceWorker.register('/sw.js') ... }`).

- [ ] **Step 2: Gate SW registration to web; unregister on desktop**

Replace the registration block with:

```jsx
if ('serviceWorker' in navigator) {
  if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
    // Desktop (Tauri): assets are embedded in the app; a service worker only
    // serves a STALE bundle after a rebuild. Unregister any leftover SW so
    // existing desktop installs self-heal on next launch.
    navigator.serviceWorker.getRegistrations().then(function (rs) {
      rs.forEach(function (r) { r.unregister(); });
    }).catch(function () {});
  } else {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function (err) {
        console.warn('SW registration failed', err);
      });
    });
  }
}
```

(Keep the existing `Cache-Control: no-store` `<meta>` — do not remove it. Match the exact surrounding JSX/script style already in the file.)

- [ ] **Step 3: Make `build-windows.sh` fail-fast**

Read `scripts/build-windows.sh`. The `powershell.exe ... build-windows.ps1` (or the `npm run tauri:build` it invokes) can fail without aborting the script. Immediately after that build invocation, add an explicit guard so a failed build does NOT reach the "copy artifacts / Done" section:

```bash
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PS1_WIN" \
  -Branch "$BRANCH" -WslRemote "$WSL_UNC"
build_status=$?
if [ "$build_status" -ne 0 ]; then
  echo "ERROR: Windows build failed (exit $build_status). No artifacts produced." >&2
  exit "$build_status"
fi
```

Also have `build-windows.ps1` propagate the `tauri build` failure: confirm the PowerShell script exits non-zero when `tauri build` fails (e.g. `if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }` after the build call). Read `scripts/build-windows.ps1` and add that guard after the `npm run tauri:build` line if absent.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run lint` → clean (the `+html.tsx` change is plain JS in JSX; ensure no lint error). Script changes aren't type-checked. Manual build verification happens at the end of the plan.

- [ ] **Step 5: Commit**

```bash
git add app/+html.tsx scripts/build-windows.sh scripts/build-windows.ps1
git commit -m "fix(desktop): no service worker on Tauri + fail-fast Windows build

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Conditional read in the WebDAV provider

**Files:**
- Modify: `src/sync/providers/types.ts`
- Modify: `src/sync/providers/webdav.ts`
- Test: `src/sync/providers/webdav.test.ts`

**Interfaces:**
- Produces: `SyncRemote.read(opts?: { ifNoneMatch?: string }): Promise<{ content: string; etag: string | null } | 'not-modified' | null>`. `read()` with no args is unchanged behavior. `'not-modified'` only when `ifNoneMatch` is supplied and the server returns 304.

- [ ] **Step 1: Update the interface in `types.ts`**

Replace the `read` line in `interface SyncRemote`:

```ts
  read(opts?: { ifNoneMatch?: string }):
    Promise<{ content: string; etag: string | null } | 'not-modified' | null>; // null = absent (404); 'not-modified' = 304
```

- [ ] **Step 2: Write the failing provider test**

Read `src/sync/providers/webdav.test.ts` to match its existing harness (how it builds a fake `HttpClient` and asserts). Append tests that drive a fake `HttpClient`:

```ts
test('read() with ifNoneMatch sends If-None-Match and maps 304 to not-modified', async () => {
  let seenHeaders: Record<string, string> = {};
  const http: HttpClient = async (_url, init) => {
    seenHeaders = init.headers;
    return { status: 304, headers: { get: () => null }, text: async () => '' };
  };
  const remote = createWebDavRemote({ baseUrl: 'https://x/dav/', username: 'u', appPassword: 'p' }, http);
  const r = await remote.read({ ifNoneMatch: 'etag-123' });
  assert.equal(r, 'not-modified');
  assert.equal(seenHeaders['If-None-Match'], 'etag-123');
});

test('read() maps 200 to data and 404 to null', async () => {
  const make = (status: number, body: string, etag: string | null): HttpClient => async () => ({
    status, headers: { get: (n: string) => (n === 'ETag' ? etag : null) }, text: async () => body,
  });
  const cfg = { baseUrl: 'https://x/dav/', username: 'u', appPassword: 'p' };
  const got = await createWebDavRemote(cfg, make(200, '{"a":1}', 'e9'))!.read();
  assert.deepEqual(got, { content: '{"a":1}', etag: 'e9' });
  const absent = await createWebDavRemote(cfg, make(404, '', null)).read();
  assert.equal(absent, null);
});
```

(Import `HttpClient` from `./types` and `createWebDavRemote` from `./webdav` matching the file's existing imports.)

- [ ] **Step 3: Run to verify it fails**

Run: `node --import tsx --test src/sync/providers/webdav.test.ts`
Expected: FAIL — `read` ignores `ifNoneMatch` / no 304 handling.

- [ ] **Step 4: Implement conditional read in `webdav.ts`**

Replace the `read` method:

```ts
    async read(opts?: { ifNoneMatch?: string }): Promise<{ content: string; etag: string | null } | 'not-modified' | null> {
      const headers = authHeaders();
      if (opts?.ifNoneMatch) headers['If-None-Match'] = opts.ifNoneMatch;
      const res = await http(fileUrl, { method: 'GET', headers });
      if (res.status === 304) return 'not-modified';
      if (res.status === 404) return null;
      if (res.status === 401) throw new AuthError();
      if (!ok(res.status)) {
        throw new Error(`WebDAV read failed (HTTP ${res.status})`);
      }
      return { content: await res.text(), etag: res.headers.get('ETag') };
    },
```

- [ ] **Step 5: Run tests + typecheck/lint**

Run: `node --import tsx --test src/sync/providers/webdav.test.ts` → PASS.
Run: `npx tsc --noEmit` — this will surface that `sync.ts` and `sync.test.ts` callers must handle the new `'not-modified'` union member. That is fixed in Task 3; for THIS task, `tsc` may report those call sites. If so, add a minimal guard at the existing `sync.ts` `read()` call (`if (pulled === 'not-modified') pulled = null;` placeholder is NOT acceptable) — instead, leave Task 2 limited to provider+types and accept that `tsc` is green only after Task 3. To keep Task 2 independently green, also do Step 6.

- [ ] **Step 6: Keep callers compiling (minimal)**

In `src/sync/sync.ts`, at the two `await remote.read()` call sites (initial read and retry read), the result type now includes `'not-modified'`, but since these calls pass no `ifNoneMatch`, `'not-modified'` never occurs. Narrow it explicitly so tsc passes:

```ts
const pulledRaw = await remote.read();
const pulled = pulledRaw === 'not-modified' ? null : pulledRaw; // unconditional read never returns 'not-modified'
```

Apply at both `read()` sites in `runSync` (initial `let pulled = ...` and the retry `const re = ...`). Now `npx tsc --noEmit && npm run lint` → clean. (Task 3 replaces this with real conditional handling.)

- [ ] **Step 7: Add the test file is already in package.json?** `src/sync/providers/webdav.test.ts` is already listed in the `test` script — confirm; no change needed.

- [ ] **Step 8: Commit**

```bash
git add src/sync/providers/types.ts src/sync/providers/webdav.ts src/sync/providers/webdav.test.ts src/sync/sync.ts
git commit -m "feat(sync): conditional GET (If-None-Match/304) in WebDAV provider

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: runSync — conditional read, skip-identical-write, ETag persistence

**Files:**
- Modify: `src/sync/sync.ts`
- Modify: `src/sync/sync.test.ts`

**Interfaces:**
- Consumes: conditional `read` (Task 2).
- Produces:
  - `RunSyncDeps` gains `conditionalEtag?: string` (when set, the initial read uses `{ ifNoneMatch }`).
  - `SyncOutcome.status` gains `'unchanged'`.
  - `export const CLOUD_ETAG_KEY = 'cloud_etag';` — runSync persists the cloud ETag here whenever it learns one (after read and after write).

- [ ] **Step 1: Write failing tests** (append to `src/sync/sync.test.ts`)

First, extend `makeFakeRemote` to honor `ifNoneMatch` (edit the existing helper's `read`):

```ts
    read: async (opts?: { ifNoneMatch?: string }) => {
      if (content === null) return null;
      if (opts?.ifNoneMatch && opts.ifNoneMatch === etag()) return 'not-modified';
      return { content, etag: etag() };
    },
```

Then add:

```ts
test('runSync skips the write when the merged doc equals the cloud (no-op)', async () => {
  const { db } = await makeMigratedDb();
  await addAccount(db, 'acc-a', 'Cash', HLC(10, 'aaaaaa'));
  const remote = makeFakeRemote();
  await runSync(depsFor(db, remote, 'aaaaaa').deps); // seed -> cloud = {Cash}
  const before = remote._content();
  let writes = 0;
  const realWrite = remote.write.bind(remote);
  remote.write = async (c, pre) => { writes++; return realWrite(c, pre); };
  const out = await runSync(depsFor(db, remote, 'aaaaaa', 2_000_000).deps); // nothing changed
  assert.equal(out.status, 'unchanged');
  assert.equal(writes, 0, 'no PUT when content identical');
  assert.equal(remote._content(), before);
});

test('runSync with conditionalEtag returns unchanged on a 304 (no merge/write)', async () => {
  const { db } = await makeMigratedDb();
  await addAccount(db, 'acc-a', 'Cash', HLC(10, 'aaaaaa'));
  const remote = makeFakeRemote();
  await runSync(depsFor(db, remote, 'aaaaaa').deps); // seed; etag now v1
  const etag = 'v1';
  let writes = 0; const realWrite = remote.write.bind(remote);
  remote.write = async (c, p) => { writes++; return realWrite(c, p); };
  const { deps } = depsFor(db, remote, 'aaaaaa', 2_000_000);
  const out = await runSync({ ...deps, conditionalEtag: etag });
  assert.equal(out.status, 'unchanged');
  assert.equal(writes, 0);
});

test('runSync persists cloud_etag after a sync', async () => {
  const { db } = await makeMigratedDb();
  await addAccount(db, 'acc-a', 'Cash', HLC(10, 'aaaaaa'));
  const remote = makeFakeRemote();
  const { deps } = depsFor(db, remote, 'aaaaaa');
  await runSync(deps);
  assert.equal(await deps.getState('cloud_etag'), 'v1'); // seeded write -> etag v1
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test src/sync/sync.test.ts`
Expected: FAIL — no `'unchanged'` status, writes still happen, `cloud_etag` unset.

- [ ] **Step 3: Implement in `sync.ts`**

Add the key + extend deps/outcome:

```ts
export const CLOUD_ETAG_KEY = 'cloud_etag';
```

In `RunSyncDeps` add `conditionalEtag?: string;`. In `SyncOutcome` change to `status: 'seeded' | 'merged' | 'unchanged';`.

In `runSync`, replace the initial read + seed + merge/write region with conditional handling. Concretely:

```ts
  // Initial read — conditional when the caller knows local is clean.
  const firstRaw = await remote.read(deps.conditionalEtag ? { ifNoneMatch: deps.conditionalEtag } : undefined);
  if (firstRaw === 'not-modified') {
    const t = now();
    await setState(LAST_SYNCED_KEY, String(t));
    return { status: 'unchanged', suffixed: [] };
  }
  let pulled = firstRaw; // { content, etag } | null
```

Seed branch (when `pulled === null`) is unchanged EXCEPT after the seeding write, persist the etag:

```ts
      const seeded = await remote.write(serializeDocument(await buildLocal()), { kind: 'ifNoneMatch' });
      const t = now();
      await setState(LAST_SYNCED_KEY, String(t));
      if (seeded.etag) await setState(CLOUD_ETAG_KEY, seeded.etag);
      await gcTombstones(db, t);
      return { status: 'seeded', suffixed: [] };
```
(and in the create-conflict fallthrough, re-read with `const reRaw = await remote.read(); pulled = reRaw === 'not-modified' ? null : reRaw;` — unconditional, so never 'not-modified').

In the merge/write loop, after computing `outDoc` and `pre`, add the skip-identical guard BEFORE the write, and persist etag after a successful write:

```ts
    const outDoc = serializeDocument(await buildLocal());
    if (pulled.etag) await setState(CLOUD_ETAG_KEY, pulled.etag);

    if (outDoc === pulled.content) {
      // Cloud already holds exactly this — no upload needed.
      const t = now();
      await setState(LAST_SYNCED_KEY, String(t));
      await setState(SYNC_IN_PROGRESS_KEY, '0');
      await gcTombstones(db, t);
      return { status: 'unchanged', suffixed: applied.suffixed };
    }

    const pre: WritePrecondition = pulled.etag ? { kind: 'ifMatch', etag: pulled.etag } : { kind: 'none' };
    try {
      const written = await remote.write(outDoc, pre);
      const t = now();
      await setState(LAST_SYNCED_KEY, String(t));
      if (written.etag) await setState(CLOUD_ETAG_KEY, written.etag);
      await setState(SYNC_IN_PROGRESS_KEY, '0');
      await gcTombstones(db, t);
      return { status: 'merged', suffixed: applied.suffixed };
    } catch (e) { /* existing ConflictError retry, unchanged */ }
```

Replace the Task-2 placeholder narrowing at the retry read site with `const reRaw = await remote.read(); if (reRaw === 'not-modified') throw new Error('unexpected 304 on unconditional retry read'); pulled = reRaw; if (pulled === null) throw new Error('remote vanished during retry');`.

- [ ] **Step 4: Run tests**

Run: `node --import tsx --test src/sync/sync.test.ts` → PASS (existing + 3 new). Confirm the existing seed/merge/412-retry/convergence tests still pass.

- [ ] **Step 5: Typecheck/lint + commit**

Run: `npx tsc --noEmit && npm run lint` → clean.

```bash
git add src/sync/sync.ts src/sync/sync.test.ts
git commit -m "feat(sync): skip no-op syncs (conditional read + skip-identical write) + persist etag

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: createScheduler (pure, testable)

**Files:**
- Create: `src/sync/scheduler.ts`
- Test: `src/sync/scheduler.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type SyncReason = 'launch' | 'write' | 'periodic' | 'lifecycle' | 'manual';
  export type SchedulerDeps = {
    execute: (mode: 'full' | 'conditional') => Promise<void>; // one sync; throws on error
    now: () => number;
    schedule: (ms: number, fn: () => void) => unknown;
    cancel: (t: unknown) => void;
    debounceMs: number; ceilingMs: number; periodicMs: number;
  };
  export type Scheduler = {
    markDirty(): void;
    requestSync(reason: SyncReason): Promise<void>;
    start(): void;
    stop(): void;
    isDirty(): boolean;
  };
  export function createScheduler(deps: SchedulerDeps): Scheduler;
  ```
- Mode rule: `launch`/`manual`/dirty → `'full'`; otherwise `'conditional'`. A successful `'full'` clears dirty. `markDirty()` sets dirty and bumps the debouncer (which calls `requestSync('write')`). In-flight requests set a pending flag and run exactly once more after.

- [ ] **Step 1: Write failing tests** (`src/sync/scheduler.test.ts`)

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test src/sync/scheduler.test.ts`
Expected: FAIL — `./scheduler` not found.

- [ ] **Step 3: Implement `src/sync/scheduler.ts`**

```ts
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
```

- [ ] **Step 4: Run tests**

Run: `node --import tsx --test src/sync/scheduler.test.ts` → PASS (4 tests). Add `src/sync/scheduler.test.ts` to the `package.json` test script.

- [ ] **Step 5: Typecheck/lint + commit**

Run: `npx tsc --noEmit && npm run lint` → clean.

```bash
git add src/sync/scheduler.ts src/sync/scheduler.test.ts package.json
git commit -m "feat(sync): testable sync scheduler (debounce + periodic + in-flight/pending + mode)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Production scheduler singleton + execute wiring

**Files:**
- Modify: `src/sync/scheduler.ts` (add singleton + production `execute`)
- Modify: `src/sync/sync.ts` (add a `syncOnce(mode)` platform entry the singleton calls)

**Interfaces:**
- Consumes: `createScheduler` (Task 4), `runSync` + `CLOUD_ETAG_KEY` (Task 3).
- Produces:
  - In `sync.ts`: `export async function syncOnce(mode: 'full' | 'conditional'): Promise<SyncOutcome | null>` — like the current `syncNow`, but passes `conditionalEtag` (read from `CLOUD_ETAG_KEY`) when `mode === 'conditional'`. Returns null if unavailable/no creds.
  - In `scheduler.ts`: `export const syncScheduler: Scheduler` — singleton built with `createScheduler` using real timers (`setTimeout`/`clearTimeout`/`Date.now`), the Global Constraints timing consts, and `execute: (mode) => syncOnce(mode)` wrapped so errors set status (see Task 6 — for now `execute` calls `syncOnce` and rethrows; status handling is added when SyncContext subscribes). Also a status subscription hook:
    ```ts
    export type SyncSnapshot = { status: 'idle'|'syncing'|'ok'|'offline'|'authError'|'error'; lastError: string | null };
    syncScheduler.subscribe(cb: (s: SyncSnapshot) => void): () => void;
    syncScheduler.getSnapshot(): SyncSnapshot;
    ```

- [ ] **Step 1: Add `syncOnce` to `sync.ts`**

Mirror `syncNow` but thread the mode:

```ts
export async function syncOnce(mode: 'full' | 'conditional'): Promise<SyncOutcome | null> {
  const [{ isSyncAvailable }, { loadRemote }, { getDatabase }, { getDeviceId }, { getSyncState, setSyncState }, { receiveRemote: recv }] =
    await Promise.all([
      import('./available'), import('./remote'), import('../db/database'),
      import('./device'), import('./sync-state-repo'), import('./clock'),
    ]);
  if (!isSyncAvailable()) return null;
  const remote = await loadRemote();
  if (!remote) return null;
  const db = await getDatabase();
  const deviceId = await getDeviceId();
  const conditionalEtag = mode === 'conditional' ? (await getSyncState(CLOUD_ETAG_KEY)) ?? undefined : undefined;
  return runSync({
    db, remote, deviceId, now: () => Date.now(),
    getState: getSyncState, setState: setSyncState, receiveRemote: recv,
    conditionalEtag,
  });
}
```

Keep the existing `syncNow` (it can delegate: `export const syncNow = () => syncOnce('full');`) so nothing else breaks.

- [ ] **Step 2: Add the singleton + status to `scheduler.ts`**

Append (below `createScheduler`):

```ts
export type SyncSnapshot = { status: 'idle' | 'syncing' | 'ok' | 'offline' | 'authError' | 'error'; lastError: string | null };

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
    debounceMs: 2500, ceilingMs: 15000, periodicMs: 300000,
  });
  return {
    ...base,
    subscribe(cb) { subscribers.add(cb); return () => subscribers.delete(cb); },
    getSnapshot() { return snapshot; },
  };
})();
```

(Note: `import('./sync')` inside `execute` avoids a static `scheduler.ts → sync.ts → platform` graph in tests; `createScheduler` itself stays platform-free and unit-tested.)

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run lint` → clean.
Run: `node --import tsx --test src/sync/scheduler.test.ts src/sync/sync.test.ts` → PASS (the pure scheduler tests are unaffected; sync tests still green).

- [ ] **Step 4: Commit**

```bash
git add src/sync/scheduler.ts src/sync/sync.ts
git commit -m "feat(sync): production sync scheduler singleton + syncOnce(mode)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Wire SyncContext + repos + services to the scheduler

Integration task; no RN unit harness — verified by tsc/lint + the manual checklist (Task 7).

**Files:**
- Modify: `src/hooks/SyncContext.tsx`
- Modify: `src/sync/dirty.ts` (route to scheduler)
- Modify: `src/services/erase-data.ts`, `src/services/backup.ts`, `src/services/sample-data.ts`

**Interfaces:**
- Consumes: `syncScheduler` (Task 5).

- [ ] **Step 1: Point `dirty.ts` at the scheduler**

Repos already call `bumpDirty()`. Keep that name but route it to the scheduler so we don't touch every repo:

```ts
import { syncScheduler } from './scheduler';

/** A local mutation happened — ask the scheduler to push (debounced). */
export function bumpDirty(): void {
  syncScheduler.markDirty();
}
```

Remove the old listener-set implementation and `subscribeDirty` (grep first: only `SyncContext` imported `subscribeDirty` — it will stop after Step 2; if anything else imports it, keep a no-op export). Verify with `grep -rn "subscribeDirty" src/`.

- [ ] **Step 2: Rewrite `SyncContext.tsx` as a thin adapter**

Replace the body so it: on mount runs crash-recovery then `syncScheduler.requestSync('launch')` and `syncScheduler.start()`; subscribes to `syncScheduler` for `status`/`lastError`; refreshes `connected`/`lastSyncedAt` from creds + `LAST_SYNCED_KEY`; wires lifecycle triggers; and exposes `syncNow`/`overwriteCloud`/`connect`/`disconnect`. Key pieces:

```tsx
// status from the scheduler
useEffect(() => {
  const unsub = syncScheduler.subscribe((s) => {
    setStatus(s.status); setLastError(s.lastError);
    if (s.status === 'ok') void refreshMeta();
  });
  return unsub;
}, [refreshMeta]);

// launch + periodic
useEffect(() => {
  if (!available) return;
  let cancelled = false;
  (async () => {
    try {
      if ((await getSyncState(SYNC_IN_PROGRESS_KEY)) === '1') {
        const db = await getDatabase(); await cascadeRepair(db);
        await setSyncState(SYNC_IN_PROGRESS_KEY, '0');
      }
    } catch {}
    await refreshMeta();
    if (cancelled) return;
    syncScheduler.start();
    void syncScheduler.requestSync('launch');
  })();
  return () => { cancelled = true; syncScheduler.stop(); };
}, [available, refreshMeta]);

// lifecycle: RN AppState (mobile) + DOM visibility/blur (web + Tauri desktop)
useEffect(() => {
  if (!available) return;
  const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
    if (s === 'active') void syncScheduler.requestSync('lifecycle');
  });
  const onVisible = () => { if (document.visibilityState === 'visible') void syncScheduler.requestSync('lifecycle'); };
  const onHide = () => { void syncScheduler.requestSync('lifecycle'); }; // flush (scheduler decides full vs conditional)
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('blur', onHide);
  }
  return () => {
    sub.remove();
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('blur', onHide);
    }
  };
}, [available]);
```

`syncNow` exposed to the UI → `() => syncScheduler.requestSync('manual')`. `connect` → after `saveCredentials`, `setConnected(true)` and `syncScheduler.requestSync('manual')`. `overwriteCloud` stays calling `runOverwriteCloud()` directly (escape hatch) but wrap in the scheduler's in-flight by routing through a dedicated method is out of scope — keep it as a direct call guarded by its own try/finally and `setStatus`. Delete the old `inFlight`/`pending`/`createDebouncer`/`subscribeDirty` machinery (now in the scheduler).

- [ ] **Step 3: Unify the service entry points**

`src/services/erase-data.ts` — replace direct `syncNow()` calls:

```ts
import { syncScheduler } from '../sync/scheduler';
// ...
export async function eraseAllDataAndSync(opts: { resetSettings: boolean }): Promise<void> {
  await syncScheduler.requestSync('manual');   // pre-sync: pull latest + advance clock (full)
  const db = await getDatabase();
  await eraseAllData(db, { tick });
  if (opts.resetSettings) { for (const [k, v] of Object.entries(SETTING_DEFAULTS)) await setSetting(k, v); }
  syncScheduler.markDirty();
  await syncScheduler.requestSync('manual');   // push tombstones (full, dirty)
}
```

`src/services/backup.ts` `importBackup` — same pattern: `await syncScheduler.requestSync('manual')` for the pre-sync, then `eraseAllData` + `restoreBackupDoc(..., { restamp: true })`, then `syncScheduler.markDirty(); await syncScheduler.requestSync('manual')`. Remove the `syncNow` import; import `syncScheduler`.

`src/services/sample-data.ts` `loadSampleData` — after seeding, replace the trailing `await syncNow()` with `syncScheduler.markDirty(); await syncScheduler.requestSync('manual');`. Remove the `syncNow` import.

(`requestSync('manual')` forces a full sync, which both pulls latest before erase and pushes after — same guarantees as before, but through the single coordinator so it can't race the auto-sync.)

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run lint` → clean.
Run: `npm test` → all green (pure tests unaffected).
Grep to confirm no stray direct engine sync calls remain in services: `grep -rn "syncNow\|runSyncNow" src/services/` → none.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/SyncContext.tsx src/sync/dirty.ts src/services/erase-data.ts src/services/backup.ts src/services/sample-data.ts
git commit -m "refactor(sync): single scheduler drives all sync; unify erase/import/sample entry points

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Build, deploy, and verify on desktop

Manual verification — no code. Produces the evidence that the round works end to end.

- [ ] **Step 1: Build**

Run: `npm run build:windows`. Confirm it **fails loudly** if anything errors (Task 1); on success, note the fresh exe timestamp.

- [ ] **Step 2: Clean launch**

Close the app fully. Delete `C:\Users\<user>\AppData\Local\com.daxmu.cicada\EBWebView` (one last manual clear; after this, the SW-disable in Task 1 prevents recurrence). Launch the fresh exe.

- [ ] **Step 3: Verify deletion fix (the original goal)**

Connect 坚果云 (no `898`/module errors). Load sample → reset (new modal) → data disappears. Inspect the DB (`...\Roaming\com.daxmu.cicada\cicada.db`): `tombstone` rows present, `deviceId` UNCHANGED. Trigger a sync; confirm data does NOT resurrect; check the cloud file has tombstones + no live data.

- [ ] **Step 4: Verify timing**

Edit a record; within a few seconds confirm a sync fires (cloud file ETag changes / status indicator). Leave the app idle; confirm a periodic poll happens at ~5 min but the cloud file is NOT rewritten when nothing changed (the 304/skip-identical path). Make a change on another device (or edit the cloud file's mtime) and confirm the idle app pulls it within ~5 min.

- [ ] **Step 5: Verify no-SW**

Rebuild once more and relaunch WITHOUT clearing any cache; confirm the app loads the new bundle (no stale UI). This proves the SW-disable fix.

- [ ] **Step 6: Record results** in the PR/branch notes (what passed; any surprises).

---

## Self-Review

**Spec coverage:**
- Single coordinator / no race → Tasks 4–6. ✓
- Triggers (write debounced / periodic 5min / launch / lifecycle desktop-reliable) → Task 4 (logic) + Task 6 (wiring incl. DOM visibility/blur). ✓
- Skip no-ops (conditional GET 304 + skip-identical-write + etag) → Tasks 2, 3. ✓
- Unify entry points → Task 6 Step 3. ✓
- SW off on desktop + build fail-fast → Task 1. ✓
- Verify deletion + timing on desktop → Task 7. ✓
- Testing (scheduler/webdav/runSync unit tests) → Tasks 2, 3, 4. ✓

**Placeholder scan:** Task 2 Step 6 intentionally adds a temporary narrowing that Task 3 Step 3 replaces — called out explicitly, not a vague placeholder. No TBDs elsewhere; code is complete.

**Type consistency:** `read(opts?: { ifNoneMatch })` → `'not-modified'|{content,etag}|null` used identically in Tasks 2/3. `RunSyncDeps.conditionalEtag`, `SyncOutcome.status:'unchanged'`, `CLOUD_ETAG_KEY='cloud_etag'` consistent across Tasks 3/5. `createScheduler`/`Scheduler`/`SyncReason`/`syncScheduler`/`syncOnce(mode)` consistent across Tasks 4/5/6. `markDirty`/`requestSync` names match in scheduler, dirty.ts, services, SyncContext.

**Risk note:** Task 6 is the heaviest (SyncContext rewrite + service rewiring) and is only statically verified; Task 7's manual checklist is its real gate. If Task 6 review finds the SyncContext rewrite too large to verify confidently, split status-subscription from lifecycle-triggers into two commits.
