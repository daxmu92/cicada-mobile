# Cloud Sync: Deletion Propagation & Sync Timing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "reset", "import backup", and "load sample" propagate deletions to the cloud (so old data stops resurrecting), and sync automatically a few seconds after edits settle.

**Architecture:** A local wipe currently produces no tombstones, so `merge()` re-pulls cloud data. Introduce a stamp-injectable `eraseAllData()` that records tombstones for every live row *then* deletes the rows (keeping `sync_state` + `tombstone`), wrapped in a pre-sync → erase → post-sync flow so tombstones out-stamp the cloud and propagate to other devices. Import re-stamps its records fresh so the backup wins. Sync timing gains a pure debouncer wired into `SyncContext` plus a background-flush trigger.

**Tech Stack:** TypeScript, Expo / React Native, expo-sqlite (+ better-sqlite3 in tests), HLC + LWW merge engine, `node --import tsx --test`.

## Global Constraints

- Node 20+. Verify every task with `npx tsc --noEmit` and `npm run lint` (both must be clean; one pre-existing `array-type` warning in `snapshot-repo.ts:203` is acceptable and unrelated).
- Unit tests run via `node --import tsx --test <file>`; every new `*.test.ts` MUST be added to the `test` script in `package.json`.
- `tick`/`recordTombstones`/`getSyncState` resolve the **global** `getDatabase()`, which is NOT wired to the in-memory test DB. Therefore any logic a test must exercise takes an **injected** `tick: () => Promise<string>` (mirror `runSync`'s `deps`). Never call the global `tick()` from code a unit test drives.
- Snapshot tombstone key is the composite string `"<assetUuid>|<date>"` (see `snapshot-repo.ts` / `merge.ts:13`).
- `merge.ts:73` intentionally does NOT tombstone settings. Do not change that. "Delete settings" is implemented as reset-to-defaults (LWW writes), never as setting tombstones.
- Tombstone insert SQL is always `INSERT ... ON CONFLICT(entity, uuid) DO UPDATE SET deleted_at = MAX(deleted_at, excluded.deleted_at)`.
- HLC test literal helper: `const HLC = (n, dev) => \`${String(n).padStart(15,'0')}-00000-${dev.padStart(6,'0')}\``.
- Commit after each task. End commit messages with the `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.

---

## File Structure

- `src/sync/stamp.ts` (modify) — split out `recordTombstonesAt(db, entity, uuids, deletedAt)` (stamp-injected core); keep `recordTombstones` as the `tick()`-calling wrapper.
- `src/sync/erase.ts` (create) — `eraseAllData(db, { tick })`: tombstone all live rows + delete data rows.
- `src/sync/erase.test.ts` (create) — unit tests for `eraseAllData`.
- `src/sync/sync.test.ts` (modify) — add deletion-propagation scenario tests.
- `src/services/backup-core.ts` (modify) — `restoreBackupDoc` gains `restamp?: boolean`.
- `src/services/backup-core.test.ts` (modify) — restamp test.
- `src/services/backup.ts` (modify) — `importBackup` = erase + restore(restamp) + post-sync.
- `src/services/sample-data.ts` (modify) — `loadSampleData` = erase + seed + post-sync.
- `src/services/erase-data.ts` (create) — `eraseAllDataAndSync({ resetSettings })` orchestration (pre/post sync, settings reset).
- `app/modals/erase-data.tsx` (create) — confirmation modal with the "also reset settings" toggle.
- `app/_layout.tsx` (modify) — register the `erase-data` modal route.
- `app/(tabs)/settings.tsx` (modify) — point the destructive "reset" action at the modal.
- `src/sync/debounce.ts` (create) — pure `createDebouncer({ delayMs, maxWaitMs }, flush)`.
- `src/sync/debounce.test.ts` (create) — debouncer unit tests (fake clock).
- `src/sync/dirty.ts` (create) — `bumpDirty()` + `subscribeDirty(cb)` event bus.
- `src/db/{account,asset,snapshot,tran}-repo.ts` + `src/db/setting-repo.ts` (modify) — call `bumpDirty()` after mutations.
- `src/hooks/SyncContext.tsx` (modify) — wire debouncer + background-flush.

---

## Task 1: Split `recordTombstonesAt` out of `recordTombstones`

**Files:**
- Modify: `src/sync/stamp.ts`
- Test: `src/sync/stamp.test.ts` (create)

**Interfaces:**
- Produces: `recordTombstonesAt(db: CicadaDB, entity: Entity, uuids: string[], deletedAt: string): Promise<void>` and unchanged `recordTombstones(db, entity, uuids): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `src/sync/stamp.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert';
import { makeMigratedDb } from './test-support/sqlite';
import { recordTombstonesAt } from './stamp';

const HLC = (n: number, dev: string) => `${String(n).padStart(15, '0')}-00000-${dev.padStart(6, '0')}`;

test('recordTombstonesAt writes a tombstone per uuid at the given stamp', async () => {
  const { db } = await makeMigratedDb();
  await recordTombstonesAt(db, 'account', ['u1', 'u2'], HLC(5, 'aaaaaa'));
  const rows = await db.getAllAsync<{ entity: string; uuid: string; deleted_at: string }>(
    'SELECT entity, uuid, deleted_at FROM tombstone ORDER BY uuid'
  );
  assert.deepEqual(rows.map((r) => r.uuid), ['u1', 'u2']);
  assert.equal(rows[0].deleted_at, HLC(5, 'aaaaaa'));
});

test('recordTombstonesAt keeps the MAX deleted_at on conflict', async () => {
  const { db } = await makeMigratedDb();
  await recordTombstonesAt(db, 'tran', ['t1'], HLC(9, 'aaaaaa'));
  await recordTombstonesAt(db, 'tran', ['t1'], HLC(3, 'aaaaaa')); // older -> ignored
  const row = await db.getFirstAsync<{ deleted_at: string }>(
    "SELECT deleted_at FROM tombstone WHERE entity='tran' AND uuid='t1'"
  );
  assert.equal(row!.deleted_at, HLC(9, 'aaaaaa'));
});

test('recordTombstonesAt is a no-op for an empty uuid list', async () => {
  const { db } = await makeMigratedDb();
  await recordTombstonesAt(db, 'asset', [], HLC(1, 'aaaaaa'));
  const rows = await db.getAllAsync('SELECT 1 FROM tombstone');
  assert.equal(rows.length, 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test src/sync/stamp.test.ts`
Expected: FAIL — `recordTombstonesAt` is not exported.

- [ ] **Step 3: Refactor `stamp.ts`**

Replace the body of `recordTombstones` (lines 29–43) with:

```ts
/**
 * Record tombstones at a caller-supplied HLC stamp. All uuids share `deletedAt`
 * (one logical deletion). For snapshots the `uuid` is the composite key
 * "<assetUuid>|<date>".
 */
export async function recordTombstonesAt(
  db: CicadaDB,
  entity: Entity,
  uuids: string[],
  deletedAt: string
): Promise<void> {
  for (const uuid of uuids) {
    await db.runAsync(
      `INSERT INTO tombstone (entity, uuid, deleted_at) VALUES (?, ?, ?)
         ON CONFLICT(entity, uuid) DO UPDATE SET deleted_at = MAX(deleted_at, excluded.deleted_at)`,
      [entity, uuid, deletedAt]
    );
  }
}

/** Record tombstones for a delete, minting one fresh HLC for the group. */
export async function recordTombstones(
  db: CicadaDB,
  entity: Entity,
  uuids: string[]
): Promise<void> {
  if (uuids.length === 0) return;
  const deletedAt = await tick();
  await recordTombstonesAt(db, entity, uuids, deletedAt);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test src/sync/stamp.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the test file to `package.json` and verify**

In `package.json`, append `src/sync/stamp.test.ts` to the `test` script's file list. Then:
Run: `npx tsc --noEmit && npm run lint`
Expected: tsc clean; lint clean (only the known `snapshot-repo.ts` warning).

- [ ] **Step 6: Commit**

```bash
git add src/sync/stamp.ts src/sync/stamp.test.ts package.json
git commit -m "refactor(sync): split recordTombstonesAt for stamp injection

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `eraseAllData` core

**Files:**
- Create: `src/sync/erase.ts`
- Test: `src/sync/erase.test.ts`

**Interfaces:**
- Consumes: `recordTombstonesAt` (Task 1).
- Produces: `eraseAllData(db: CicadaDB, deps: { tick: () => Promise<string> }): Promise<void>` — tombstones every live account/asset/snapshot/tran row at one fresh stamp, then deletes those data rows. Leaves `setting`, `sync_state`, and `tombstone` tables intact.

- [ ] **Step 1: Write the failing test**

Create `src/sync/erase.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert';
import { makeMigratedDb } from './test-support/sqlite';
import { eraseAllData } from './erase';

const HLC = (n: number, dev: string) => `${String(n).padStart(15, '0')}-00000-${dev.padStart(6, '0')}`;

async function seed(db: any) {
  await db.runAsync("INSERT INTO account (id, name, archived, uuid, updated_at) VALUES (1,'Bank',0,'acc-1',?)", [HLC(1, 'aaaaaa')]);
  await db.runAsync("INSERT INTO asset (id, account_id, name, categories, archived, uuid, updated_at) VALUES (1,1,'Checking','{}',0,'as-1',?)", [HLC(1, 'aaaaaa')]);
  await db.runAsync("INSERT INTO asset_snapshot (asset_id, date, net_worth, inflow, profit, updated_at) VALUES (1,'2026-01',100,0,0,?)", [HLC(1, 'aaaaaa')]);
  await db.runAsync("INSERT INTO tran (id, date, type, value, cat, note, uuid, updated_at) VALUES (1,'2026-01-05','OUTLAY',5,'food','',? ,?)", ['tr-1', HLC(1, 'aaaaaa')]);
  await db.runAsync("INSERT INTO setting (key, value, updated_at) VALUES ('currency','€',?)", [HLC(1, 'aaaaaa')]);
}

function fixedTick(stamp: string) {
  return { tick: async () => stamp };
}

test('eraseAllData deletes all data rows but keeps settings', async () => {
  const { db } = await makeMigratedDb();
  await seed(db);
  await eraseAllData(db, fixedTick(HLC(9, 'aaaaaa')));
  for (const t of ['account', 'asset', 'asset_snapshot', 'tran']) {
    const rows = await db.getAllAsync(`SELECT 1 FROM ${t}`);
    assert.equal(rows.length, 0, `${t} should be empty`);
  }
  const settings = await db.getAllAsync('SELECT 1 FROM setting');
  assert.equal(settings.length, 1, 'settings preserved');
});

test('eraseAllData tombstones every entity at the erase stamp', async () => {
  const { db } = await makeMigratedDb();
  await seed(db);
  await eraseAllData(db, fixedTick(HLC(9, 'aaaaaa')));
  const toms = await db.getAllAsync<{ entity: string; uuid: string; deleted_at: string }>(
    'SELECT entity, uuid, deleted_at FROM tombstone ORDER BY entity, uuid'
  );
  assert.deepEqual(toms.map((t) => `${t.entity}:${t.uuid}`).sort(), [
    'account:acc-1', 'asset:as-1', 'snapshot:as-1|2026-01', 'tran:tr-1',
  ].sort());
  for (const t of toms) assert.equal(t.deleted_at, HLC(9, 'aaaaaa'));
});

test('eraseAllData on an empty DB is a no-op', async () => {
  const { db } = await makeMigratedDb();
  await eraseAllData(db, fixedTick(HLC(9, 'aaaaaa')));
  const toms = await db.getAllAsync('SELECT 1 FROM tombstone');
  assert.equal(toms.length, 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test src/sync/erase.test.ts`
Expected: FAIL — `./erase` not found.

- [ ] **Step 3: Implement `src/sync/erase.ts`**

```ts
import type { CicadaDB } from '../db/migrations';
import { recordTombstonesAt } from './stamp';

export type EraseDeps = { tick: () => Promise<string> };

/**
 * Tombstone every live financial row (account/asset/snapshot/tran) at one fresh
 * HLC, then delete those rows. Settings, sync_state, and tombstone tables are
 * left intact (settings are never tombstoned — see merge.ts). The tombstones
 * are what propagate the deletion to the cloud and other devices on the next
 * sync; deleting the rows without tombstones (the old DROP TABLE reset) is why
 * data used to resurrect.
 */
export async function eraseAllData(db: CicadaDB, deps: EraseDeps): Promise<void> {
  const deletedAt = await deps.tick();

  const accounts = await db.getAllAsync<{ uuid: string }>('SELECT uuid FROM account');
  const assets = await db.getAllAsync<{ uuid: string }>('SELECT uuid FROM asset');
  const snapshots = await db.getAllAsync<{ k: string }>(
    `SELECT a.uuid || '|' || s.date AS k FROM asset_snapshot s JOIN asset a ON s.asset_id = a.id`
  );
  const trans = await db.getAllAsync<{ uuid: string }>('SELECT uuid FROM tran');

  await recordTombstonesAt(db, 'account', accounts.map((r) => r.uuid), deletedAt);
  await recordTombstonesAt(db, 'asset', assets.map((r) => r.uuid), deletedAt);
  await recordTombstonesAt(db, 'snapshot', snapshots.map((r) => r.k), deletedAt);
  await recordTombstonesAt(db, 'tran', trans.map((r) => r.uuid), deletedAt);

  // Delete in FK-safe order. Keep sync_state + tombstone.
  await db.runAsync('DELETE FROM tran');
  await db.runAsync('DELETE FROM asset_snapshot');
  await db.runAsync('DELETE FROM asset');
  await db.runAsync('DELETE FROM account');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test src/sync/erase.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add to `package.json` test list; verify types/lint**

Append `src/sync/erase.test.ts` to the `test` script. Run: `npx tsc --noEmit && npm run lint` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/sync/erase.ts src/sync/erase.test.ts package.json
git commit -m "feat(sync): eraseAllData tombstones then deletes local rows

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Deletion-propagation scenario tests (runSync)

**Files:**
- Modify: `src/sync/sync.test.ts`

**Interfaces:**
- Consumes: `eraseAllData` (Task 2); existing `makeFakeRemote`, `depsFor`, `addAccount`, `HLC`, `runSync`.

- [ ] **Step 1: Write the failing tests**

Append to `src/sync/sync.test.ts` (the helpers `makeFakeRemote`, `depsFor`, `addAccount`, `HLC` already exist in this file). Add the import at the top alongside the existing imports:

```ts
import { eraseAllData } from './erase';
```

Then append:

```ts
// A monotonic tick that sorts AFTER any HLC(n,*) the tests use below.
function tickFrom(start: number, dev: string) {
  let n = start;
  return { tick: async () => HLC(n++, dev) };
}

test('erase propagates: device that erases empties the cloud of live data', async () => {
  const { db } = await makeMigratedDb();
  await addAccount(db, 'acc-a', 'Cash', HLC(10, 'aaaaaa'));
  const remote = makeFakeRemote();
  await runSync(depsFor(db, remote, 'aaaaaa').deps); // seed cloud with {Cash}

  await eraseAllData(db, tickFrom(100, 'aaaaaa')); // tombstone + delete locally
  await runSync(depsFor(db, remote, 'aaaaaa', 2_000_000).deps); // push tombstone

  const pushed = parseDocument(remote._content()!);
  assert.equal(pushed.tables.account.length, 0, 'no live accounts in cloud');
  assert.equal(pushed.tombstones.length, 1, 'tombstone present in cloud');
});

test('erase propagates to a second device on its next sync', async () => {
  const { db: dbA } = await makeMigratedDb();
  const { db: dbB } = await makeMigratedDb();
  await addAccount(dbA, 'acc-a', 'Cash', HLC(10, 'aaaaaa'));
  const remote = makeFakeRemote();
  await runSync(depsFor(dbA, remote, 'aaaaaa').deps);     // A seeds {Cash}
  await runSync(depsFor(dbB, remote, 'bbbbbb').deps);     // B pulls {Cash}
  let docB = await buildDocument(dbB, { generatedBy: 'x', generatedAt: 'x' });
  assert.equal(docB.tables.account.length, 1);

  await eraseAllData(dbA, tickFrom(100, 'aaaaaa'));        // A erases
  await runSync(depsFor(dbA, remote, 'aaaaaa', 2_000_000).deps); // push tombstone
  await runSync(depsFor(dbB, remote, 'bbbbbb', 3_000_000).deps); // B applies deletion

  docB = await buildDocument(dbB, { generatedBy: 'x', generatedAt: 'x' });
  assert.equal(docB.tables.account.length, 0, 'B deleted the account');
});

test('no resurrection: a second sync after erase keeps data gone', async () => {
  const { db } = await makeMigratedDb();
  await addAccount(db, 'acc-a', 'Cash', HLC(10, 'aaaaaa'));
  const remote = makeFakeRemote();
  await runSync(depsFor(db, remote, 'aaaaaa').deps);
  await eraseAllData(db, tickFrom(100, 'aaaaaa'));
  await runSync(depsFor(db, remote, 'aaaaaa', 2_000_000).deps);
  await runSync(depsFor(db, remote, 'aaaaaa', 3_000_000).deps); // run again
  const doc = await buildDocument(db, { generatedBy: 'x', generatedAt: 'x' });
  assert.equal(doc.tables.account.length, 0, 'still gone after a 2nd sync');
});
```

- [ ] **Step 2: Run to verify they pass (this is verification, not red-first — the engine already supports it)**

Run: `node --import tsx --test src/sync/sync.test.ts`
Expected: PASS — all existing tests plus the 3 new ones. If "erase propagates" fails because the cloud still shows the account, the tombstone stamp did not exceed the record stamp — confirm `tickFrom(100,...)` sorts after `HLC(10,...)` (it does: 100 > 10).

- [ ] **Step 3: Commit**

```bash
git add src/sync/sync.test.ts
git commit -m "test(sync): deletion propagation + no-resurrection scenarios

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `restoreBackupDoc` restamp option

**Files:**
- Modify: `src/services/backup-core.ts`
- Test: `src/services/backup-core.test.ts`

**Interfaces:**
- Produces: `restoreBackupDoc(db, parsed, opts: { freshStamp: string; restamp?: boolean })`. When `restamp` is true, every inserted account/asset/snapshot/tran/setting row uses `opts.freshStamp` for `updated_at` regardless of the value in the backup, so an imported backup out-stamps whatever is in the cloud.

- [ ] **Step 1: Write the failing test**

Append to `src/services/backup-core.test.ts`:

```ts
test('restoreBackupDoc with restamp forces freshStamp on all updated_at', async () => {
  const { db } = await makeMigratedDb();
  const parsed = {
    version: 3,
    exportedAt: 'x',
    accounts: [{ id: 1, name: 'Bank', archived: 0, uuid: 'acc-1', updated_at: '000000000000005-00000-bbbbbb' }],
    assets: [],
    snapshots: [],
    transactions: [],
    settings: [{ key: 'currency', value: '€', updated_at: '000000000000005-00000-bbbbbb' }],
    tombstones: [],
  };
  const fresh = '000000000000999-00000-aaaaaa';
  await restoreBackupDoc(db, parsed as any, { freshStamp: fresh, restamp: true });
  const acc = await db.getFirstAsync<{ updated_at: string }>("SELECT updated_at FROM account WHERE uuid='acc-1'");
  const setting = await db.getFirstAsync<{ updated_at: string }>("SELECT updated_at FROM setting WHERE key='currency'");
  assert.equal(acc!.updated_at, fresh);
  assert.equal(setting!.updated_at, fresh);
});
```

(If `makeMigratedDb`/`restoreBackupDoc` are not yet imported in this file, add the imports matching the existing test style.)

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test src/services/backup-core.test.ts`
Expected: FAIL — `acc.updated_at` equals the backup's `...005...` stamp, not `fresh`.

- [ ] **Step 3: Implement restamp**

In `restoreBackupDoc`, change the signature to `opts: { freshStamp: string; restamp?: boolean }` and introduce one helper at the top of the function body:

```ts
const stampOf = (backupStamp?: string) =>
  opts.restamp ? opts.freshStamp : (backupStamp ?? opts.freshStamp);
```

Then replace each `x.updated_at ?? opts.freshStamp` with `stampOf(x.updated_at)`:
- account insert (line ~89): `acc.updated_at` → `stampOf(acc.updated_at)`
- asset insert (line ~98): `a.updated_at` → `stampOf(a.updated_at)`
- snapshot insert (line ~107): use `stampOf(s.updated_at)` (and when `restamp` is true, take the v3 INSERT branch even if `s.updated_at` was absent — guard becomes `if ((v >= 3 && s.updated_at) || opts.restamp)`)
- tran insert (line ~116): `t.updated_at` → `stampOf(t.updated_at)`
- setting insert (line ~129): `s.updated_at ?? opts.freshStamp` → `stampOf(s.updated_at)`

Leave the legacy NULL-backfill block (lines 154–161) unchanged.

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test src/services/backup-core.test.ts`
Expected: PASS (existing tests + the new one).

- [ ] **Step 5: Verify types/lint and commit**

Run: `npx tsc --noEmit && npm run lint` → clean.

```bash
git add src/services/backup-core.ts src/services/backup-core.test.ts
git commit -m "feat(backup): restoreBackupDoc restamp option for import-as-truth

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Import-as-truth + sample-data + erase orchestration

This task wires the engine pieces into the three callers. The pure logic is covered by Tasks 1–4; this is integration + a scenario test for import.

**Files:**
- Create: `src/services/erase-data.ts`
- Modify: `src/services/backup.ts`, `src/services/sample-data.ts`
- Test: `src/sync/sync.test.ts` (one import-as-truth scenario)

**Interfaces:**
- Produces: `eraseAllDataAndSync(opts: { resetSettings: boolean }): Promise<void>` — pre-sync (best-effort) → `eraseAllData` against the real DB with the real `tick` → optional settings reset → post-sync.

- [ ] **Step 1: Write `src/services/erase-data.ts`**

```ts
import { getDatabase } from '../db/database';
import { eraseAllData } from '../sync/erase';
import { tick } from '../sync/clock';
import { syncNow } from '../sync/sync';
import { setSetting } from '../db/setting-repo';

// Defaults mirror SettingsContext. Language is intentionally NOT reset — it is a
// per-device UX preference, and resetting it would propagate one device's locale
// to the others.
const SETTING_DEFAULTS: Record<string, string> = {
  currency: '$',
  forwardFill: 'false',
  gainColor: 'green',
};

/**
 * Erase all financial data and propagate the deletion. Pre-sync folds the
 * cloud's latest stamps into the local clock so the tombstones we mint
 * out-stamp the cloud; post-sync pushes them. Both syncs are best-effort:
 * offline, the tombstones are recorded locally and pushed on the next sync.
 */
export async function eraseAllDataAndSync(opts: { resetSettings: boolean }): Promise<void> {
  await syncNow().catch(() => {});            // best-effort pre-sync (advance clock)
  const db = await getDatabase();
  await eraseAllData(db, { tick });
  if (opts.resetSettings) {
    for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
      await setSetting(key, value);           // fresh-stamped LWW writes propagate
    }
  }
  await syncNow().catch(() => {});            // push tombstones
}
```

- [ ] **Step 2: Rewrite `importBackup` (`src/services/backup.ts`)**

Replace the tail of `importBackup` (the `parseBackup` → `resetDatabase` → `restoreBackupDoc` block, lines ~112–116) with:

```ts
  const parsed = parseBackup(content);
  await syncNow().catch(() => {}); // pre-sync: advance clock past the cloud
  const db = await getDatabase();
  await eraseAllData(db, { tick }); // tombstone everything currently present
  const freshStamp = await tick();  // newer than the tombstones just written
  const counts = await restoreBackupDoc(db, parsed, { freshStamp, restamp: true });
  await syncNow().catch(() => {}); // push tombstones + the restamped import
  return counts;
