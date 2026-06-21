# Cloud Sync — Phase 4: Orchestration + UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Phase 1–3 pieces (HLC clock, document/merge/apply/reconcile engine, WebDAV provider, credential storage) into a working sync feature: a `syncNow()` orchestrator implementing the spec §5 read→merge→apply→push loop with `If-Match` optimistic concurrency, a `SyncContext` exposing status/actions, a Settings "Cloud Sync" section, and launch/foreground/manual triggers — native + Tauri only.

**Architecture:** A pure-ish, dependency-injected `runSync(deps)` core holds the entire algorithm and is unit-tested with the existing better-sqlite3 harness + an in-memory fake `SyncRemote` (two DBs syncing through one fake remote must converge). A thin `syncNow()` wires the real DB/remote/clock. `SyncContext` (React) owns user-facing status + triggers and is RN-only (tsc+lint+manual, no fabricated unit tests). The Settings UI is hidden when `!isSyncAvailable()`.

**Tech Stack:** Expo SDK 54 / RN 0.81, Expo Router, react-i18next, node:test + tsx + better-sqlite3 (test-only, already wired).

## Global Constraints

- **Node 20+** (`.nvmrc`). Verify every task with `npx tsc --noEmit` + `npm run lint` + `npm test`.
- **Lint baseline is 3 problems (0 errors, 3 warnings)** — pre-existing (`YearCalendar` unused `shared`, `AssetLineChart` unused `maxLabelCount`, `snapshot-repo` Array<T>). Confirm **no NEW** errors/warnings. (The historical 2 `react/no-unescaped-entities` errors in `app/asset/[id].tsx` were fixed by the i18n line; do not reintroduce.)
- **Test baseline is 55/55 passing.** New tests add to that count; never reduce it.
- **Convergence is the correctness bar:** `merge` is commutative/idempotent (Phase 2). The orchestrator must preserve that — two devices, after any interleaving of edits + syncs, reach **byte-identical** `buildDocument` output (modulo `generatedAt`/`generatedBy` meta). Every retry re-pulls + re-merges before re-pushing, so it never pushes *less* than it saw.
- **坚果云 facts (spec §11.1, empirically confirmed):** `If-Match` is **honored** (stale etag → 412 → `ConflictError`); GET returns `ETag`; `If-None-Match` is **ignored**; PUT returns no ETag. → Use `If-Match` optimistic concurrency; the no-ETag path is a fallback that still converges. **First write must use `ifNoneMatch`** (the only provider path that MKCOLs the parent folder).
- **Credentials live ONLY in secure storage** (`credentials.ts`/`credentials.web.ts` from Phase 3) — never in `sync_state`, never in the synced document, never logged.
- **Sync is native + Tauri only.** `isSyncAvailable()` (Phase 3) gates the context triggers and hides the Settings section in a plain browser/PWA.
- **HLC compares are ordinal** (`compareHlc`) — never `localeCompare`, never `<`/`>` on raw strings outside `compareHlc`.
- **`new Date()`/`Date.now()` are allowed in app code** (the ban is workflow-script-only). The orchestrator takes `now: () => number` as a dep so tests are deterministic.
- **Engine/provider modules are frozen contracts** — Phase 4 consumes `buildDocument`/`serializeDocument`/`parseDocument` (document.ts), `merge` (merge.ts), `applyMerge` (apply.ts), `createConfiguredRemote`/`loadRemote` (remote.ts), `loadCredentials`/`saveCredentials`/`clearCredentials` (credentials.ts), `getSyncState`/`setSyncState` (sync-state-repo.ts), `getDeviceId` (device.ts), `isSyncAvailable` (available.ts), `tick` (clock.ts). The only frozen file Phase 4 *edits* is `providers/types.ts` + `providers/webdav.ts` (Task 2, adding `AuthError`) and `app/_layout.tsx` + `app/(tabs)/settings.tsx` + the i18n locale JSON.

---

### Task 1: HLC `receive()` — advance the local clock past merged-in remote stamps

**Why:** After a device applies remote records whose HLCs are ahead of its own clock, a subsequent *local* edit must produce an HLC greater than anything it just merged, or LWW could wrongly keep stale local data. `tick()` only advances against `Date.now()`; it needs a `receive` rule.

**Files:**
- Modify: `src/sync/hlc.ts` (add pure `receive`)
- Test: `src/sync/hlc.test.ts` (add cases)
- Modify: `src/sync/clock.ts` (add `receiveRemote`, on the same serialization queue)

**Interfaces:**
- Consumes: `HlcState`, `HLC_COUNTER_MAX`, `parseHlc`, `advanceLocal` (hlc.ts); `tick`'s queue pattern (clock.ts).
- Produces:
  - `receive(local: HlcState, remote: HlcState, now: number): HlcState` (pure, hlc.ts)
  - `receiveRemote(remoteHlc: string): Promise<void>` (clock.ts — parses the stamp, applies `receive` with `Date.now()`, persists; serialized against `tick()`)

- [ ] **Step 1: Write the failing tests**

Add to `src/sync/hlc.test.ts` (follow the existing `import { test } from 'node:test'` / `node:assert` style already in the file):

```ts
import { receive } from './hlc';

test('receive adopts a remote phys that is ahead of local and now', () => {
  // local behind, now behind, remote ahead -> take remote.phys, counter = remote.counter + 1
  const next = receive({ phys: 100, counter: 5 }, { phys: 200, counter: 3 }, 150);
  assert.deepEqual(next, { phys: 200, counter: 4 });
});

test('receive uses now when now is the greatest', () => {
  const next = receive({ phys: 100, counter: 5 }, { phys: 200, counter: 3 }, 300);
  assert.deepEqual(next, { phys: 300, counter: 0 });
});

test('receive bumps max counter when local, remote, and now share phys', () => {
  const next = receive({ phys: 200, counter: 5 }, { phys: 200, counter: 8 }, 200);
  assert.deepEqual(next, { phys: 200, counter: 9 });
});

test('receive bumps local counter when only local equals the max phys', () => {
  const next = receive({ phys: 200, counter: 5 }, { phys: 100, counter: 9 }, 150);
  assert.deepEqual(next, { phys: 200, counter: 6 });
});

test('receive rolls phys forward on counter overflow', () => {
  const next = receive({ phys: 200, counter: 99999 }, { phys: 200, counter: 99999 }, 200);
  assert.deepEqual(next, { phys: 201, counter: 0 });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — `receive` is not exported from `./hlc`.

- [ ] **Step 3: Implement `receive` in `src/sync/hlc.ts`**

Append after `advanceLocal`:

```ts
/**
 * Advance the clock on RECEIVING a remote event stamped `remote`, at local time
 * `now` (ms). Standard HLC receive: take the greatest physical time, and bump the
 * counter of whichever component(s) tie it. Guarantees the next encoded stamp
 * sorts after both the local history and the remote event just merged in.
 */
