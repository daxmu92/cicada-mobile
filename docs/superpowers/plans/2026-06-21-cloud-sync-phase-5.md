# Cloud Sync — Phase 5: Backup v3, Tombstone GC, Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish cloud sync: a backup format (v3) that carries sync identity so a restored device syncs correctly, a 90-day tombstone GC, a `sync-in-progress` crash-recovery flag, and the carried-over Phase-2 Minor cleanups.

**Architecture:** Extract the pure build/parse/restore core of `backup.ts` into `backup-core.ts` (no RN/expo imports) so it is unit-testable with the better-sqlite3 harness; `backup.ts` keeps the RN/expo file-IO wrappers and delegates to the core. `gcTombstones` and the `sync-in-progress` flag live in `sync.ts` and are exercised by `runSync`. `cascadeRepair` is exported from `apply.ts` for the launch recovery path in `SyncContext`.

**Tech Stack:** Expo SDK 54 / RN 0.81, node:test + tsx + better-sqlite3 (test-only). No new dependencies. No schema change (`SCHEMA_VERSION` stays 2).

## Global Constraints

- **Node 20+.** Verify every task with `npx tsc --noEmit` + `npm run lint` + `npm test`.
- **Baselines:** lint = 3 problems (0 errors, 3 warnings); tests = 68 passing (after Phase 4). New tests only add to the count.
- **Convergence is the bar.** `merge`/`apply` are commutative/idempotent. GC must not break that: a pruned tombstone whose live row still exists elsewhere is re-learned and re-applied idempotently. `gcTombstones` and the recovery path must not introduce a non-idempotent step.
- **`deleted_at`/`updated_at` are HLC strings; the physical component is ms-epoch** (`parseHlc(s).phys`). GC filters by parsed phys — NEVER by string compare across the whole HLC (the counter/device fields aren't date-ordered).
- **Credentials never touch backups or tombstones** — backups contain only domain data + sync columns; never `sync_state`, never credentials.
- **Backups replace all data on import** (existing contract: `resetDatabase()` first). Don't change that.
- **Testable cores are RN/expo-free.** `backup-core.ts`, `apply.ts`, `reconcile.ts`, `sync.ts` (the `gcTombstones`/`runSync` parts) must not statically import `react-native`/`expo-*` (the tsx test loader can't parse them). The RN wrappers (`backup.ts` file-IO, `SyncContext.tsx`) are tsc+lint+manual only.
- **Frozen engine semantics:** Phase 5 only adds GC + a flag + exports `cascadeRepair` + cleans up SELECTs/`live` sets + backup v3. It must NOT change merge/apply LWW behavior, tombstone competition, or reconcile adoption rules.

---

### Task 1: Engine polish — export `cascadeRepair`, build `live` sets from applied uuids, drop unused `updated_at` in reconcile

**Why:** `cascadeRepair` is needed by the Phase-5 recovery path (Task 3). The `live`-set and reconcile-SELECT cleanups are the carried-over Phase-2 Minors.

**Files:**
- Modify: `src/sync/apply.ts`
- Modify: `src/sync/reconcile.ts`
- Test: `src/sync/apply.test.ts` (add a direct `cascadeRepair` test)

**Interfaces:**
- Produces: `export async function cascadeRepair(db: CicadaDB): Promise<void>` (was private).
- `applyMerge` behavior unchanged externally (same `ApplyResult`).

- [ ] **Step 1: Write the failing test**

Add to `src/sync/apply.test.ts` (reuse its existing imports + `makeMigratedDb` from `./test-support/sqlite`):

```ts
import { cascadeRepair } from './apply';

test('cascadeRepair deletes assets whose account is absent and snapshots whose asset is absent', async () => {
  const { db, raw } = await makeMigratedDb();
  // account id 1 exists; asset 10 -> account 1 (ok); asset 11 -> account 99 (orphan)
  raw.prepare('INSERT INTO account (id, name, archived, uuid, updated_at) VALUES (1, ?, 0, ?, ?)').run('Cash', 'acc-1', '000000000000010-00000-aaaaaa');
  raw.prepare('INSERT INTO asset (id, account_id, name, categories, archived, uuid, updated_at) VALUES (10, 1, ?, ?, 0, ?, ?)').run('A', '{}', 'as-10', '000000000000010-00000-aaaaaa');
  raw.prepare('INSERT INTO asset (id, account_id, name, categories, archived, uuid, updated_at) VALUES (11, 99, ?, ?, 0, ?, ?)').run('Orphan', '{}', 'as-11', '000000000000010-00000-aaaaaa');
  raw.prepare('INSERT INTO asset_snapshot (asset_id, date, net_worth, inflow, profit, updated_at) VALUES (11, ?, 1, 0, 1, ?)').run('2026-01', '000000000000010-00000-aaaaaa');

  await cascadeRepair(db);

  const assets = await db.getAllAsync<{ id: number }>('SELECT id FROM asset ORDER BY id');
  assert.deepEqual(assets.map((a) => a.id), [10]); // orphan asset 11 gone
  const snaps = await db.getAllAsync<{ asset_id: number }>('SELECT asset_id FROM asset_snapshot');
  assert.equal(snaps.length, 0); // orphan snapshot gone with its asset
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `cascadeRepair` is not exported from `./apply`.

- [ ] **Step 3: Export `cascadeRepair` and clean up `live` sets in `src/sync/apply.ts`**

Change the `cascadeRepair` declaration from `async function cascadeRepair` to `export async function cascadeRepair` (signature unchanged).

In `applyMerge`, replace the `live` object construction so it uses the **actually-applied** uuids (the `accountId`/`assetId` Map keys), and tracks applied snapshot/tran uuids during their loops. Replace:

```ts
    const live = {
      account: new Set(merged.tables.account.map((r) => r.uuid)),
      asset: new Set(merged.tables.asset.map((r) => r.uuid)),
      snapshot: new Set(merged.tables.snapshot.map((r) => `${r.assetUuid}|${r.date}`)),
      tran: new Set(merged.tables.tran.map((r) => r.uuid)),
    };
```

with applied-uuid tracking. Add `const appliedSnapshot = new Set<string>();` and `const appliedTran = new Set<string>();`, populate them inside the existing snapshot/tran loops (only when actually upserted, i.e. after the orphan `continue` checks), then:

```ts
    const live = {
      account: new Set(accountId.keys()),
      asset: new Set(assetId.keys()),
      snapshot: appliedSnapshot,
      tran: appliedTran,
    };
```

Concretely, the snapshot loop becomes:
```ts
    for (const rec of merged.tables.snapshot) {
      const asId = assetId.get(rec.assetUuid);
      if (asId === undefined) continue; // orphan snapshot — skip
      await upsertSnapshot(db, rec, asId);
      appliedSnapshot.add(`${rec.assetUuid}|${rec.date}`);
    }
```
and the tran loop:
```ts
    for (const rec of merged.tables.tran) {
      await upsertTran(db, rec);
      appliedTran.add(rec.uuid);
    }
```
(`upsertSetting` loop is unchanged — settings aren't tombstoned.)

- [ ] **Step 4: Drop unused `updated_at` in `src/sync/reconcile.ts`**

In both `adoptAccountUuid` and `adoptAssetUuid`, the local SELECT fetches `updated_at` but never reads it. Change:
```ts
  const local = await db.getFirstAsync<{ id: number; uuid: string; updated_at: string }>(
    'SELECT id, uuid, updated_at FROM account WHERE name = ?',
    [rec.name]
  );
```
to:
```ts
  const local = await db.getFirstAsync<{ id: number; uuid: string }>(
    'SELECT id, uuid FROM account WHERE name = ?',
    [rec.name]
  );
```
and the analogous change in `adoptAssetUuid` (its SELECT is `... FROM asset WHERE account_id = ? AND name = ?`).

- [ ] **Step 5: Run to verify pass**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc clean; lint baseline (3 problems); tests green (69 total: 68 + 1). The pre-existing apply/convergence tests still pass (the `live`-set change is behavior-preserving — orphans were never inserted, so they were never truly "live").

- [ ] **Step 6: Commit**

```bash
git add src/sync/apply.ts src/sync/reconcile.ts src/sync/apply.test.ts
git commit -m "refactor(sync): export cascadeRepair, build live sets from applied uuids, drop unused reconcile SELECT field"
```

---

### Task 2: Tombstone GC

**Why:** Bound the tombstone set so the sync document doesn't grow with every lifetime delete.

**Files:**
- Modify: `src/sync/sync.ts` (add `gcTombstones`, `TOMBSTONE_RETENTION_DAYS`, call it at the end of `runSync`)
- Test: `src/sync/sync.test.ts` (add GC cases)

**Interfaces:**
- Consumes: `parseHlc` (hlc.ts), `CicadaDB`.
- Produces:
  - `export const TOMBSTONE_RETENTION_DAYS = 90`
  - `export async function gcTombstones(db: CicadaDB, nowMs: number, retentionDays?: number): Promise<number>` (returns rows pruned)
- `runSync` calls `gcTombstones(db, now(), TOMBSTONE_RETENTION_DAYS)` after a successful push (both seeded and merged paths).

- [ ] **Step 1: Write the failing tests**

Add to `src/sync/sync.test.ts` (reuse its helpers; `HLC(n, dev)` builds `<phys:15>-00000-<dev:6>` so `parseHlc(...).phys === n`):

```ts
import { gcTombstones, TOMBSTONE_RETENTION_DAYS } from './sync';
import { parseHlc } from './hlc';

const DAY_MS = 86_400_000;

test('gcTombstones prunes tombstones older than the retention window, keeps newer', async () => {
  const { db } = await makeMigratedDb();
  const nowMs = 1_000 * DAY_MS; // arbitrary "now" in ms
  const old = HLC(nowMs - 100 * DAY_MS, 'aaaaaa'); // 100d old -> pruned
  const fresh = HLC(nowMs - 10 * DAY_MS, 'aaaaaa'); // 10d old -> kept
  await db.runAsync('INSERT INTO tombstone (entity, uuid, deleted_at) VALUES (?, ?, ?)', ['tran', 't-old', old]);
  await db.runAsync('INSERT INTO tombstone (entity, uuid, deleted_at) VALUES (?, ?, ?)', ['tran', 't-new', fresh]);

  const pruned = await gcTombstones(db, nowMs, TOMBSTONE_RETENTION_DAYS);
  assert.equal(pruned, 1);
  const rows = await db.getAllAsync<{ uuid: string }>('SELECT uuid FROM tombstone ORDER BY uuid');
  assert.deepEqual(rows.map((r) => r.uuid), ['t-new']);
});

test('TOMBSTONE_RETENTION_DAYS is 90', () => {
  assert.equal(TOMBSTONE_RETENTION_DAYS, 90);
});

test('runSync prunes an old tombstone after a successful sync', async () => {
  const { db } = await makeMigratedDb();
  const nowMs = 1_000 * DAY_MS;
  const old = HLC(nowMs - 200 * DAY_MS, 'aaaaaa');
  await db.runAsync('INSERT INTO tombstone (entity, uuid, deleted_at) VALUES (?, ?, ?)', ['tran', 't-old', old]);
  const remote = makeFakeRemote();
  const { deps } = depsFor(db, remote, 'aaaaaa', nowMs);
  await runSync(deps);
  const rows = await db.getAllAsync<{ uuid: string }>('SELECT uuid FROM tombstone');
  assert.equal(rows.length, 0); // GC ran after the (seed) push
});
```

> Confirm `depsFor(db, remote, deviceId, now)` accepts a numeric `now` and that `runSync` uses `now()` — both already true from Phase 4 Task 3. The third test seeds an empty remote (so it takes the `seeded` path); GC must run there too.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — `gcTombstones`/`TOMBSTONE_RETENTION_DAYS` not exported; the runSync GC test fails (no pruning yet).

- [ ] **Step 3: Implement in `src/sync/sync.ts`**

Add `parseHlc` to the hlc import (`import { compareHlc, parseHlc } from './hlc';`). Add near the top:

```ts
export const TOMBSTONE_RETENTION_DAYS = 90;
const DAY_MS = 86_400_000;

/** Prune tombstones whose deletion is older than the retention window. Age is
 *  read from the HLC physical component (ms-epoch). Returns rows pruned. */
export async function gcTombstones(
  db: CicadaDB,
  nowMs: number,
  retentionDays: number = TOMBSTONE_RETENTION_DAYS
): Promise<number> {
  const cutoff = nowMs - retentionDays * DAY_MS;
  const rows = await db.getAllAsync<{ entity: string; uuid: string; deleted_at: string }>(
    'SELECT entity, uuid, deleted_at FROM tombstone'
  );
  let pruned = 0;
  for (const r of rows) {
    if (parseHlc(r.deleted_at).phys < cutoff) {
      await db.runAsync('DELETE FROM tombstone WHERE entity = ? AND uuid = ?', [r.entity, r.uuid]);
      pruned++;
    }
  }
  return pruned;
}
```

> Filter in JS (parse each `deleted_at`) rather than in SQL — SQLite can't parse the fixed-width HLC's phys field with a portable expression, and the tombstone set is small.

In `runSync`, call GC after each successful push. In the **seeded** path, before `return { status: 'seeded', suffixed: [] };`:
```ts
      await gcTombstones(db, now());
```
In the **merged** path, after `await setState(LAST_SYNCED_KEY, String(now()));` and before `return { status: 'merged', suffixed: applied.suffixed };`:
```ts
      await gcTombstones(db, now());
```

- [ ] **Step 4: Run to verify pass**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc clean; lint baseline; tests green (72 total: 69 + 3).

- [ ] **Step 5: Commit**

```bash
git add src/sync/sync.ts src/sync/sync.test.ts
git commit -m "feat(sync): 90-day tombstone GC, pruned after each successful sync"
```

---

### Task 3: `sync-in-progress` crash-recovery flag

**Why:** Tauri's apply is non-atomic; a crash mid-apply can leave a partially-merged DB. The flag lets the next launch repair + reconcile.

**Files:**
- Modify: `src/sync/sync.ts` (set/clear `sync_in_progress` around `applyMerge` in `runSync`; export the key)
- Modify: `src/hooks/SyncContext.tsx` (launch recovery: if flag set, `cascadeRepair` + clear, then sync)
- Test: `src/sync/sync.test.ts` (flag is cleared after a successful merge sync; set during a failed push)

**Interfaces:**
- Consumes: `cascadeRepair` (apply.ts, exported in Task 1), `getDatabase` (db/database.ts), `getSyncState`/`setSyncState` (sync-state-repo.ts), `isSyncAvailable`.
- Produces: `export const SYNC_IN_PROGRESS_KEY = 'sync_in_progress'`.

- [ ] **Step 1: Write the failing tests**

Add to `src/sync/sync.test.ts`:

```ts
import { SYNC_IN_PROGRESS_KEY } from './sync';
import { ConflictError } from './providers/types';

test('runSync clears sync_in_progress after a successful merge', async () => {
  const { db } = await makeMigratedDb();
  await addAccount(db, 'acc-a', 'Cash', HLC(10, 'aaaaaa'));
  const remote = makeFakeRemote();
  // seed remote with a different account so we take the merge path (not seed)
  const seedDoc = {
    syncFormatVersion: 1, enc: 'none', schemaVersion: 2, generatedAt: 'x', generatedBy: 'b',
    tables: { account: [{ uuid: 'acc-b', name: 'Brokerage', archived: 0, updated_at: HLC(11, 'bbbbbb') }], asset: [], snapshot: [], tran: [], setting: [] },
    tombstones: [],
  };
  remote._seed(JSON.stringify(seedDoc));
  const { deps } = depsFor(db, remote, 'aaaaaa');
  await runSync(deps);
  const flag = await deps.getState(SYNC_IN_PROGRESS_KEY);
  assert.equal(flag, '0');
});

test('runSync leaves sync_in_progress set when the push ultimately fails', async () => {
  const { db } = await makeMigratedDb();
  await addAccount(db, 'acc-a', 'Cash', HLC(10, 'aaaaaa'));
  const remote = makeFakeRemote();
  remote._seed(JSON.stringify({
    syncFormatVersion: 1, enc: 'none', schemaVersion: 2, generatedAt: 'x', generatedBy: 'b',
    tables: { account: [], asset: [], snapshot: [], tran: [], setting: [] }, tombstones: [],
  }));
  // every ifMatch write throws ConflictError -> retries exhausted -> runSync throws
  remote.write = async () => { throw new ConflictError(); };
  const { deps } = depsFor(db, remote, 'aaaaaa');
  await assert.rejects(() => runSync({ ...deps, maxRetries: 1 }));
  const flag = await deps.getState(SYNC_IN_PROGRESS_KEY);
  assert.equal(flag, '1'); // left set so the next launch recovers
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — `SYNC_IN_PROGRESS_KEY` not exported; flag never set/cleared.

- [ ] **Step 3: Implement the flag in `src/sync/sync.ts`**

Add near `LAST_SYNCED_KEY`:
```ts
export const SYNC_IN_PROGRESS_KEY = 'sync_in_progress';
```

In `runSync`'s merge loop, set the flag immediately before `applyMerge` and clear it after a successful push. Concretely, inside the `for` loop, before `const merged = merge(...)`:
```ts
    await deps.setState(SYNC_IN_PROGRESS_KEY, '1');
```
and in the success branch, alongside the existing `setState(LAST_SYNCED_KEY, ...)`:
```ts
      await setState(LAST_SYNCED_KEY, String(now()));
      await deps.setState(SYNC_IN_PROGRESS_KEY, '0');
      await gcTombstones(db, now());
      return { status: 'merged', suffixed: applied.suffixed };
```
(The flag is set every loop iteration before apply, and cleared only on success; if all retries throw, it stays `'1'`. The seeded path does no apply, so it neither sets nor needs to clear it — but for cleanliness leave the seeded path unchanged.)

> `setState` is already destructured from `deps` in `runSync`; use it directly (don't add `deps.` if the local `setState` is in scope — match the existing code in the file).

- [ ] **Step 4: Add launch recovery to `src/hooks/SyncContext.tsx`**

Add imports:
```tsx
import { getDatabase } from '../db/database';
import { getSyncState, setSyncState } from '../sync/sync-state-repo';
import { cascadeRepair } from '../sync/apply';
import { SYNC_IN_PROGRESS_KEY } from '../sync/sync';
```

In the launch `useEffect` (the one guarded by `if (!available) return;` that calls `refreshMeta()` then `doSync()`), run recovery first:
```tsx
  useEffect(() => {
    if (!available) return;
    (async () => {
      // Crash recovery: a set flag means a prior apply was interrupted
      // (Tauri non-atomic). Repair orphans, clear the flag, then sync normally.
      try {
        if ((await getSyncState(SYNC_IN_PROGRESS_KEY)) === '1') {
          const db = await getDatabase();
          await cascadeRepair(db);
          await setSyncState(SYNC_IN_PROGRESS_KEY, '0');
        }
      } catch {
        // recovery is best-effort; never block startup
      }
      await refreshMeta();
      await doSync();
    })();
  }, [available, refreshMeta, doSync]);
```

- [ ] **Step 5: Run to verify pass**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc clean; lint baseline; tests green (74 total: 72 + 2).

> If `npm test` fails to load `sync.test.ts` because importing `./sync` now pulls RN in via the SyncContext-only modules — it does NOT: `sync.ts` still imports `cascadeRepair` only as a value used by `runSync`? No — `runSync` does not use `cascadeRepair`; only `SyncContext` does. Do not add a `cascadeRepair` import to `sync.ts`. Keep `sync.ts` RN-free (its wrappers already use dynamic `import()`).

- [ ] **Step 6: Commit**

```bash
git add src/sync/sync.ts src/hooks/SyncContext.tsx src/sync/sync.test.ts
git commit -m "feat(sync): sync-in-progress flag + launch cascade-repair recovery"
```

---

### Task 4: Backup v3 (testable core + legacy backfill)

**Why:** A v2 restore leaves NULL `uuid`/`updated_at` → broken sync. v3 carries and restores sync identity (and tombstones); legacy restores backfill fresh identity.

**Files:**
- Create: `src/services/backup-core.ts` (pure build/parse/restore — NO RN/expo imports)
- Test: `src/services/backup-core.test.ts`
- Modify: `src/services/backup.ts` (delegate to the core; keep file-IO wrappers)

**Interfaces:**
- Consumes: `CicadaDB`, `parseHlc`? no — `genUuid` is via raw SQL; `tick` is injected by the caller as `freshStamp`.
- Produces (in `backup-core.ts`):
  - `BACKUP_VERSION = 3` and the v3 + legacy types
  - `buildBackupDoc(db: CicadaDB, exportedAt: string): Promise<BackupFile>`
  - `parseBackup(content: string): BackupFile`
  - `restoreBackupDoc(db: CicadaDB, parsed: BackupFile, opts: { freshStamp: string }): Promise<ImportCounts>`
  - `ImportCounts` type
- `backup.ts` re-exports/uses these; `exportBackup`/`importBackup` keep their current signatures.

- [ ] **Step 1: Write the failing tests**

Create `src/services/backup-core.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert';
import { makeMigratedDb } from '../sync/test-support/sqlite';
import { buildBackupDoc, parseBackup, restoreBackupDoc, BACKUP_VERSION } from './backup-core';

const STAMP = '000000000000123-00000-aaaaaa';

async function seed(db: any) {
  await db.runAsync('INSERT INTO account (id, name, archived, uuid, updated_at) VALUES (1, ?, 0, ?, ?)', ['Cash', 'acc-1', STAMP]);
  await db.runAsync('INSERT INTO asset (id, account_id, name, categories, archived, uuid, updated_at) VALUES (10, 1, ?, ?, 0, ?, ?)', ['Checking', '{}', 'as-10', STAMP]);
  await db.runAsync('INSERT INTO asset_snapshot (asset_id, date, net_worth, inflow, profit, updated_at) VALUES (10, ?, 100, 0, 0, ?)', ['2026-01', STAMP]);
  await db.runAsync('INSERT INTO tran (id, date, type, value, cat, note, uuid, updated_at) VALUES (1, ?, ?, 5, ?, ?, ?, ?)', ['2026-01-02', 'expense', 'food', '', 'tr-1', STAMP]);
  await db.runAsync('INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)', ['currency', '$', STAMP]);
  await db.runAsync('INSERT INTO tombstone (entity, uuid, deleted_at) VALUES (?, ?, ?)', ['tran', 'tr-deleted', STAMP]);
}

test('v3 build is version 3 and carries uuid/updated_at/tombstones', async () => {
  const { db } = await makeMigratedDb();
  await seed(db);
  const doc = await buildBackupDoc(db, '2026-06-21T00:00:00Z');
  assert.equal(doc.version, BACKUP_VERSION);
  assert.equal(doc.version, 3);
  assert.equal(doc.accounts[0].uuid, 'acc-1');
  assert.equal(doc.accounts[0].updated_at, STAMP);
  assert.equal(doc.tombstones.length, 1);
  assert.equal(doc.tombstones[0].uuid, 'tr-deleted');
  assert.equal(doc.settings[0].key, 'currency');
  assert.equal(doc.settings[0].updated_at, STAMP);
});

test('v3 round-trip: build -> parse -> restore preserves sync identity', async () => {
  const { db: src } = await makeMigratedDb();
  await seed(src);
  const json = JSON.stringify(await buildBackupDoc(src, '2026-06-21T00:00:00Z'));

  const { db: dst } = await makeMigratedDb();
  const counts = await restoreBackupDoc(dst, parseBackup(json), { freshStamp: 'unused-for-v3' });
  assert.deepEqual(counts, { accounts: 1, assets: 1, snapshots: 1, transactions: 1 });
  const acc = await dst.getFirstAsync<{ uuid: string; updated_at: string }>('SELECT uuid, updated_at FROM account WHERE id = 1');
  assert.equal(acc!.uuid, 'acc-1');
  assert.equal(acc!.updated_at, STAMP);
  const tomb = await dst.getAllAsync<{ uuid: string }>('SELECT uuid FROM tombstone');
  assert.deepEqual(tomb.map((t) => t.uuid), ['tr-deleted']);
});

test('legacy v2 restore backfills non-NULL uuid/updated_at and restores no tombstones', async () => {
  const v2 = JSON.stringify({
    version: 2,
    exportedAt: '2026-01-01T00:00:00Z',
    accounts: [{ id: 1, name: 'Cash', archived: 0 }],
    assets: [{ id: 10, accountId: 1, name: 'Checking', categories: '{}', archived: 0 }],
    snapshots: [{ assetId: 10, date: '2026-01', netWorth: 100, inflow: 0, profit: 0 }],
    transactions: [{ id: 1, date: '2026-01-02', type: 'expense', value: 5, cat: 'food', note: '' }],
    settings: { currency: '$' },
  });
  const { db } = await makeMigratedDb();
  await restoreBackupDoc(db, parseBackup(v2), { freshStamp: STAMP });
  const acc = await db.getFirstAsync<{ uuid: string; updated_at: string }>('SELECT uuid, updated_at FROM account WHERE id = 1');
  assert.ok(acc!.uuid && acc!.uuid.length === 32, 'fresh uuid backfilled');
  assert.equal(acc!.updated_at, STAMP);
  const tran = await db.getFirstAsync<{ uuid: string }>('SELECT uuid FROM tran WHERE id = 1');
  assert.ok(tran!.uuid && tran!.uuid.length === 32, 'fresh tran uuid backfilled');
  const tomb = await db.getAllAsync('SELECT * FROM tombstone');
  assert.equal(tomb.length, 0);
});

test('parseBackup rejects version > 3', () => {
  assert.throws(() => parseBackup(JSON.stringify({ version: 4, accounts: [], assets: [], snapshots: [], transactions: [] })));
});
```

> The harness `makeMigratedDb()` returns `{ db, raw }` — destructure. `restoreBackupDoc` here is called on an already-migrated empty harness DB; it does NOT call `resetDatabase()` (that stays in `backup.ts`'s `importBackup` wrapper, which is RN-bound). So `restoreBackupDoc` assumes a clean target DB and just INSERTs + backfills.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — `./backup-core` does not exist.

- [ ] **Step 3: Implement `src/services/backup-core.ts`**

Pure module — imports ONLY `CicadaDB`. Settings are read with `updated_at`; legacy backfill uses raw `randomblob` + the injected `freshStamp`.

```ts
import type { CicadaDB } from '../db/migrations';

export const BACKUP_VERSION = 3;

export type BackupAccount = { id: number; name: string; archived?: number; uuid?: string; updated_at?: string };
export type BackupAsset = { id: number; accountId: number; name: string; categories: string; archived?: number; uuid?: string; updated_at?: string };
export type BackupSnapshot = { assetId: number; date: string; netWorth: number; inflow: number; profit: number; updated_at?: string };
export type BackupTran = { id: number; date: string; type: string; value: number; cat: string; note: string; uuid?: string; updated_at?: string };
export type BackupSettingV3 = { key: string; value: string; updated_at: string };
export type BackupTombstone = { entity: string; uuid: string; deleted_at: string };

export type BackupFile = {
  version: number;
  exportedAt: string;
  accounts: BackupAccount[];
  assets: BackupAsset[];
  snapshots: BackupSnapshot[];
  transactions: BackupTran[];
  // v3: array form; v1/v2: Record<string,string>
  settings: BackupSettingV3[] | Record<string, string>;
  tombstones?: BackupTombstone[];
};

export type ImportCounts = { accounts: number; assets: number; snapshots: number; transactions: number };

export async function buildBackupDoc(db: CicadaDB, exportedAt: string): Promise<BackupFile> {
  const accounts = await db.getAllAsync<{ id: number; name: string; archived: number; uuid: string; updated_at: string }>(
    'SELECT id, name, archived, uuid, updated_at FROM account'
  );
  const assets = await db.getAllAsync<{ id: number; account_id: number; name: string; categories: string; archived: number; uuid: string; updated_at: string }>(
    'SELECT id, account_id, name, categories, archived, uuid, updated_at FROM asset'
  );
  const snapshots = await db.getAllAsync<{ asset_id: number; date: string; net_worth: number; inflow: number; profit: number; updated_at: string }>(
    'SELECT asset_id, date, net_worth, inflow, profit, updated_at FROM asset_snapshot'
  );
  const transactions = await db.getAllAsync<BackupTran>(
    'SELECT id, date, type, value, cat, note, uuid, updated_at FROM tran'
  );
  const settingsRaw = await db.getAllAsync<{ key: string; value: string; updated_at: string }>(
    'SELECT key, value, updated_at FROM setting'
  );
  const tombstones = await db.getAllAsync<BackupTombstone>(
    'SELECT entity, uuid, deleted_at FROM tombstone'
  );

  return {
    version: BACKUP_VERSION,
    exportedAt,
    accounts: accounts.map((a) => ({ id: a.id, name: a.name, archived: a.archived, uuid: a.uuid, updated_at: a.updated_at })),
    assets: assets.map((a) => ({ id: a.id, accountId: a.account_id, name: a.name, categories: a.categories, archived: a.archived, uuid: a.uuid, updated_at: a.updated_at })),
    snapshots: snapshots.map((s) => ({ assetId: s.asset_id, date: s.date, netWorth: s.net_worth, inflow: s.inflow, profit: s.profit, updated_at: s.updated_at })),
    transactions,
    settings: settingsRaw.map((s) => ({ key: s.key, value: s.value, updated_at: s.updated_at })),
    tombstones,
  };
}

function validateBackup(obj: unknown): obj is BackupFile {
  if (!obj || typeof obj !== 'object') return false;
  const o = obj as Record<string, unknown>;
  if (typeof o.version !== 'number') return false;
  if (!Array.isArray(o.accounts)) return false;
  if (!Array.isArray(o.assets)) return false;
  if (!Array.isArray(o.snapshots)) return false;
  if (!Array.isArray(o.transactions)) return false;
  return true;
}

export function parseBackup(content: string): BackupFile {
  const parsed: unknown = JSON.parse(content);
  if (!validateBackup(parsed)) throw new Error('Invalid backup file format');
  if (parsed.version > BACKUP_VERSION) throw new Error(`Unsupported backup version: ${parsed.version}`);
  return parsed;
}

export async function restoreBackupDoc(
  db: CicadaDB,
  parsed: BackupFile,
  opts: { freshStamp: string }
): Promise<ImportCounts> {
  const v = parsed.version;
  await db.withTransactionAsync(async () => {
    for (const acc of parsed.accounts) {
      const archived = v < 2 ? 0 : acc.archived ?? 0;
      if (v >= 3 && acc.uuid) {
        await db.runAsync('INSERT INTO account (id, name, archived, uuid, updated_at) VALUES (?, ?, ?, ?, ?)',
          [acc.id, acc.name, archived, acc.uuid, acc.updated_at ?? opts.freshStamp]);
      } else {
        await db.runAsync('INSERT INTO account (id, name, archived) VALUES (?, ?, ?)', [acc.id, acc.name, archived]);
      }
    }
    for (const a of parsed.assets) {
      const archived = v < 2 ? 0 : a.archived ?? 0;
      if (v >= 3 && a.uuid) {
        await db.runAsync('INSERT INTO asset (id, account_id, name, categories, archived, uuid, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [a.id, a.accountId, a.name, a.categories ?? '{}', archived, a.uuid, a.updated_at ?? opts.freshStamp]);
      } else {
        await db.runAsync('INSERT INTO asset (id, account_id, name, categories, archived) VALUES (?, ?, ?, ?, ?)',
          [a.id, a.accountId, a.name, a.categories ?? '{}', archived]);
      }
    }
    for (const s of parsed.snapshots) {
      if (v >= 3 && s.updated_at) {
        await db.runAsync('INSERT INTO asset_snapshot (asset_id, date, net_worth, inflow, profit, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
          [s.assetId, s.date, s.netWorth, s.inflow, s.profit, s.updated_at]);
      } else {
        await db.runAsync('INSERT INTO asset_snapshot (asset_id, date, net_worth, inflow, profit) VALUES (?, ?, ?, ?, ?)',
          [s.assetId, s.date, s.netWorth, s.inflow, s.profit]);
      }
    }
    for (const t of parsed.transactions) {
      if (v >= 3 && t.uuid) {
        await db.runAsync('INSERT INTO tran (id, date, type, value, cat, note, uuid, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [t.id, t.date, t.type, t.value, t.cat ?? '', t.note ?? '', t.uuid, t.updated_at ?? opts.freshStamp]);
      } else {
        await db.runAsync('INSERT INTO tran (id, date, type, value, cat, note) VALUES (?, ?, ?, ?, ?, ?)',
          [t.id, t.date, t.type, t.value, t.cat ?? '', t.note ?? '']);
      }
    }

    // Settings: v3 = array with updated_at; v1/v2 = Record (no updated_at).
    if (Array.isArray(parsed.settings)) {
      for (const s of parsed.settings) {
        await db.runAsync(
          `INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
          [s.key, String(s.value), s.updated_at ?? opts.freshStamp]
        );
      }
    } else if (parsed.settings) {
      for (const [key, value] of Object.entries(parsed.settings)) {
        await db.runAsync(
          `INSERT INTO setting (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          [key, String(value)]
        );
      }
    }

    // v3 tombstones travel verbatim.
    if (v >= 3 && parsed.tombstones) {
      for (const t of parsed.tombstones) {
        await db.runAsync(
          `INSERT INTO tombstone (entity, uuid, deleted_at) VALUES (?, ?, ?)
           ON CONFLICT(entity, uuid) DO UPDATE SET deleted_at = MAX(deleted_at, excluded.deleted_at)`,
          [t.entity, t.uuid, t.deleted_at]
        );
      }
    }

    // Legacy backfill: any NULL sync identity becomes fresh, sync-capable data.
    await db.runAsync(`UPDATE account SET uuid = lower(hex(randomblob(16))) WHERE uuid IS NULL`);
    await db.runAsync(`UPDATE asset   SET uuid = lower(hex(randomblob(16))) WHERE uuid IS NULL`);
    await db.runAsync(`UPDATE tran    SET uuid = lower(hex(randomblob(16))) WHERE uuid IS NULL`);
    await db.runAsync(`UPDATE account        SET updated_at = ? WHERE updated_at IS NULL`, [opts.freshStamp]);
    await db.runAsync(`UPDATE asset          SET updated_at = ? WHERE updated_at IS NULL`, [opts.freshStamp]);
    await db.runAsync(`UPDATE asset_snapshot SET updated_at = ? WHERE updated_at IS NULL`, [opts.freshStamp]);
    await db.runAsync(`UPDATE tran           SET updated_at = ? WHERE updated_at IS NULL`, [opts.freshStamp]);
    await db.runAsync(`UPDATE setting        SET updated_at = ? WHERE updated_at IS NULL`, [opts.freshStamp]);
  });

  return {
    accounts: parsed.accounts.length,
    assets: parsed.assets.length,
    snapshots: parsed.snapshots.length,
    transactions: parsed.transactions.length,
  };
}
```

> The backfill `UPDATE`s are idempotent and cover the legacy path (and any v3 row that somehow lacked a stamp). On a pure v3 restore they touch nothing (all non-NULL). This mirrors the v2 migration's backfill exactly.

- [ ] **Step 4: Run to verify the core tests pass**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; the 5 new `backup-core` tests pass (79 total: 74 after Task 3 + 5 new). Report the actual `npm test` total.

- [ ] **Step 5: Rewire `src/services/backup.ts` to use the core**

Replace the in-file `BACKUP_VERSION`, the `Backup*` types, `buildBackup`, `validateBackup`, `parseBackup`, and `restoreBackup` with imports from `./backup-core`, keeping ONLY the RN/expo file-IO and the public `exportBackup`/`importBackup`. The new top of the file:

```ts
import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';

import { getDatabase, resetDatabase } from '../db/database';
import { tick } from '../sync/clock';
import { buildBackupDoc, parseBackup, restoreBackupDoc, type ImportCounts } from './backup-core';
```

`exportBackup` builds via the core:
```ts
export async function exportBackup(): Promise<void> {
  const db = await getDatabase();
  const backup = await buildBackupDoc(db, new Date().toISOString());
  const json = JSON.stringify(backup, null, 2);
  // …unchanged filename + web download / native share…
}
```

`importBackup` resets, then restores via the core with a fresh stamp for the legacy path:
```ts
export async function importBackup(): Promise<ImportCounts> {
  // …unchanged platform file-pick into `content`…
  const parsed = parseBackup(content);
  await resetDatabase();
  const db = await getDatabase();
  const freshStamp = await tick();
  return restoreBackupDoc(db, parsed, { freshStamp });
}
```

> Keep `downloadJsonWeb`/`pickJsonWeb`/the native `File`/`Sharing`/`DocumentPicker` code exactly as-is. Only the serialize/restore calls change. `resetDatabase()` moves OUT of the core and stays in `importBackup` (it's RN-bound and the core must stay testable).

- [ ] **Step 6: Run full verification**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc clean; lint baseline (watch for unused imports left behind in backup.ts); all tests green.

- [ ] **Step 7: Commit**

```bash
git add src/services/backup-core.ts src/services/backup-core.test.ts src/services/backup.ts
git commit -m "feat(backup): v3 carries uuid/updated_at/tombstones; legacy restores backfill fresh identity"
```

---

## Manual end-to-end verification (developer, after all tasks)

1. **v3 round-trip across devices:** on device A (connected to 坚果云), add data, **Export**. On device B, **Import** the file → connect B to the same account → **Sync now** on both → confirm identical state and NO duplicate/resurrected rows (uuid identity carried, so merge updates rather than duplicates).
2. **Delete survives restore:** delete an asset on A, export, import on a fresh install, sync → the deleted asset stays deleted (tombstone carried).
3. **Legacy import:** import an old v2 backup → app works; rows get fresh uuids; a subsequent sync treats them as new data (no NULL-identity crash).
4. **GC:** (hard to observe in 90 days) — trust the unit test; optionally temporarily set retention low in a scratch build to watch pruning.
5. **Crash recovery:** on desktop, kill the app mid-sync (or manually set `sync_in_progress=1` in `sync_state`), relaunch → app repairs orphans, clears the flag, and the next sync converges.

## What this completes

Phase 5 is the final phase. After merge, cloud sync is feature-complete for v1: HLC + schema v2 (P1), engine (P2), WebDAV provider + platform wiring (P3), orchestration + UI (P4), and backup v3 + GC + recovery + polish (P5). Deferred beyond v1 (unchanged): at-rest encryption (`enc` envelope reserved), S3/R2 provider, web/PWA sync, device-registry GC horizon.

## Self-review notes

- **Spec coverage (Phase 5 design):** backup v3 build/parse/restore + legacy backfill → Task 4; tombstone GC (90d, after push, by parsed phys) → Task 2; sync-in-progress flag + launch recovery via exported `cascadeRepair` → Tasks 1+3; Phase-2 Minors (reconcile SELECT, `live` sets) → Task 1; suffix re-stamp → documented in the spec (no code). 
- **Type consistency:** `cascadeRepair` exported in Task 1, consumed in Task 3. `gcTombstones`/`TOMBSTONE_RETENTION_DAYS` (Task 2) and `SYNC_IN_PROGRESS_KEY` (Task 3) defined in sync.ts and consumed by tests/SyncContext. `buildBackupDoc`/`parseBackup`/`restoreBackupDoc`/`BackupFile`/`ImportCounts` defined in Task 4 core and consumed by backup.ts.
- **Testability honesty:** the engine/GC/core tasks are unit-tested with the better-sqlite3 harness (RN-free modules). `backup.ts` file-IO and `SyncContext.tsx` recovery are tsc+lint + the manual checklist — no fabricated RN tests. `backup-core.ts` is the extraction that makes backup logic testable at all.
- **Convergence/idempotency preserved:** GC only deletes already-propagated old tombstones (re-learnable, idempotent); the recovery path runs `cascadeRepair` (idempotent) + an idempotent re-sync; the suffix re-stamp was deliberately NOT changed precisely to keep apply idempotent. No LWW/merge/reconcile semantics changed.
- **Test-count progression** stated per task is approximate (68 → 69 → 72 → 74 → +5); the implementer should report the actual `npm test` total and confirm it only ever increases.