```

Update the imports at the top of `backup.ts`: add `import { eraseAllData } from '../sync/erase';` and `import { syncNow } from '../sync/sync';`; `tick` is already imported. `resetDatabase` is no longer used here — remove it from the `../db/database` import (keep `getDatabase`).

- [ ] **Step 3: Rewrite `loadSampleData` (`src/services/sample-data.ts`)**

Replace `await resetDatabase();` (line 95) with:

```ts
  const db = await getDatabase();
  await eraseAllData(db, { tick });
```

Update imports: remove `import { resetDatabase } from '../db/database';`, add `import { getDatabase } from '../db/database';`, `import { eraseAllData } from '../sync/erase';`, `import { tick } from '../sync/clock';`. At the end of `loadSampleData`, after the transaction loop, add `await syncNow().catch(() => {});` and import `syncNow` from `../sync/sync`. (Sample rows are created via the repos, which already stamp them fresh.)

- [ ] **Step 4: Write the import-as-truth scenario test**

Append to `src/sync/sync.test.ts`. This exercises the engine directly (not the platform `importBackup`): erase + restamped restore + sync, asserting the cloud converges to the backup.

```ts
import { restoreBackupDoc } from '../services/backup-core';

test('import-as-truth: cloud converges to the imported backup', async () => {
  const { db } = await makeMigratedDb();
  await addAccount(db, 'acc-old', 'OldBank', HLC(10, 'aaaaaa'));
  const remote = makeFakeRemote();
  await runSync(depsFor(db, remote, 'aaaaaa').deps); // cloud = {OldBank}

  // Import a backup that contains a DIFFERENT account.
  await eraseAllData(db, { tick: async () => HLC(100, 'aaaaaa') });
  const backup = {
    version: 3, exportedAt: 'x',
    accounts: [{ id: 1, name: 'NewBank', archived: 0, uuid: 'acc-new', updated_at: HLC(5, 'bbbbbb') }],
    assets: [], snapshots: [], transactions: [], settings: [], tombstones: [],
  };
  await restoreBackupDoc(db, backup as any, { freshStamp: HLC(101, 'aaaaaa'), restamp: true });
  await runSync(depsFor(db, remote, 'aaaaaa', 2_000_000).deps);

  const pushed = parseDocument(remote._content()!);
  assert.deepEqual(pushed.tables.account.map((a) => a.name), ['NewBank']);
});
```

- [ ] **Step 5: Run engine tests + typecheck/lint**

Run: `node --import tsx --test src/sync/sync.test.ts`
Expected: PASS including the new import-as-truth test.
Run: `npx tsc --noEmit && npm run lint`
Expected: clean. (`backup.ts` and `sample-data.ts` are platform files but type-check fine; their runtime behavior is verified manually in Task 6 / the manual checklist.)

- [ ] **Step 6: Commit**

```bash
git add src/services/erase-data.ts src/services/backup.ts src/services/sample-data.ts src/sync/sync.test.ts
git commit -m "feat(sync): import/sample/erase propagate deletions via tombstones

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Erase-data confirmation modal + Settings wiring