export function receive(local: HlcState, remote: HlcState, now: number): HlcState {
  const phys = Math.max(now, local.phys, remote.phys);
  let counter: number;
  if (phys === local.phys && phys === remote.phys) {
    counter = Math.max(local.counter, remote.counter) + 1;
  } else if (phys === local.phys) {
    counter = local.counter + 1;
  } else if (phys === remote.phys) {
    counter = remote.counter + 1;
  } else {
    counter = 0;
  }
  if (counter > HLC_COUNTER_MAX) {
    return { phys: phys + 1, counter: 0 };
  }
  return { phys, counter };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS — all 5 new cases green; total count rises by 5.

- [ ] **Step 5: Add `receiveRemote` to `src/sync/clock.ts`**

The persisted HLC state and `tick()` already share a `queue` so a read-modify-write can't interleave. `receiveRemote` MUST run on that same queue. Replace the file body's tail (keep the imports + `HLC_KEY` + `queue` + `doTick` + `tick`) by adding `parseHlc`/`receive` to the import and appending the function:

```ts
import { advanceLocal, encodeHlc, parseHlc, receive, type HlcState } from './hlc';
```

```ts
async function doReceive(remoteHlc: string): Promise<void> {
  const raw = await getSyncState(HLC_KEY);
  const prev: HlcState = raw ? (JSON.parse(raw) as HlcState) : { phys: 0, counter: 0 };
  const { phys, counter } = parseHlc(remoteHlc);
  const next = receive(prev, { phys, counter }, Date.now());
  await setSyncState(HLC_KEY, JSON.stringify(next));
}

/** Fold a remote stamp into the local clock so future local ticks sort after it. */
export function receiveRemote(remoteHlc: string): Promise<void> {
  const run = queue.then(() => doReceive(remoteHlc), () => doReceive(remoteHlc));
  queue = run.catch(() => undefined);
  return run;
}
```

- [ ] **Step 6: Verify compilation + lint**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc clean; lint at baseline (3 problems); tests green (60 total: 55 baseline + 5 new).

- [ ] **Step 7: Commit**

```bash
git add src/sync/hlc.ts src/sync/hlc.test.ts src/sync/clock.ts
git commit -m "feat(sync): HLC receive() + clock.receiveRemote() (advance past remote stamps)"
```

---

### Task 2: `AuthError` taxonomy in the provider

**Why:** The orchestrator and UI must distinguish "wrong app password / revoked" (prompt reconnect) from a transient failure (retry next trigger). The provider already detects 401 but throws a plain `Error`. Promote it to a typed error so callers branch reliably.

**Files:**
- Modify: `src/sync/providers/types.ts` (add `AuthError`)
- Modify: `src/sync/providers/webdav.ts` (throw `AuthError` on 401 in both `read`/`write`/`testConnection`)
- Test: `src/sync/providers/webdav.test.ts` (assert `AuthError` on 401)

**Interfaces:**
- Consumes: existing `ConflictError` pattern in `types.ts`.
- Produces: `class AuthError extends Error` exported from `providers/types.ts`.

- [ ] **Step 1: Write the failing test**

Add to `src/sync/providers/webdav.test.ts` (match its existing mock-HttpClient style — there is already a "write throws on 401" test using a plain Error assertion; this adds the typed-error assertion):

```ts
import { AuthError } from './types';

test('read throws AuthError on 401', async () => {
  const remote = createWebDavRemote(CONFIG, mockHttp({ status: 401 }));
  await assert.rejects(() => remote.read(), (e) => e instanceof AuthError);
});

test('write throws AuthError on 401', async () => {
  const remote = createWebDavRemote(CONFIG, mockHttp({ status: 401 }));
  await assert.rejects(
    () => remote.write('{}', { kind: 'none' }),
    (e) => e instanceof AuthError
  );
});
```

> Reuse the file's existing `CONFIG` constant and its mock-HttpClient helper. If the existing helper is named differently (e.g. an inline `http` builder), call it the same way the existing 401 test does — match the file, don't invent a new helper.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `AuthError` is not exported / the provider throws a plain `Error`.

- [ ] **Step 3: Add `AuthError` to `src/sync/providers/types.ts`**

After the `ConflictError` class:

```ts
export class AuthError extends Error {
  constructor(message = 'WebDAV authentication failed (HTTP 401) — check the account and app password') {
    super(message);
    this.name = 'AuthError';
  }
}
```

- [ ] **Step 4: Throw it in `src/sync/providers/webdav.ts`**

Add `AuthError` to the import from `./types`, then replace the three 401 branches. In `read()`:

```ts
      if (res.status === 401) throw new AuthError();
```

(insert it before the `if (!ok(res.status))` check in `read`). In `testConnection()` replace:

```ts
      if (res.status === 401) {
        throw new Error('WebDAV authentication failed (401) — check the account and app password');
      }
```
with:
```ts
      if (res.status === 401) throw new AuthError();
```
And in `write()` replace the existing 401 branch the same way:
```ts
      if (res.status === 401) throw new AuthError();
```

- [ ] **Step 5: Run to verify pass**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc clean; lint baseline; tests green (62 total: 60 + 2 new); the pre-existing "throws on 401" tests still pass (`AuthError extends Error`, so any `assert.rejects(..., Error)` still holds).

- [ ] **Step 6: Commit**

```bash
git add src/sync/providers/types.ts src/sync/providers/webdav.ts src/sync/providers/webdav.test.ts
git commit -m "feat(sync): typed AuthError on WebDAV 401"
```

---

### Task 3: `runSync` orchestrator core + `syncNow`/`overwriteCloud` wrappers

**Why:** This is the heart of Phase 4 — the spec §5 loop. It is fully testable by injecting a `CicadaDB` (better-sqlite3 harness) and an in-memory fake `SyncRemote`.

**Files:**
- Create: `src/sync/sync.ts`
- Test: `src/sync/sync.test.ts`

**Interfaces:**
- Consumes: `buildDocument`/`serializeDocument`/`parseDocument`/`SyncDocument` (document.ts), `merge` (merge.ts), `applyMerge` (apply.ts), `SyncRemote`/`ConflictError`/`AuthError`/`WritePrecondition` (providers/types.ts), `compareHlc` (hlc.ts), `SCHEMA_VERSION` (db/migrations.ts), `CicadaDB` (db/migrations.ts). For the wrappers: `getDatabase` (db/database.ts), `loadRemote` (remote.ts), `getDeviceId` (device.ts), `getSyncState`/`setSyncState` (sync-state-repo.ts), `receiveRemote` (clock.ts), `isSyncAvailable` (available.ts), `buildDocument` again.
- Produces:
  - `type RunSyncDeps`, `type SyncOutcome`, `class UnsupportedRemoteError`
  - `runSync(deps: RunSyncDeps): Promise<SyncOutcome>`
  - `maxRemoteStamp(doc: SyncDocument): string | null`
  - `syncNow(): Promise<SyncOutcome | null>` (null if unavailable / no credentials)
  - `overwriteCloud(): Promise<void>`
  - `LAST_SYNCED_KEY = 'cloud_last_synced_at'`

- [ ] **Step 1: Write the failing tests**

Create `src/sync/sync.test.ts`. Use the existing harness `makeMigratedDb` from `./test-support/sqlite` (the same one `apply.test.ts`/`convergence.test.ts` use — check those files for the exact import and the helper that inserts a stamped account/asset so you reuse them rather than re-deriving SQL).

```ts
import { test } from 'node:test';
import assert from 'node:assert';
import { makeMigratedDb } from './test-support/sqlite';
import { buildDocument, serializeDocument, parseDocument, type SyncDocument } from './document';
import { ConflictError } from './providers/types';
import type { SyncRemote, WritePrecondition } from './providers/types';
import { runSync, maxRemoteStamp } from './sync';
import type { CicadaDB } from '../db/migrations';

// ---- in-memory fake remote -------------------------------------------------
function makeFakeRemote(opts: { honorIfMatch?: boolean; returnEtag?: boolean } = {}) {
  const honor = opts.honorIfMatch ?? true;
  const withEtag = opts.returnEtag ?? true;
  let content: string | null = null;
  let version = 0;
  const etag = () => (content === null ? null : withEtag ? `v${version}` : null);
  const remote: SyncRemote & { _content(): string | null; _seed(c: string): void } = {
    isConnected: () => true,
    testConnection: async () => {},
    read: async () => (content === null ? null : { content, etag: etag() }),
    write: async (c: string, pre: WritePrecondition) => {
      if (pre.kind === 'ifNoneMatch' && content !== null && honor) throw new ConflictError();
      if (pre.kind === 'ifMatch' && honor && pre.etag !== etag()) throw new ConflictError();
      content = c; version++;
      return { etag: etag() };
    },
    _content: () => content,
    _seed: (c: string) => { content = c; version++; },
  };
  return remote;
}

// state closures over a harness db's sync_state table
function stateOf(db: CicadaDB) {
  return {
    getState: async (k: string) =>
      (await db.getFirstAsync<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', [k]))?.value ?? null,
    setState: async (k: string, v: string) =>
      void (await db.runAsync(
        'INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [k, v]
      )),
  };
}

function depsFor(db: CicadaDB, remote: SyncRemote, deviceId: string, now = 1_000_000) {
  const received: string[] = [];
  return {
    deps: {
      db, remote, deviceId,
      now: () => now,
      ...stateOf(db),
      receiveRemote: async (h: string) => { received.push(h); },
      sleep: async () => {},
    },
    received,
  };
}

// insert a stamped account directly (uuid + updated_at HLC) — mirror the helper
// apply.test.ts already uses if present; otherwise inline this:
async function addAccount(db: CicadaDB, uuid: string, name: string, updatedAt: string) {
  await db.runAsync('INSERT INTO account (name, archived, uuid, updated_at) VALUES (?, 0, ?, ?)', [name, uuid, updatedAt]);
}

const HLC = (n: number, dev: string) => `${String(n).padStart(15, '0')}-00000-${dev.padStart(6, '0')}`;

test('seed: empty remote gets the local document via ifNoneMatch', async () => {
  const db = await makeMigratedDb();
  await addAccount(db, 'acc-a', 'Cash', HLC(10, 'aaaaaa'));
  const remote = makeFakeRemote();
  const { deps } = depsFor(db, remote, 'aaaaaa');
  const out = await runSync(deps);
  assert.equal(out.status, 'seeded');
  const pushed = parseDocument(remote._content()!);
  assert.equal(pushed.tables.account.length, 1);
  assert.equal(pushed.tables.account[0].name, 'Cash');
});

test('two devices converge through one remote', async () => {
  const dbA = await makeMigratedDb();
  const dbB = await makeMigratedDb();
  await addAccount(dbA, 'acc-a', 'Cash', HLC(10, 'aaaaaa'));
  await addAccount(dbB, 'acc-b', 'Brokerage', HLC(11, 'bbbbbb'));
  const remote = makeFakeRemote();
  await runSync(depsFor(dbA, remote, 'aaaaaa').deps); // A seeds {Cash}
  await runSync(depsFor(dbB, remote, 'bbbbbb').deps); // B merges -> {Cash, Brokerage}, pushes
  await runSync(depsFor(dbA, remote, 'aaaaaa').deps); // A pulls B's -> converges

  const docA = await buildDocument(dbA, { generatedBy: 'x', generatedAt: 'x' });
  const docB = await buildDocument(dbB, { generatedBy: 'x', generatedAt: 'x' });
  const names = (d: SyncDocument) => d.tables.account.map((a) => a.name).sort();
  assert.deepEqual(names(docA), ['Brokerage', 'Cash']);
  assert.deepEqual(names(docA), names(docB));
});

test('412 on push -> re-pull, re-merge, retry, converge', async () => {
  const db = await makeMigratedDb();
  await addAccount(db, 'acc-a', 'Cash', HLC(10, 'aaaaaa'));
  // remote already has a different account, with an etag
  const remote = makeFakeRemote();
  const seedDoc: SyncDocument = {
    syncFormatVersion: 1, enc: 'none', schemaVersion: 2, generatedAt: 'x', generatedBy: 'b',
    tables: { account: [{ uuid: 'acc-b', name: 'Brokerage', archived: 0, updated_at: HLC(11, 'bbbbbb') }], asset: [], snapshot: [], tran: [], setting: [] },
    tombstones: [],
  };
  remote._seed(serializeDocument(seedDoc));
  // make the FIRST ifMatch write 412 by injecting a concurrent change
  const realWrite = remote.write.bind(remote);
  let injected = false;
  remote.write = async (c, pre) => {
    if (pre.kind === 'ifMatch' && !injected) {
      injected = true;
      const concurrent: SyncDocument = { ...seedDoc,
        tables: { ...seedDoc.tables, account: [...seedDoc.tables.account, { uuid: 'acc-c', name: 'Crypto', archived: 0, updated_at: HLC(12, 'cccccc') }] } };
      remote._seed(serializeDocument(concurrent)); // remote moved on -> stale etag
      throw new ConflictError();
    }
    return realWrite(c, pre);
  };
  const out = await runSync(depsFor(db, remote, 'aaaaaa').deps);
  assert.equal(out.status, 'merged');
  const final = parseDocument(remote._content()!);
  assert.deepEqual(final.tables.account.map((a) => a.name).sort(), ['Brokerage', 'Cash', 'Crypto']);
});

test('no-ETag server falls back to unconditional write and still converges', async () => {
  const db = await makeMigratedDb();
  await addAccount(db, 'acc-a', 'Cash', HLC(10, 'aaaaaa'));
  const remote = makeFakeRemote({ returnEtag: false });
  const seedDoc: SyncDocument = {
    syncFormatVersion: 1, enc: 'none', schemaVersion: 2, generatedAt: 'x', generatedBy: 'b',
    tables: { account: [{ uuid: 'acc-b', name: 'Brokerage', archived: 0, updated_at: HLC(11, 'bbbbbb') }], asset: [], snapshot: [], tran: [], setting: [] },
    tombstones: [],
  };
  remote._seed(serializeDocument(seedDoc));
  const out = await runSync(depsFor(db, remote, 'aaaaaa').deps);
  assert.equal(out.status, 'merged');
  const final = parseDocument(remote._content()!);
  assert.deepEqual(final.tables.account.map((a) => a.name).sort(), ['Brokerage', 'Cash']);
});

test('rejects a remote with enc != none or a newer schemaVersion', async () => {
  const db = await makeMigratedDb();
  const remote = makeFakeRemote();
  remote._seed(JSON.stringify({ syncFormatVersion: 1, enc: 'aes-gcm', schemaVersion: 2, generatedAt: 'x', generatedBy: 'b', tables: { account: [], asset: [], snapshot: [], tran: [], setting: [] }, tombstones: [] }));
  await assert.rejects(() => runSync(depsFor(db, remote, 'aaaaaa').deps));
});

test('maxRemoteStamp returns the greatest HLC across tables and tombstones', () => {
  const doc: SyncDocument = {
    syncFormatVersion: 1, enc: 'none', schemaVersion: 2, generatedAt: 'x', generatedBy: 'b',
    tables: {
      account: [{ uuid: 'a', name: 'n', archived: 0, updated_at: HLC(5, 'aaaaaa') }],
      asset: [], snapshot: [], tran: [],
      setting: [{ key: 'k', value: 'v', updated_at: HLC(9, 'aaaaaa') }],
    },
    tombstones: [{ entity: 'tran', uuid: 't', deleted_at: HLC(7, 'aaaaaa') }],
  };
  assert.equal(maxRemoteStamp(doc), HLC(9, 'aaaaaa'));
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — `./sync` does not exist.

- [ ] **Step 3: Implement `src/sync/sync.ts`**

```ts
import type { CicadaDB } from '../db/migrations';
import { SCHEMA_VERSION } from '../db/migrations';
import {
  buildDocument,
  serializeDocument,
  parseDocument,
  type SyncDocument,
} from './document';
import { merge } from './merge';
import { applyMerge } from './apply';
import { compareHlc } from './hlc';
import { ConflictError, type SyncRemote, type WritePrecondition } from './providers/types';

export const LAST_SYNCED_KEY = 'cloud_last_synced_at';

export class UnsupportedRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedRemoteError';
  }
}