UI work — no unit-test harness for RN screens. Verified by `tsc`, `lint`, and a desktop run.

**Files:**
- Create: `app/modals/erase-data.tsx`
- Modify: `app/_layout.tsx`, `app/(tabs)/settings.tsx`
- Modify: `src/i18n/*` locale files (add the new copy keys used below)

**Interfaces:**
- Consumes: `eraseAllDataAndSync` (Task 5), `confirmAsync`/`notify` (`src/utils/dialog`).

- [ ] **Step 1: Read the current Settings reset handler**

Read `app/(tabs)/settings.tsx` around lines 55–80 (the `resetDatabase()` call and the load-sample handler) and note the existing styling/components used for danger actions, plus how other modals are registered in `app/_layout.tsx`.

- [ ] **Step 2: Create `app/modals/erase-data.tsx`**

A modal screen with: a prominent warning body stating the erase removes all financial data from **this device, the cloud, and every other synced device**, and is irreversible; a `Switch` "Also reset app settings to defaults" (default off); a destructive confirm button and a cancel that calls `router.back()`. On confirm:

```tsx
const onConfirm = async () => {
  setBusy(true);
  try {
    await eraseAllDataAndSync({ resetSettings });
    notify(t('eraseData.doneTitle'), t('eraseData.doneBody'));
    router.back();
  } catch (e) {
    notify(t('common.error'), e instanceof Error ? e.message : String(e));
  } finally {
    setBusy(false);
  }
};
```

Use `useState(false)` for both `resetSettings` and `busy`; disable the confirm button while `busy`. Follow the import style and layout of an existing modal (e.g. `app/modals/manage-accounts.tsx`) for `shared` styles and the `useTranslation` hook.

- [ ] **Step 3: Register the modal route in `app/_layout.tsx`**

Add a `<Stack.Screen name="modals/erase-data" options={{ presentation: 'modal', title: t('eraseData.title') }} />` alongside the other modal registrations (match the existing pattern in that file exactly).

- [ ] **Step 4: Point Settings at the modal**

In `app/(tabs)/settings.tsx`, replace the current destructive reset action's handler (the one calling `resetDatabase()` at line ~59) with `router.push('/modals/erase-data')`. Remove the now-unused `resetDatabase` import if nothing else in the file uses it (grep first). Keep the load-sample action as is (its propagation is handled in Task 5).

- [ ] **Step 5: Add i18n keys**

Add to each locale file under a new `eraseData` namespace: `title`, `warningTitle`, `warningBody`, `resetSettingsLabel`, `confirm`, `doneTitle`, `doneBody`. Mirror the existing structure/style of the locale files (provide both English and Chinese, matching the other modal copy).

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit && npm run lint` → clean.
Run the desktop app and manually confirm: Settings → Erase opens the modal; confirming with the app connected to WebDAV erases data locally; a second device (or the cloud file) shows the data gone after sync; loading sample then erasing no longer resurrects. (Manual; cannot be unit-tested.)

- [ ] **Step 7: Commit**

```bash
git add app/modals/erase-data.tsx app/_layout.tsx "app/(tabs)/settings.tsx" src/i18n
git commit -m "feat(settings): erase-data confirmation modal with propagating wipe

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Debounced + background sync