export type RunSyncDeps = {
  db: CicadaDB;
  remote: SyncRemote;
  deviceId: string;
  now: () => number;
  getState: (key: string) => Promise<string | null>;
  setState: (key: string, value: string) => Promise<void>;
  receiveRemote: (remoteHlc: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
};

export type SyncOutcome = {
  status: 'seeded' | 'merged';
  suffixed: string[];
};

/** Greatest HLC stamp anywhere in a remote document (updated_at + deleted_at), or null. */
export function maxRemoteStamp(doc: SyncDocument): string | null {
  let max: string | null = null;
  const consider = (s: string) => {
    if (max === null || compareHlc(s, max) > 0) max = s;
  };
  for (const r of doc.tables.account) consider(r.updated_at);
  for (const r of doc.tables.asset) consider(r.updated_at);
  for (const r of doc.tables.snapshot) consider(r.updated_at);
  for (const r of doc.tables.tran) consider(r.updated_at);
  for (const r of doc.tables.setting) consider(r.updated_at);
  for (const t of doc.tombstones) consider(t.deleted_at);
  return max;
}

function backoffMs(attempt: number): number {
  return 200 * 2 ** (attempt - 1) + Math.floor(Math.random() * 100);
}

function assertCompatible(doc: SyncDocument): void {
  if (doc.enc !== 'none') {
    throw new UnsupportedRemoteError(`remote document is encrypted (enc="${doc.enc}") — please update the app`);
  }
  if (doc.schemaVersion > SCHEMA_VERSION) {
    throw new UnsupportedRemoteError(
      `remote schemaVersion ${doc.schemaVersion} is newer than this app (${SCHEMA_VERSION}) — please update the app`
    );
  }
}

export async function runSync(deps: RunSyncDeps): Promise<SyncOutcome> {
  const { db, remote, deviceId, now, getState, setState, receiveRemote } = deps;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maxRetries = deps.maxRetries ?? 5;

  const buildLocal = () =>
    buildDocument(db, { generatedBy: deviceId, generatedAt: new Date(now()).toISOString() });

  let pulled = await remote.read();

  // Seed an empty remote. ifNoneMatch is the only path that MKCOLs the folder.
  if (pulled === null) {
    try {
      await remote.write(serializeDocument(await buildLocal()), { kind: 'ifNoneMatch' });
      await setState(LAST_SYNCED_KEY, String(now()));
      return { status: 'seeded', suffixed: [] };
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
      // Another device seeded between our read and write — fall through to merge.
      pulled = await remote.read();
      if (pulled === null) throw new Error('remote vanished after create conflict');
    }
  }

  for (let attempt = 0; ; ) {
    const remoteDoc = parseDocument(pulled.content);
    assertCompatible(remoteDoc);

    const merged = merge(await buildLocal(), remoteDoc);
    const applied = await applyMerge(db, merged);

    const max = maxRemoteStamp(remoteDoc);
    if (max) await receiveRemote(max);

    // Rebuild AFTER apply so we push the canonical merged local state.
    const outDoc = serializeDocument(await buildLocal());
    const pre: WritePrecondition = pulled.etag
      ? { kind: 'ifMatch', etag: pulled.etag }
      : { kind: 'none' };

    try {
      await remote.write(outDoc, pre);
      await setState(LAST_SYNCED_KEY, String(now()));
      return { status: 'merged', suffixed: applied.suffixed };
    } catch (e) {
      if (e instanceof ConflictError && attempt < maxRetries) {
        attempt++;
        await sleep(backoffMs(attempt));
        const re = await remote.read();
        if (re === null) throw new Error('remote vanished during retry');
        pulled = re;
        continue;
      }
      throw e;
    }
  }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: PASS — all 6 new cases green. (If the "two devices converge" case fails, the bug is real — do not weaken the assertion.)

- [ ] **Step 5: Add the production wrappers to `src/sync/sync.ts`**

Append (these are thin wiring, exercised by the manual checklist in Tasks 4–5, not unit-tested):

```ts
import { getDatabase } from '../db/database';
import { getDeviceId } from './device';
import { getSyncState, setSyncState } from './sync-state-repo';
import { receiveRemote } from './clock';
import { loadRemote } from './remote';
import { isSyncAvailable } from './available';

/** Run a full sync against the configured remote. Returns null if sync is
 *  unavailable on this platform or no credentials are stored. */
export async function syncNow(): Promise<SyncOutcome | null> {
  if (!isSyncAvailable()) return null;
  const remote = await loadRemote();
  if (!remote) return null;
  const db = await getDatabase();
  const deviceId = await getDeviceId();
  return runSync({
    db,
    remote,
    deviceId,
    now: () => Date.now(),
    getState: getSyncState,
    setState: setSyncState,
    receiveRemote,
  });
}

/** Discard the remote document and replace it with this device's state.
 *  The corrupt-remote / first-connect "Replace" escape hatch (spec §8). */
export async function overwriteCloud(): Promise<void> {
  if (!isSyncAvailable()) return;
  const remote = await loadRemote();
  if (!remote) return;
  const db = await getDatabase();
  const deviceId = await getDeviceId();
  const doc = serializeDocument(
    await buildDocument(db, { generatedBy: deviceId, generatedAt: new Date().toISOString() })
  );
  const existing = await remote.read();
  // ifNoneMatch only on a truly-absent file (it MKCOLs the folder); else overwrite.
  await remote.write(doc, existing === null ? { kind: 'ifNoneMatch' } : { kind: 'none' });
  await setSyncState(LAST_SYNCED_KEY, String(Date.now()));
}
```

- [ ] **Step 6: Verify compilation + lint + tests**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc clean; lint baseline; tests green (68 total: 62 + 6 new).

- [ ] **Step 7: Commit**

```bash
git add src/sync/sync.ts src/sync/sync.test.ts
git commit -m "feat(sync): runSync orchestrator (read/seed/merge/apply/push + If-Match retry) + syncNow/overwriteCloud"
```

---

### Task 4: `SyncContext` — status, actions, and triggers

**Why:** The UI needs a single source of sync state + the launch/foreground/manual triggers. RN-only; not unit-testable (imports react/react-native/AppState). Automated gate = tsc+lint; real proof = the manual checklist + the device round-trip in the final section.

**Files:**
- Create: `src/hooks/SyncContext.tsx`
- Modify: `app/_layout.tsx` (wrap the tree in `SyncProvider`, inside `SettingsProvider`)

**Interfaces:**
- Consumes: `isSyncAvailable` (available.ts), `loadCredentials`/`saveCredentials`/`clearCredentials` (credentials.ts), `createConfiguredRemote` (remote.ts), `WebDavConfig` (providers/webdav.ts), `AuthError` (providers/types.ts), `syncNow`/`overwriteCloud`/`LAST_SYNCED_KEY` (sync.ts), `getSyncState`/`setSyncState` (sync-state-repo.ts).
- Produces: `SyncProvider`, `useSync()` returning:

```ts
type SyncStatus = 'idle' | 'syncing' | 'ok' | 'offline' | 'authError' | 'error';
type SyncContextValue = {
  available: boolean;
  connected: boolean;
  status: SyncStatus;
  lastSyncedAt: number | null;
  lastError: string | null;
  testConnection: (config: WebDavConfig) => Promise<void>;   // throws on failure (UI shows it)
  connect: (config: WebDavConfig) => Promise<void>;          // save creds + first sync
  disconnect: () => Promise<void>;
  syncNow: () => Promise<void>;                              // never throws; sets status/lastError
  overwriteCloud: () => Promise<void>;
};
```

- [ ] **Step 1: Create `src/hooks/SyncContext.tsx`**

```tsx
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { isSyncAvailable } from '../sync/available';
import {
  loadCredentials,
  saveCredentials,
  clearCredentials,
} from '../sync/credentials';
import { createConfiguredRemote } from '../sync/remote';
import { type WebDavConfig } from '../sync/providers/webdav';
import { AuthError } from '../sync/providers/types';
import {
  syncNow as runSyncNow,
  overwriteCloud as runOverwriteCloud,
  LAST_SYNCED_KEY,
} from '../sync/sync';
import { getSyncState } from '../sync/sync-state-repo';

export type SyncStatus = 'idle' | 'syncing' | 'ok' | 'offline' | 'authError' | 'error';

type SyncContextValue = {
  available: boolean;
  connected: boolean;
  status: SyncStatus;
  lastSyncedAt: number | null;
  lastError: string | null;
  testConnection: (config: WebDavConfig) => Promise<void>;
  connect: (config: WebDavConfig) => Promise<void>;
  disconnect: () => Promise<void>;
  syncNow: () => Promise<void>;
  overwriteCloud: () => Promise<void>;
};

const noop = async () => {};
const SyncContext = createContext<SyncContextValue>({
  available: false,
  connected: false,
  status: 'idle',
  lastSyncedAt: null,
  lastError: null,
  testConnection: noop,
  connect: noop,
  disconnect: noop,
  syncNow: noop,
  overwriteCloud: noop,
});

function classify(e: unknown): { status: SyncStatus; message: string } {
  if (e instanceof AuthError) return { status: 'authError', message: e.message };
  // fetch network failures reject with a TypeError ("Network request failed" on RN).
  if (e instanceof TypeError) return { status: 'offline', message: 'network unavailable' };
  const message = e instanceof Error ? e.message : String(e);
  return { status: 'error', message };
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const available = isSyncAvailable();
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const refreshMeta = useCallback(async () => {
    const creds = await loadCredentials();
    setConnected(creds !== null);
    const raw = await getSyncState(LAST_SYNCED_KEY);
    setLastSyncedAt(raw ? Number(raw) : null);
  }, []);

  const doSync = useCallback(async () => {
    if (!available || inFlight.current) return;
    if ((await loadCredentials()) === null) return;
    inFlight.current = true;
    setStatus('syncing');
    setLastError(null);
    try {
      await runSyncNow();
      setStatus('ok');
    } catch (e) {
      const { status: s, message } = classify(e);
      setStatus(s);
      setLastError(message);
    } finally {
      inFlight.current = false;
      await refreshMeta();
    }
  }, [available, refreshMeta]);

  // Launch trigger + load persisted meta.
  useEffect(() => {
    if (!available) return;
    (async () => {
      await refreshMeta();
      await doSync();
    })();
  }, [available, refreshMeta, doSync]);

  // Foreground trigger (debounced via the in-flight guard).
  useEffect(() => {
    if (!available) return;
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') void doSync();
    });
    return () => sub.remove();
  }, [available, doSync]);

  const testConnection = useCallback(async (config: WebDavConfig) => {
    await createConfiguredRemote(config).testConnection(); // throws on failure
  }, []);

  const connect = useCallback(async (config: WebDavConfig) => {
    await createConfiguredRemote(config).testConnection(); // verify before persisting
    await saveCredentials(config);
    setConnected(true);
    await doSync();
  }, [doSync]);

  const disconnect = useCallback(async () => {
    await clearCredentials();
    setConnected(false);
    setStatus('idle');
    setLastError(null);
  }, []);

  const overwriteCloud = useCallback(async () => {
    if (!available || inFlight.current) return;
    inFlight.current = true;
    setStatus('syncing');
    setLastError(null);
    try {
      await runOverwriteCloud();
      setStatus('ok');
    } catch (e) {
      const { status: s, message } = classify(e);
      setStatus(s);
      setLastError(message);
    } finally {
      inFlight.current = false;
      await refreshMeta();
    }
  }, [available, refreshMeta]);

  return (
    <SyncContext.Provider
      value={{
        available,
        connected,
        status,
        lastSyncedAt,
        lastError,
        testConnection,
        connect,
        disconnect,
        syncNow: doSync,
        overwriteCloud,
      }}>
      {children}
    </SyncContext.Provider>
  );
}

export function useSync() {
  return useContext(SyncContext);
}
```

- [ ] **Step 2: Wrap the app in `app/_layout.tsx`**

Add the import and nest `SyncProvider` **inside** `SettingsProvider` (so a future sync-triggered settings reload sees the provider):

```tsx
import { SyncProvider } from '../src/hooks/SyncContext';
```

Wrap the existing `<ThemeProvider>…</ThemeProvider>` subtree:

```tsx
    <SettingsProvider>
      <SyncProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          {/* …existing Stack… */}
        </ThemeProvider>
      </SyncProvider>
    </SettingsProvider>
```

- [ ] **Step 3: Verify compilation + lint**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc clean; lint baseline (no new warnings); tests still 68/68 (this task adds none).

- [ ] **Step 4: Manual verification (developer)**

Deferred to the end-to-end section. At minimum confirm the web build still boots in a plain browser with `available === false` and no sync attempt fires (no network calls to a WebDAV host).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/SyncContext.tsx app/_layout.tsx
git commit -m "feat(sync): SyncContext (status + connect/disconnect/syncNow + launch/foreground triggers)"
```

---

### Task 5: Settings "Cloud Sync" section + i18n

**Why:** The user-facing surface: enter server/account/app-password, test, connect/disconnect, sync now, see status + last-synced, and the "Overwrite cloud" escape hatch. Hidden entirely when `!isSyncAvailable()`. RN-only; tsc+lint + manual.

**Files:**
- Create: `src/components/CloudSyncSection.tsx` (keeps `settings.tsx` from growing unwieldy; mirrors how charts/components live under `src/components/`)
- Modify: `app/(tabs)/settings.tsx` (render `<CloudSyncSection />` above the "Manage" section)
- Modify: `src/i18n/locales/en.json` and `src/i18n/locales/zh.json` (add `settings.cloudSync.*`)

**Interfaces:**
- Consumes: `useSync` (SyncContext), `WebDavConfig` (providers/webdav.ts), `confirmAsync`/`notify` (utils/dialog.ts), `colors`/`shared`/`spacing` (utils/theme.ts), `useTranslation` (react-i18next).
- Produces: `CloudSyncSection` (default export, no props).

- [ ] **Step 1: Add i18n keys**

In `src/i18n/locales/en.json`, inside the `settings` object, add:

```json
    "cloudSync": "Cloud Sync",
    "cloudSyncHelp": "Sync your data across devices via WebDAV (e.g. Nutstore / 坚果云). Your credentials stay on this device.",
    "cloudServerUrl": "WebDAV address",
    "cloudAccount": "Account (email)",
    "cloudAppPassword": "App password",
    "cloudAppPasswordHelp": "Use an app password, not your login password (Nutstore → Security → Add app password).",
    "cloudTest": "Test connection",
    "cloudConnect": "Connect",
    "cloudDisconnect": "Disconnect",
    "cloudSyncNow": "Sync now",
    "cloudConnected": "Connected",
    "cloudNotConnected": "Not connected",
    "cloudLastSynced": "Last synced: {{when}}",
    "cloudNeverSynced": "Never synced",
    "cloudTestOk": "Connection succeeded.",
    "cloudStatusSyncing": "Syncing…",
    "cloudStatusOk": "Up to date",
    "cloudStatusOffline": "Offline — will retry",
    "cloudStatusAuthError": "Authentication failed — check your app password",
    "cloudStatusError": "Sync error",
    "cloudOverwrite": "Overwrite cloud with this device",
    "cloudOverwriteSub": "Replace the cloud copy with this device's data. Use only if the cloud copy is broken.",
    "cloudOverwriteConfirm": "Overwrite the cloud copy with this device's data?",
    "cloudMissingFields": "Enter the server address, account, and app password."
```

In `src/i18n/locales/zh.json`, inside `settings`, add the same keys with translations:

```json
    "cloudSync": "云同步",
    "cloudSyncHelp": "通过 WebDAV(如坚果云)在多设备间同步数据。凭据只保存在本机。",
    "cloudServerUrl": "WebDAV 地址",
    "cloudAccount": "账户(邮箱)",
    "cloudAppPassword": "应用密码",
    "cloudAppPasswordHelp": "请使用应用密码,而非登录密码(坚果云 → 安全选项 → 添加应用密码)。",
    "cloudTest": "测试连接",
    "cloudConnect": "连接",
    "cloudDisconnect": "断开",
    "cloudSyncNow": "立即同步",
    "cloudConnected": "已连接",
    "cloudNotConnected": "未连接",
    "cloudLastSynced": "上次同步:{{when}}",
    "cloudNeverSynced": "尚未同步",
    "cloudTestOk": "连接成功。",
    "cloudStatusSyncing": "同步中…",
    "cloudStatusOk": "已是最新",
    "cloudStatusOffline": "离线 — 稍后重试",
    "cloudStatusAuthError": "认证失败 — 请检查应用密码",
    "cloudStatusError": "同步出错",
    "cloudOverwrite": "用本设备覆盖云端",
    "cloudOverwriteSub": "用本设备的数据替换云端副本。仅在云端副本损坏时使用。",
    "cloudOverwriteConfirm": "确定用本设备的数据覆盖云端副本吗?",
    "cloudMissingFields": "请填写服务器地址、账户和应用密码。"
```

> Validate both files after editing: `node -e "require('./src/i18n/locales/en.json'); require('./src/i18n/locales/zh.json'); console.log('ok')"`.

- [ ] **Step 2: Create `src/components/CloudSyncSection.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useSync, type SyncStatus } from '../hooks/SyncContext';
import { loadCredentials } from '../sync/credentials';
import { type WebDavConfig } from '../sync/providers/webdav';
import { confirmAsync, notify } from '../utils/dialog';
import { colors, shared, spacing } from '../utils/theme';

const DEFAULT_URL = 'https://dav.jianguoyun.com/dav/';

const STATUS_KEY: Record<SyncStatus, string> = {
  idle: '',
  syncing: 'settings.cloudStatusSyncing',
  ok: 'settings.cloudStatusOk',
  offline: 'settings.cloudStatusOffline',
  authError: 'settings.cloudStatusAuthError',
  error: 'settings.cloudStatusError',
};

export default function CloudSyncSection() {
  const { t } = useTranslation();
  const sync = useSync();
  const [baseUrl, setBaseUrl] = useState(DEFAULT_URL);
  const [username, setUsername] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [busy, setBusy] = useState(false);

  // Prefill the non-secret fields when already connected.
  useEffect(() => {
    if (!sync.available) return;
    (async () => {
      const creds = await loadCredentials();
      if (creds) {
        setBaseUrl(creds.baseUrl);
        setUsername(creds.username);
        setAppPassword(creds.appPassword);
      }
    })();
  }, [sync.available, sync.connected]);

  if (!sync.available) return null; // hidden in a plain browser / PWA

  const config = (): WebDavConfig => ({ baseUrl: baseUrl.trim(), username: username.trim(), appPassword });
  const hasFields = baseUrl.trim() && username.trim() && appPassword;

  const guard = async (fn: () => Promise<void>) => {
    if (!hasFields) {
      notify(t('common.error'), t('settings.cloudMissingFields'));
      return;
    }
    setBusy(true);
    try {
      await fn();
    } catch (e: any) {
      notify(t('common.error'), e?.message ?? t('settings.cloudStatusError'));
    } finally {
      setBusy(false);
    }
  };

  const onTest = () => guard(async () => {
    await sync.testConnection(config());
    notify(t('settings.doneTitle'), t('settings.cloudTestOk'));
  });
  const onConnect = () => guard(async () => { await sync.connect(config()); });
  const onDisconnect = async () => {
    const ok = await confirmAsync(t('settings.cloudDisconnect'), '', t('settings.cloudDisconnect'), true);
    if (!ok) return;
    setBusy(true);
    try { await sync.disconnect(); } finally { setBusy(false); }
  };
  const onOverwrite = async () => {
    const ok = await confirmAsync(t('settings.cloudOverwrite'), t('settings.cloudOverwriteConfirm'), t('settings.cloudOverwrite'), true);
    if (!ok) return;
    setBusy(true);
    try { await sync.overwriteCloud(); } finally { setBusy(false); }
  };

  const lastSynced = sync.lastSyncedAt
    ? t('settings.cloudLastSynced', { when: new Date(sync.lastSyncedAt).toLocaleString() })
    : t('settings.cloudNeverSynced');
  const statusKey = STATUS_KEY[sync.status];

  return (
    <>
      <Text style={[shared.sectionTitle, { marginTop: spacing.xl }]}>{t('settings.cloudSync')}</Text>
      <View style={shared.card}>
        <Text style={shared.muted}>{t('settings.cloudSyncHelp')}</Text>

        <Text style={styles.label}>{t('settings.cloudServerUrl')}</Text>
        <TextInput style={styles.input} value={baseUrl} onChangeText={setBaseUrl} autoCapitalize="none" autoCorrect={false} editable={!sync.connected} />

        <Text style={styles.label}>{t('settings.cloudAccount')}</Text>
        <TextInput style={styles.input} value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" editable={!sync.connected} />

        <Text style={styles.label}>{t('settings.cloudAppPassword')}</Text>
        <TextInput style={styles.input} value={appPassword} onChangeText={setAppPassword} autoCapitalize="none" autoCorrect={false} secureTextEntry editable={!sync.connected} />
        <Text style={shared.muted}>{t('settings.cloudAppPasswordHelp')}</Text>

        <View style={styles.statusRow}>
          <Text style={[styles.statusText, sync.status === 'authError' || sync.status === 'error' ? { color: colors.negative } : null]}>
            {sync.connected ? t('settings.cloudConnected') : t('settings.cloudNotConnected')}
            {statusKey ? ` · ${t(statusKey)}` : ''}
          </Text>
          <Text style={shared.muted}>{lastSynced}</Text>
        </View>

        <View style={styles.buttonRow}>
          {!sync.connected ? (
            <>
              <Btn label={t('settings.cloudTest')} onPress={onTest} disabled={busy} />
              <Btn label={t('settings.cloudConnect')} onPress={onConnect} disabled={busy} primary />
            </>
          ) : (
            <>
              <Btn label={t('settings.cloudSyncNow')} onPress={() => sync.syncNow()} disabled={busy} primary />
              <Btn label={t('settings.cloudDisconnect')} onPress={onDisconnect} disabled={busy} />
            </>
          )}
        </View>
      </View>

      {sync.connected && (
        <TouchableOpacity onPress={onOverwrite} disabled={busy} style={[shared.card, busy && { opacity: 0.5 }]}>
          <Text style={[styles.label, { color: colors.negative, marginTop: 0 }]}>{t('settings.cloudOverwrite')}</Text>
          <Text style={shared.muted}>{t('settings.cloudOverwriteSub')}</Text>
        </TouchableOpacity>
      )}
    </>
  );
}

function Btn({ label, onPress, disabled, primary }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[styles.btn, primary && styles.btnPrimary, disabled && { opacity: 0.5 }]}>
      <Text style={[styles.btnText, primary && { color: 'white' }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 14, fontWeight: '600', marginTop: spacing.md, marginBottom: spacing.xs },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 8,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: 'white', fontSize: 15,
  },
  statusRow: { marginTop: spacing.md },
  statusText: { fontSize: 14, fontWeight: '600' },
  buttonRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  btn: {
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: 8,
    borderWidth: 1, borderColor: colors.border, backgroundColor: 'white',
  },
  btnPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  btnText: { fontSize: 15, fontWeight: '600', color: colors.muted },
});
```

> `theme.ts` defines `spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 }` and exports `colors`, `shared`, `spacing` — all tokens used above exist; no substitution needed.

- [ ] **Step 3: Render it in `app/(tabs)/settings.tsx`**

Add the import:

```tsx
import CloudSyncSection from '../../src/components/CloudSyncSection';
```

Render `<CloudSyncSection />` immediately before the `{t('settings.manage')}` section title (after the Language card's closing `</View>`):

```tsx
      <CloudSyncSection />

      <Text style={[shared.sectionTitle, { marginTop: spacing.xl }]}>{t('settings.manage')}</Text>