**Files:**
- Create: `src/sync/debounce.ts`, `src/sync/debounce.test.ts`, `src/sync/dirty.ts`
- Modify: `src/db/{account,asset,snapshot,tran}-repo.ts`, `src/db/setting-repo.ts`, `src/hooks/SyncContext.tsx`

**Interfaces:**
- Produces:
  - `createDebouncer(opts: { delayMs: number; maxWaitMs: number; now: () => number; schedule: (ms: number, fn: () => void) => Timer; cancel: (t: Timer) => void }, flush: () => void): { bump(): void; cancel(): void }` — trailing debounce with a hard ceiling.
  - `bumpDirty(): void` and `subscribeDirty(cb: () => void): () => void` (returns an unsubscribe).

- [ ] **Step 1: Write the failing debouncer test**

Create `src/sync/debounce.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test src/sync/debounce.test.ts`
Expected: FAIL — `./debounce` not found.

- [ ] **Step 3: Implement `src/sync/debounce.ts`**

```ts
export type DebouncerOpts = {
  delayMs: number;
  maxWaitMs: number;
  now: () => number;
  schedule: (ms: number, fn: () => void) => any;
  cancel: (t: any) => void;
};

/** Trailing debounce with a hard ceiling: flush `delayMs` after the last bump,
 *  but never wait longer than `maxWaitMs` since the first un-flushed bump. */
export function createDebouncer(opts: DebouncerOpts, flush: () => void) {
  let timer: any = null;
  let firstBumpAt: number | null = null;

  const clear = () => { if (timer !== null) { opts.cancel(timer); timer = null; } };
  const run = () => { clear(); firstBumpAt = null; flush(); };

  const bump = () => {
    const t = opts.now();
    if (firstBumpAt === null) firstBumpAt = t;
    clear();
    const untilCeiling = opts.maxWaitMs - (t - firstBumpAt);
    const wait = Math.max(0, Math.min(opts.delayMs, untilCeiling));
    timer = opts.schedule(wait, run);
  };

  return { bump, cancel: () => { clear(); firstBumpAt = null; } };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --import tsx --test src/sync/debounce.test.ts`