```

- [ ] **Step 4: Verify compilation + lint + tests + JSON**

Run: `node -e "require('./src/i18n/locales/en.json'); require('./src/i18n/locales/zh.json'); console.log('json ok')" && npx tsc --noEmit && npm run lint && npm test`
Expected: json ok; tsc clean; lint baseline; tests 68/68.

- [ ] **Step 5: Manual verification (developer)**

Deferred to the end-to-end section. Quick check: `npm run web` in a plain browser → the Cloud Sync section is **absent** (no server/account fields).

- [ ] **Step 6: Commit**

```bash
git add src/components/CloudSyncSection.tsx app/(tabs)/settings.tsx src/i18n/locales/en.json src/i18n/locales/zh.json
git commit -m "feat(sync): Settings Cloud Sync section (connect/sync/overwrite) + en/zh strings"
```

---

## Manual end-to-end verification (developer, after all tasks)

The real proof. Needs a device/desktop build and the 坚果云 app password already used in Phase 3 (`.webdav-test.local.json`).

1. **Desktop (Tauri):** `npm run tauri:dev`. Settings → Cloud Sync → enter `https://dav.jianguoyun.com/dav/` + account + app password → **Test connection** (expect success) → **Connect** (seeds `cicada/cicada-sync.json`, status → "Up to date", last-synced set).
2. **Second device convergence:** on a phone dev build (`eas build --profile development` — Expo Go can't load `expo-secure-store` + the config plugin), connect the same account. Make an edit on each device (add an account/asset), trigger sync on both (foreground or **Sync now**), confirm **both** show the union and net worth matches. Delete a parent on one device → sync → confirm cascade delete propagates to the other.
3. **Conflict path:** edit on both devices while one is offline; bring both online; confirm no data loss and identical state after a couple of sync rounds (the 412 retry + union merge).
4. **Auth error:** enter a wrong app password → status shows "Authentication failed".
5. **Overwrite escape hatch:** corrupt the remote file by hand (or use a fresh account), then **Overwrite cloud with this device** → confirm the remote is replaced and the other device re-merges cleanly.
6. **Plain browser negative check:** `npm run serve:web` in a normal browser → no Cloud Sync section; app works locally; no WebDAV network calls.
7. **Clean up:** the probe wrote `cicada/cicada-sync-TEST.json` (already deleted in Phase 3); the real file is `cicada/cicada-sync.json`.

## What this plan does NOT cover (Phase 5)

- **Backup v3** (export/import carrying uuid/updated_at/tombstones so a restore round-trips through sync), **tombstone GC** (prune tombstones older than a safe horizon), broader cross-target polish.
- **Carried-over Phase-2 Minor cleanups:** `reconcile.ts` adopt SELECTs fetch an unused `updated_at`; `live.asset` may list orphan-skipped uuids; the suffix path doesn't re-stamp `updated_at`. Fold into Phase 5 polish.
- **At-rest encryption** (the `enc` envelope is reserved; v1 is plaintext-in-cloud, accepted).
- **A first-connect Merge-vs-Replace modal:** intentionally omitted. Natural-key adoption (reconcile.ts) makes the default Merge convergent and safe; "Overwrite cloud with this device" is the Replace escape hatch. Adding a modal would be unnecessary complexity (YAGNI).

## Self-review notes

- **Spec coverage (§5 orchestration):** read→seed(ifNoneMatch)→parse→policy-check→merge→apply→receiveRemote→push(ifMatch/none)→412-retry-with-backoff→save lastSynced → Task 3 `runSync`. Triggers (launch/foreground/manual) → Task 4. Settings section (server/account/app-password/test/connect/disconnect/sync-now/last-synced/status, native+desktop only) → Task 5. §8 escape hatches: AuthError → Task 2 + Task 4 `classify`; UnsupportedRemote (enc/schemaVersion) → Task 3; corrupt-remote "overwrite" → Task 3 `overwriteCloud` + Task 5. HLC `receive` (clock advances past merged remote stamps) → Task 1.
- **Type consistency:** `RunSyncDeps`/`SyncOutcome`/`UnsupportedRemoteError`/`maxRemoteStamp`/`LAST_SYNCED_KEY` defined in Task 3 and consumed verbatim in Task 4. `SyncStatus`/`SyncContextValue` defined in Task 4 and consumed in Task 5. `WebDavConfig` is the Phase-3 type throughout. `receive`/`receiveRemote` names match between hlc.ts/clock.ts (Task 1) and sync.ts (Task 3).
- **Testability honesty:** Tasks 1–3 are pure/DB-bound → real unit tests (node:test + better-sqlite3, the project's established harness; convergence asserted by two DBs through one fake remote). Tasks 4–5 are RN shims → tsc+lint + a manual checklist + the device round-trip; no fabricated UI unit tests.
- **Convergence:** every push is preceded by pull+merge; retries re-pull+re-merge; `merge` is commutative/idempotent (Phase 2). The no-ETag fallback is covered by its own test. The "two devices converge" test is the guard against any asymmetry.
- **Frozen-contract discipline:** the only frozen files edited are `providers/types.ts`+`providers/webdav.ts` (additive `AuthError`, Task 2) and the app shell (`_layout.tsx`, `settings.tsx`, locale JSON). Engine/provider behavior is otherwise consumed, not changed.
```