Expected: PASS (2 tests). Add `src/sync/debounce.test.ts` to the `package.json` test list.

- [ ] **Step 5: Implement `src/sync/dirty.ts`**

```ts
// Tiny synchronous event bus: repos call bumpDirty() after a mutation; the sync
// layer subscribes and debounces. No-op until someone subscribes.
type Listener = () => void;
const listeners = new Set<Listener>();

export function bumpDirty(): void {
  for (const l of listeners) l();
}

export function subscribeDirty(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
```

- [ ] **Step 6: Call `bumpDirty()` after mutations in the repos**

In each repo, import `bumpDirty` from `../sync/dirty` and call it at the end of every mutating function (after the `db.runAsync` write). Mutating functions:
- `account-repo.ts`: `createAccount`, `renameAccount`, `deleteAccount`, `setAccountArchived`
- `asset-repo.ts`: every create/update/delete/archive function (mirror the account list)
- `snapshot-repo.ts`: `upsertSnapshot`, `deleteSnapshot`
- `tran-repo.ts`: `createTransaction`, `updateTransaction`, `deleteTransaction`
- `setting-repo.ts`: `setSetting`

`bumpDirty()` is synchronous and side-effect-free when there are no subscribers, so it is safe to call unconditionally. Do NOT add it to read functions.

- [ ] **Step 7: Wire the debouncer + background flush into `SyncContext.tsx`**

In `SyncProvider`, after `doSync` is defined, add:

```tsx
useEffect(() => {
  if (!available) return;
  const debouncer = createDebouncer(
    {
      delayMs: 3000,
      maxWaitMs: 30000,
      now: () => Date.now(),
      schedule: (ms, fn) => setTimeout(fn, ms),
      cancel: (t) => clearTimeout(t),
    },
    () => { void doSync(); }
  );
  const unsub = subscribeDirty(() => debouncer.bump());
  return () => { unsub(); debouncer.cancel(); };
}, [available, doSync]);
```

And extend the existing AppState listener (lines 123–129) so backgrounding flushes immediately:

```tsx
const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
  if (s === 'active') void doSync();
  else void doSync(); // 'background' / 'inactive': best-effort flush of pending edits
});
```

Add the imports: `import { createDebouncer } from '../sync/debounce';` and `import { subscribeDirty } from '../sync/dirty';`. The existing `inFlight` guard in `doSync` already coalesces overlapping runs.

- [ ] **Step 8: Verify**

Run: `npx tsc --noEmit && npm run lint` → clean.
Run: `node --import tsx --test src/sync/debounce.test.ts` → PASS.
Manual (desktop, connected): edit a snapshot, wait ~3s, confirm a sync fires (status indicator / cloud file updates) without a manual tap.

- [ ] **Step 9: Commit**

```bash
git add src/sync/debounce.ts src/sync/debounce.test.ts src/sync/dirty.ts src/db package.json src/hooks/SyncContext.tsx
git commit -m "feat(sync): debounced auto-sync after writes + background flush

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Spec Piece A (dialogs) — done before this plan (separate commits).
- Spec Piece B (deletion propagation): erase primitive = Task 2; freshness pre/post-sync = Task 5 (`eraseAllDataAndSync`); three callers = Tasks 5–6; reset modal w/ settings choice = Task 6; merge-engine untouched = honored (settings handled as reset-to-defaults). ✓
- Spec Piece C (debounced + background) = Task 7. ✓
- Spec Piece D (tests): erase unit = Task 2; reset/import/no-resurrect scenarios = Tasks 3 & 5; includeSettings — implemented as reset-to-defaults, so the spec's "includeSettings tombstoned" test is intentionally replaced by the Task 6 manual check (documented divergence: settings are not tombstonable per merge.ts:73). ✓
- Freshness exception (concurrent newer offline edit wins) — documented in spec; not separately asserted (standard LWW, out of scope to test here).

**Placeholder scan:** No TBD/TODO; every code step contains full code. ✓

**Type consistency:** `eraseAllData(db, { tick })` used identically in Tasks 2/3/5. `recordTombstonesAt(db, entity, uuids, deletedAt)` signature matches its caller in Task 2. `restoreBackupDoc(..., { freshStamp, restamp })` matches Tasks 4 & 5. `createDebouncer(opts, flush)` matches Task 7 test and wiring. ✓

**Note on settings-reset divergence from spec:** the spec proposed an `includeSettings` tombstone path; implementation uses reset-to-defaults because `merge.ts` does not tombstone settings and changing that is a riskier engine change out of scope here. Functionally equivalent for the user (settings revert to defaults and propagate via LWW). Language is excluded from reset (per-device preference).
