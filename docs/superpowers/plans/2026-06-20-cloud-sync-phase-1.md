# Cloud Sync — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the local-only foundation for cloud sync — a re-entrant additive schema migration (v1→2), a Hybrid Logical Clock, a stable device id, and write/delete stamping wired into every repo — so the app records sync metadata while still running fully offline with no behavior change.

**Architecture:** All new logic lives in a new `src/sync/` module plus an additive `migrate()` block in `src/db/migrations.ts`. A pure HLC core (`hlc.ts`, no DB/Date/RN imports) is unit-tested; a thin stateful `clock.ts` persists HLC state in a new device-local `sync_state` table and serializes ticks. Repos gain two helper calls — `stampWrite()` on every create/update and `recordTombstones()` on every delete — leaving all read paths, screens, and the `id: number` type untouched.

**Tech Stack:** TypeScript (strict), Expo SDK 54 / React Native 0.81, expo-sqlite via the `CicadaDB` interface (runs on native + web-WASM + tauri-plugin-sql). New dev-only dependency: `tsx` for `node --test`.

## Global Constraints

- **Node 20+** (`.nvmrc`); `npm ci` for installs. New deps must be Expo SDK 54 / React 19 compatible.
- **Phase 1 adds NO runtime dependency.** The only new dependency is `tsx` as a **devDependency** (test harness).
- **Schema change is purely additive.** No column is dropped or retyped; no `UNIQUE` constraint on existing columns changes; the `id: number` PK type stays.
- **The v2 migration MUST be re-entrant** (survives interruption — Tauri has no atomic transaction): guarded `ADD COLUMN`, idempotent backfill (`WHERE … IS NULL`), `CREATE UNIQUE INDEX IF NOT EXISTS`, and `PRAGMA user_version = 2` **strictly last**.
- **HLC encoding widths are frozen:** `<physicalMs:15>-<counter:5>-<deviceId:6>`. Ordering correctness depends on these widths. Compare HLC strings **ordinally only** (`a < b`), never `localeCompare`.
- **Repos call `getDatabase()` themselves** (no db argument in their public signature) and own snake_case↔camelCase mapping — preserve this convention.
- **Verification per task:** `npx tsc --noEmit` (strict) + `npm run lint` must pass. The pure HLC task additionally runs `npm test`. There is otherwise no test runner — DB-bound tasks are verified by type-check, lint, and the manual checks each task lists.
- **New `src/sync/` files import nothing from React Native / Expo** except `hlc.ts` which imports nothing at all (keeps it node-testable).

---

### Task 1: Pure HLC core + test harness

Delivers the pure, node-testable heart of the clock and introduces the repo's first test runner. Nothing here touches the DB.

**Files:**
- Create: `src/sync/hlc.ts`
- Create: `src/sync/hlc.test.ts`
- Modify: `package.json` (add `test` script + `tsx` devDependency)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `HLC_PHYS_DIGITS = 15`, `HLC_COUNTER_DIGITS = 5`, `HLC_DEVICE_DIGITS = 6`, `HLC_COUNTER_MAX = 99999`
  - `type HlcState = { phys: number; counter: number }`
  - `encodeHlc(phys: number, counter: number, deviceId: string): string`
  - `parseHlc(ts: string): { phys: number; counter: number; deviceId: string }`
  - `advanceLocal(prev: HlcState, now: number): HlcState`
  - `compareHlc(a: string, b: string): number`

- [ ] **Step 1: Add the test harness to `package.json`**

Add `tsx` to `devDependencies` and a `test` script. The script lists test files explicitly (Node 20's `--test` does not reliably glob); append new test files here as later phases add them.

In `package.json`, add to `"scripts"` (after the `"lint"` line):

```json
    "lint": "expo lint",
    "test": "node --import tsx --test src/sync/hlc.test.ts"
```

In `"devDependencies"`, add:

```json
    "tsx": "^4.19.2"
```

Then install:

```bash
npm install
```

- [ ] **Step 2: Write the failing test**

Create `src/sync/hlc.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './hlc'` (the implementation does not exist yet).

- [ ] **Step 4: Write the minimal implementation**

Create `src/sync/hlc.ts`:

```ts
// Hybrid Logical Clock — pure encoding + ordering core.
// Imports NOTHING (no DB, no Date, no RN/Expo) so it is unit-testable under
// `node --test`. The stateful tick() that reads Date.now() and persists state
// lives in clock.ts.

export const HLC_PHYS_DIGITS = 15;
export const HLC_COUNTER_DIGITS = 5;
export const HLC_DEVICE_DIGITS = 6;
export const HLC_COUNTER_MAX = 99999; // largest value that fits HLC_COUNTER_DIGITS

export type HlcState = { phys: number; counter: number };

/** Fixed-width string so a plain ordinal compare IS the HLC compare. */
export function encodeHlc(phys: number, counter: number, deviceId: string): string {
  const p = String(phys).padStart(HLC_PHYS_DIGITS, '0');
  const c = String(counter).padStart(HLC_COUNTER_DIGITS, '0');
  const d = deviceId.padStart(HLC_DEVICE_DIGITS, '0').slice(0, HLC_DEVICE_DIGITS);
  return `${p}-${c}-${d}`;
}

export function parseHlc(ts: string): { phys: number; counter: number; deviceId: string } {
  const [p, c, d] = ts.split('-');
  return { phys: Number(p), counter: Number(c), deviceId: d };
}

/** Advance the clock for a new LOCAL event happening at `now` (ms). */
export function advanceLocal(prev: HlcState, now: number): HlcState {
  const phys = Math.max(now, prev.phys);
  const counter = phys === prev.phys ? prev.counter + 1 : 0;
  if (counter > HLC_COUNTER_MAX) {
    return { phys: phys + 1, counter: 0 };
  }
  return { phys, counter };
}

/** Ordinal compare. Returns -1 | 0 | 1. NEVER use localeCompare here. */
export function compareHlc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all tests green.

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/sync/hlc.ts src/sync/hlc.test.ts
git commit -m "feat(sync): add pure HLC core + node:test harness"
```

---

### Task 2: Additive v2 schema migration

Bumps `SCHEMA_VERSION` to 2 and adds the re-entrant migration that introduces sync columns, the `tombstone` and `sync_state` tables, uuid backfill, and the migration HLC seed. The app keeps working offline; existing screens never read the new columns.

**Files:**
- Modify: `src/db/migrations.ts`

**Interfaces:**
- Consumes: `encodeHlc` from `src/sync/hlc.ts` (Task 1).
- Produces (within `migrations.ts`, used by later tasks via SQL only): tables `tombstone(entity, uuid, deleted_at, PRIMARY KEY(entity,uuid))` and `sync_state(key PRIMARY KEY, value)`; new nullable columns `uuid`/`updated_at`; seeded `sync_state` rows `deviceId` and `hlc`.

- [ ] **Step 1: Bump the schema version**

In `src/db/migrations.ts`, change line 20:

```ts
export const SCHEMA_VERSION = 2;
```

- [ ] **Step 2: Add the import and new tables to the always-run block**

At the top of `src/db/migrations.ts` (after the file header comment, before `export type SqlParam`), add:

```ts
import { encodeHlc } from '../sync/hlc';
```

In the `migrate()` opening `db.execAsync` template (lines 23–68), add the two new columns to the `account`, `asset`, `asset_snapshot`, `tran`, and `setting` `CREATE TABLE IF NOT EXISTS` bodies, and append the two new tables. The columns are nullable here (mirrors how `archived` is both declared here for fresh DBs and ALTER-added below for existing ones). Replace the table definitions so they read:

```ts
    CREATE TABLE IF NOT EXISTS account (
      id          INTEGER PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      archived    INTEGER NOT NULL DEFAULT 0,
      uuid        TEXT,
      updated_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS asset (
      id          INTEGER PRIMARY KEY,
      account_id  INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      categories  TEXT NOT NULL DEFAULT '{}',
      archived    INTEGER NOT NULL DEFAULT 0,
      uuid        TEXT,
      updated_at  TEXT,
      UNIQUE(account_id, name)
    );

    CREATE TABLE IF NOT EXISTS asset_snapshot (
      asset_id    INTEGER NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
      date        TEXT NOT NULL,
      net_worth   REAL NOT NULL DEFAULT 0,
      inflow      REAL NOT NULL DEFAULT 0,
      profit      REAL NOT NULL DEFAULT 0,
      updated_at  TEXT,
      PRIMARY KEY (asset_id, date)
    );

    CREATE TABLE IF NOT EXISTS tran (
      id      INTEGER PRIMARY KEY,
      date    TEXT NOT NULL,
      type    TEXT NOT NULL CHECK(type IN ('INCOME', 'OUTLAY')),
      value   REAL NOT NULL,
      cat     TEXT NOT NULL DEFAULT '',
      note    TEXT NOT NULL DEFAULT '',
      uuid        TEXT,
      updated_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS setting (
      key         TEXT PRIMARY KEY,
      value       TEXT NOT NULL,
      updated_at  TEXT
    );

    CREATE TABLE IF NOT EXISTS tombstone (
      entity      TEXT NOT NULL,
      uuid        TEXT NOT NULL,
      deleted_at  TEXT NOT NULL,
      PRIMARY KEY (entity, uuid)
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      key     TEXT PRIMARY KEY,
      value   TEXT NOT NULL
    );
```

Leave the existing `CREATE INDEX IF NOT EXISTS …` lines (snapshot date, tran date/type) unchanged at the end of that template. **Do NOT add the uuid unique index here** — it must be created after backfill (Step 4), or it would fail on an existing DB whose `uuid` column does not exist yet when this always-run block executes.

- [ ] **Step 3: Add the re-entrant v2 migration block**

In `migrate()`, immediately after the closing `}` of the `if (currentVersion < 1) { … }` block (currently line 91) and before the closing `}` of `migrate`, insert:

```ts
  if (currentVersion < 2) {
    // v2 (cloud sync, Phase 1): additive sync columns + tombstone/sync_state.
    // Re-entrant — Tauri has no atomic transaction, so every step is safe to
    // re-run, and `PRAGMA user_version = 2` is written strictly last.
    await addColumnIfMissing(db, 'account', 'uuid', 'TEXT');
    await addColumnIfMissing(db, 'account', 'updated_at', 'TEXT');
    await addColumnIfMissing(db, 'asset', 'uuid', 'TEXT');
    await addColumnIfMissing(db, 'asset', 'updated_at', 'TEXT');
    await addColumnIfMissing(db, 'asset_snapshot', 'updated_at', 'TEXT');
    await addColumnIfMissing(db, 'tran', 'uuid', 'TEXT');
    await addColumnIfMissing(db, 'tran', 'updated_at', 'TEXT');
    await addColumnIfMissing(db, 'setting', 'updated_at', 'TEXT');

    // Stable device id; also used for the one-time migration HLC stamp.
    const deviceId = await ensureDeviceId(db);
    const migrationPhys = Date.now();
    const migrationStamp = encodeHlc(migrationPhys, 0, deviceId);

    // Backfill uuids — re-entrant (only NULLs). randomblob/hex/lower are core
    // SQLite, identical on all three backends.
    await db.execAsync(`UPDATE account SET uuid = lower(hex(randomblob(16))) WHERE uuid IS NULL`);
    await db.execAsync(`UPDATE asset   SET uuid = lower(hex(randomblob(16))) WHERE uuid IS NULL`);
    await db.execAsync(`UPDATE tran    SET uuid = lower(hex(randomblob(16))) WHERE uuid IS NULL`);

    // Backfill updated_at with the single migration stamp (all pre-existing
    // rows on this device share it — see spec §4 "first-merge caveat").
    await db.runAsync(`UPDATE account        SET updated_at = ? WHERE updated_at IS NULL`, [migrationStamp]);
    await db.runAsync(`UPDATE asset          SET updated_at = ? WHERE updated_at IS NULL`, [migrationStamp]);
    await db.runAsync(`UPDATE asset_snapshot SET updated_at = ? WHERE updated_at IS NULL`, [migrationStamp]);
    await db.runAsync(`UPDATE tran           SET updated_at = ? WHERE updated_at IS NULL`, [migrationStamp]);
    await db.runAsync(`UPDATE setting        SET updated_at = ? WHERE updated_at IS NULL`, [migrationStamp]);

    // Seed HLC state so later local ticks sort AFTER the migration stamp.
    // DO NOTHING keeps an already-advanced clock if the migration re-runs.
    await db.runAsync(
      `INSERT INTO sync_state (key, value) VALUES ('hlc', ?)
         ON CONFLICT(key) DO NOTHING`,
      [JSON.stringify({ phys: migrationPhys, counter: 0 })]
    );

    // Unique index on uuid AFTER backfill (idempotent on re-run).
    await db.execAsync(`CREATE UNIQUE INDEX IF NOT EXISTS idx_account_uuid ON account(uuid)`);
    await db.execAsync(`CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_uuid   ON asset(uuid)`);
    await db.execAsync(`CREATE UNIQUE INDEX IF NOT EXISTS idx_tran_uuid    ON tran(uuid)`);

    await db.execAsync(`PRAGMA user_version = 2`);
  }
```

- [ ] **Step 4: Add the two migration helpers**

At the end of `src/db/migrations.ts` (after the existing `columnExists` function), add:

```ts
async function addColumnIfMissing(
  db: CicadaDB,
  table: string,
  column: string,
  type: string
): Promise<void> {
  if (!(await columnExists(db, table, column))) {
    await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

/** Read the persisted device id, generating + persisting one if absent. */
async function ensureDeviceId(db: CicadaDB): Promise<string> {
  const existing = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM sync_state WHERE key = 'deviceId'`
  );
  if (existing?.value) return existing.value;
  // 3 random bytes -> 6 lowercase hex chars (matches HLC_DEVICE_DIGITS).
  const generated = await db.getFirstAsync<{ id: string }>(
    `SELECT lower(hex(randomblob(3))) AS id`
  );
  await db.runAsync(
    `INSERT INTO sync_state (key, value) VALUES ('deviceId', ?)
       ON CONFLICT(key) DO NOTHING`,
    [generated!.id]
  );
  const persisted = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM sync_state WHERE key = 'deviceId'`
  );
  return persisted!.value;
}
```

- [ ] **Step 5: Drop the new tables in `resetSchema`**

In `resetSchema()`, add the two new tables to the `DROP TABLE` list so a reset (used by backup import) clears them too. Update the template to:

```ts
  await db.execAsync(`
    DROP TABLE IF EXISTS tran;
    DROP TABLE IF EXISTS asset_snapshot;
    DROP TABLE IF EXISTS asset;
    DROP TABLE IF EXISTS account;
    DROP TABLE IF EXISTS setting;
    DROP TABLE IF EXISTS tombstone;
    DROP TABLE IF EXISTS sync_state;
    PRAGMA user_version = 0;
  `);
  await migrate(db);
```

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 7: Manual verification (fresh DB + upgrade path)**

Run the web target (cross-origin-isolated, real WASM SQLite):

```bash
npm run web
```

In the browser devtools console of the running app, confirm the schema upgraded cleanly:

1. Open the app; it should load with no migration error in the console.
2. Verify version + new structures (run in the app's JS console; adjust if the app exposes the DB differently — otherwise verify by adding records and confirming no errors):
   - The app starts and the Home/Assets/Transactions screens render existing data unchanged.
   - Add an account, an asset, a snapshot, and a transaction via the UI — no errors.

To exercise the **re-entrancy / upgrade-from-v1** path locally, before this change ship a v1 DB by checking out the previous commit, creating sample data, then returning to this branch and reloading — the v2 block should backfill uuids and not throw. (If that round-trip is impractical, rely on the fresh-DB path above plus the type-check; the re-entrancy guards are exercised by the `WHERE … IS NULL` / `IF NOT EXISTS` / `columnExists` conditions.)

- [ ] **Step 8: Commit**

```bash
git add src/db/migrations.ts
git commit -m "feat(sync): additive v2 schema migration (uuid, updated_at, tombstone, sync_state)"
```

---

### Task 3: Device id + sync_state repo + stateful clock

Wraps the pure HLC core with a DB-backed, serialized `tick()` and exposes device-local `sync_state` access. No caching — every call reads the DB so a backup-import `resetDatabase()` cannot leave stale in-memory state.

**Files:**
- Create: `src/sync/sync-state-repo.ts`
- Create: `src/sync/device.ts`
- Create: `src/sync/clock.ts`

**Interfaces:**
- Consumes: `getDatabase` from `src/db/database`; `advanceLocal`, `encodeHlc`, `HlcState` from `src/sync/hlc`.
- Produces:
  - `getSyncState(key: string): Promise<string | null>`
  - `setSyncState(key: string, value: string): Promise<void>`
  - `getDeviceId(): Promise<string>`
  - `tick(): Promise<string>` — returns the next encoded HLC timestamp, serialized against concurrent callers.

- [ ] **Step 1: Create the sync_state repo**

Create `src/sync/sync-state-repo.ts`:

```ts
import { getDatabase } from '../db/database';

// Device-local key/value store. NEVER synced (deviceId, HLC state, etc.).

export async function getSyncState(key: string): Promise<string | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM sync_state WHERE key = ?',
    [key]
  );
  return row?.value ?? null;
}

export async function setSyncState(key: string, value: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO sync_state (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value]
  );
}
```

- [ ] **Step 2: Create the device id accessor**

Create `src/sync/device.ts`:

```ts
import { getSyncState } from './sync-state-repo';

// The device id is seeded by the v2 migration (migrations.ts ensureDeviceId).
// It is the HLC tie-break and must be stable for the life of the install.
export async function getDeviceId(): Promise<string> {
  const id = await getSyncState('deviceId');
  if (!id) {
    throw new Error('deviceId missing — v2 migration did not seed sync_state');
  }
  return id;
}
```

- [ ] **Step 3: Create the stateful clock**

Create `src/sync/clock.ts`:

```ts
import { advanceLocal, encodeHlc, type HlcState } from './hlc';
import { getDeviceId } from './device';
import { getSyncState, setSyncState } from './sync-state-repo';

const HLC_KEY = 'hlc';

// Serialize ticks so a read-modify-write of the persisted state can never
// interleave (e.g. an upsert loop), which would otherwise mint duplicate HLCs.
let queue: Promise<unknown> = Promise.resolve();

async function doTick(): Promise<string> {
  const raw = await getSyncState(HLC_KEY);
  const prev: HlcState = raw ? (JSON.parse(raw) as HlcState) : { phys: 0, counter: 0 };
  const next = advanceLocal(prev, Date.now());
  await setSyncState(HLC_KEY, JSON.stringify(next));
  const deviceId = await getDeviceId();
  return encodeHlc(next.phys, next.counter, deviceId);
}

/** Next local HLC timestamp. Awaitable; serialized against concurrent callers. */
export function tick(): Promise<string> {
  const run = queue.then(doTick, doTick);
  // Swallow errors on the queue tail so one failed tick can't wedge the chain.
  queue = run.catch(() => undefined);
  return run;
}
```

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/sync/sync-state-repo.ts src/sync/device.ts src/sync/clock.ts
git commit -m "feat(sync): device id, sync_state repo, and serialized HLC clock"
```

---

### Task 4: Stamping helpers (`stamp.ts`)

The single chokepoint every repo write/delete goes through, so the per-repo change is uniform and reviewable.

**Files:**
- Create: `src/sync/stamp.ts`

**Interfaces:**
- Consumes: `CicadaDB` (type) from `src/db/migrations`; `tick` from `src/sync/clock`.
- Produces:
  - `type Entity = 'account' | 'asset' | 'snapshot' | 'tran' | 'setting'`
  - `genUuid(db: CicadaDB): Promise<string>`
  - `stampWrite(db: CicadaDB, opts: { withUuid: boolean }): Promise<{ uuid: string | null; updatedAt: string }>`
  - `recordTombstones(db: CicadaDB, entity: Entity, uuids: string[]): Promise<void>`

- [ ] **Step 1: Create `stamp.ts`**

Create `src/sync/stamp.ts`:

```ts
import type { CicadaDB } from '../db/migrations';
import { tick } from './clock';

export type Entity = 'account' | 'asset' | 'snapshot' | 'tran' | 'setting';

/** 16 random bytes -> 32 lowercase hex chars. Core SQLite, all backends. */
export async function genUuid(db: CicadaDB): Promise<string> {
  const row = await db.getFirstAsync<{ id: string }>(
    `SELECT lower(hex(randomblob(16))) AS id`
  );
  return row!.id;
}

/** Stamp a create/update: one fresh HLC, plus a uuid on insert. */
export async function stampWrite(
  db: CicadaDB,
  opts: { withUuid: boolean }
): Promise<{ uuid: string | null; updatedAt: string }> {
  const updatedAt = await tick();
  const uuid = opts.withUuid ? await genUuid(db) : null;
  return { uuid, updatedAt };
}

/**
 * Record tombstones for a delete (the row + any cascaded descendants the
 * caller enumerated). All share one HLC — they are one logical deletion.
 * For snapshots the `uuid` is the composite key "<assetUuid>|<date>".
 */
export async function recordTombstones(
  db: CicadaDB,
  entity: Entity,
  uuids: string[]
): Promise<void> {
  if (uuids.length === 0) return;
  const deletedAt = await tick();
  for (const uuid of uuids) {
    await db.runAsync(
      `INSERT INTO tombstone (entity, uuid, deleted_at) VALUES (?, ?, ?)
         ON CONFLICT(entity, uuid) DO UPDATE SET deleted_at = excluded.deleted_at`,
      [entity, uuid, deletedAt]
    );
  }
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/sync/stamp.ts
git commit -m "feat(sync): stampWrite + recordTombstones helpers"
```

---

### Task 5: Wire stamping into create/update repo paths

Every insert/update now writes `uuid` (insert only) and `updated_at`. Read paths and public function signatures are unchanged — callers pass nothing new.

**Files:**
- Modify: `src/db/account-repo.ts` (`createAccount`, `renameAccount`, `setAccountArchived`)
- Modify: `src/db/asset-repo.ts` (`createAsset`, `updateAsset`, `setAssetArchived`)
- Modify: `src/db/snapshot-repo.ts` (`upsertSnapshot`)
- Modify: `src/db/tran-repo.ts` (`createTransaction`, `updateTransaction`)
- Modify: `src/db/setting-repo.ts` (`setSetting`)

**Interfaces:**
- Consumes: `stampWrite` from `src/sync/stamp` (Task 4).
- Produces: no signature changes; rows now carry sync metadata.

- [ ] **Step 1: account-repo — add import and stamp the three writers**

In `src/db/account-repo.ts`, add after the existing imports:

```ts
import { stampWrite } from '../sync/stamp';
```

Replace `createAccount`:

```ts
export async function createAccount(name: string): Promise<number> {
  const db = await getDatabase();
  const { uuid, updatedAt } = await stampWrite(db, { withUuid: true });
  const result = await db.runAsync(
    'INSERT INTO account (name, uuid, updated_at) VALUES (?, ?, ?)',
    [name, uuid, updatedAt]
  );
  return result.lastInsertRowId;
}
```

Replace `renameAccount`:

```ts
export async function renameAccount(id: number, name: string): Promise<void> {
  const db = await getDatabase();
  const { updatedAt } = await stampWrite(db, { withUuid: false });
  await db.runAsync('UPDATE account SET name = ?, updated_at = ? WHERE id = ?', [
    name,
    updatedAt,
    id,
  ]);
}
```

Replace `setAccountArchived` (the cascade UPDATE to child assets shares the same stamp):

```ts
export async function setAccountArchived(
  id: number,
  archived: boolean
): Promise<void> {
  const db = await getDatabase();
  const flag = archived ? 1 : 0;
  const { updatedAt } = await stampWrite(db, { withUuid: false });
  await db.withTransactionAsync(async () => {
    await db.runAsync('UPDATE account SET archived = ?, updated_at = ? WHERE id = ?', [
      flag,
      updatedAt,
      id,
    ]);
    // Archiving an account cascades to all its assets; un-archiving does NOT
    // un-archive assets — user must explicitly un-archive each one.
    if (archived) {
      await db.runAsync(
        'UPDATE asset SET archived = 1, updated_at = ? WHERE account_id = ?',
        [updatedAt, id]
      );
    }
  });
}
```

- [ ] **Step 2: asset-repo — add import and stamp the three writers**

In `src/db/asset-repo.ts`, add after the existing imports:

```ts
import { stampWrite } from '../sync/stamp';
```

Replace `createAsset`:

```ts
export async function createAsset(
  accountId: number,
  name: string,
  categories: Record<string, string> = {}
): Promise<number> {
  const db = await getDatabase();
  const { uuid, updatedAt } = await stampWrite(db, { withUuid: true });
  const result = await db.runAsync(
    'INSERT INTO asset (account_id, name, categories, uuid, updated_at) VALUES (?, ?, ?, ?, ?)',
    [accountId, name, JSON.stringify(categories), uuid, updatedAt]
  );
  return result.lastInsertRowId;
}
```

Replace `updateAsset`:

```ts
export async function updateAsset(
  id: number,
  name: string,
  categories: Record<string, string>
): Promise<void> {
  const db = await getDatabase();
  const { updatedAt } = await stampWrite(db, { withUuid: false });
  await db.runAsync(
    'UPDATE asset SET name = ?, categories = ?, updated_at = ? WHERE id = ?',
    [name, JSON.stringify(categories), updatedAt, id]
  );
}
```

Replace `setAssetArchived`:

```ts
export async function setAssetArchived(
  id: number,
  archived: boolean
): Promise<void> {
  const db = await getDatabase();
  const { updatedAt } = await stampWrite(db, { withUuid: false });
  await db.runAsync('UPDATE asset SET archived = ?, updated_at = ? WHERE id = ?', [
    archived ? 1 : 0,
    updatedAt,
    id,
  ]);
}
```

- [ ] **Step 3: snapshot-repo — stamp `upsertSnapshot`**

In `src/db/snapshot-repo.ts`, add after the existing imports:

```ts
import { stampWrite } from '../sync/stamp';
```

Replace `upsertSnapshot`:

```ts
export async function upsertSnapshot(
  assetId: number,
  date: string,
  netWorth: number,
  inflow: number,
  profit: number
): Promise<void> {
  const db = await getDatabase();
  const { updatedAt } = await stampWrite(db, { withUuid: false });
  await db.runAsync(`
    INSERT INTO asset_snapshot (asset_id, date, net_worth, inflow, profit, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(asset_id, date) DO UPDATE SET
      net_worth = excluded.net_worth,
      inflow = excluded.inflow,
      profit = excluded.profit,
      updated_at = excluded.updated_at
  `, [assetId, date, netWorth, inflow, profit, updatedAt]);
}
```

- [ ] **Step 4: tran-repo — stamp the two writers**

In `src/db/tran-repo.ts`, add after the existing imports:

```ts
import { stampWrite } from '../sync/stamp';
```

Replace `createTransaction`:

```ts
export async function createTransaction(
  date: string,
  type: TranType,
  value: number,
  cat: string = '',
  note: string = ''
): Promise<number> {
  const db = await getDatabase();
  const { uuid, updatedAt } = await stampWrite(db, { withUuid: true });
  const result = await db.runAsync(
    'INSERT INTO tran (date, type, value, cat, note, uuid, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [date, type, value, cat, note, uuid, updatedAt]
  );
  return result.lastInsertRowId;
}
```

Replace `updateTransaction`:

```ts
export async function updateTransaction(
  id: number,
  date: string,
  type: TranType,
  value: number,
  cat: string,
  note: string
): Promise<void> {
  const db = await getDatabase();
  const { updatedAt } = await stampWrite(db, { withUuid: false });
  await db.runAsync(
    'UPDATE tran SET date = ?, type = ?, value = ?, cat = ?, note = ?, updated_at = ? WHERE id = ?',
    [date, type, value, cat, note, updatedAt, id]
  );
}
```

- [ ] **Step 5: setting-repo — stamp `setSetting`**

In `src/db/setting-repo.ts`, add at the top:

```ts
import { stampWrite } from '../sync/stamp';
```

Replace `setSetting`:

```ts
export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDatabase();
  const { updatedAt } = await stampWrite(db, { withUuid: false });
  await db.runAsync(
    `INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, updatedAt]
  );
}
```

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 7: Manual verification**

```bash
npm run web
```

In the running app: create an account, asset, snapshot (add a record), and a transaction; rename/archive an account; edit a transaction; change a setting (currency symbol). All succeed with no console errors. Optionally inspect the DB to confirm `uuid` is set on new account/asset/tran rows and `updated_at` is set on every written row.

- [ ] **Step 8: Commit**

```bash
git add src/db/account-repo.ts src/db/asset-repo.ts src/db/snapshot-repo.ts src/db/tran-repo.ts src/db/setting-repo.ts
git commit -m "feat(sync): stamp uuid/updated_at on all create/update repo writes"
```

---

### Task 6: Wire tombstones into delete repo paths

Deletes today rely on FK `ON DELETE CASCADE`, which erases descendants with no record — they would resurrect from the other device after sync. Each delete now records tombstones for the row **and all cascaded descendants** (enumerated before the delete) so the deletion propagates.

**Files:**
- Modify: `src/db/snapshot-repo.ts` (add `collectSnapshotTombstoneKeys`, update `deleteSnapshot`)
- Modify: `src/db/account-repo.ts` (`deleteAccount`)
- Modify: `src/db/asset-repo.ts` (`deleteAsset`)
- Modify: `src/db/tran-repo.ts` (`deleteTransaction`)

**Interfaces:**
- Consumes: `recordTombstones` from `src/sync/stamp`; `CicadaDB` (type) from `src/db/migrations`.
- Produces: `collectSnapshotTombstoneKeys(db: CicadaDB, assetIds: number[]): Promise<string[]>` from `snapshot-repo` — returns composite `"<assetUuid>|<date>"` keys for every snapshot of the given assets (used by `deleteAccount` and `deleteAsset`).

- [ ] **Step 1: snapshot-repo — add the shared key collector and tombstone `deleteSnapshot`**

In `src/db/snapshot-repo.ts`, extend the imports. The file currently imports `getDatabase` and `listAssets`; add the stamp helpers and the `CicadaDB` type:

```ts
import { getDatabase } from './database';
import { listAssets } from './asset-repo';
import { recordTombstones } from '../sync/stamp';
import type { CicadaDB } from './migrations';
import type { AssetSnapshot, SnapshotWithAsset } from '../utils/types';
```

Add this exported helper (place it just above `upsertSnapshot`):

```ts
/**
 * Composite tombstone keys ("<assetUuid>|<date>") for every snapshot belonging
 * to the given assets. Used by deleteAccount/deleteAsset to tombstone snapshots
 * that FK-cascade would otherwise erase silently.
 */
export async function collectSnapshotTombstoneKeys(
  db: CicadaDB,
  assetIds: number[]
): Promise<string[]> {
  if (assetIds.length === 0) return [];
  const placeholders = assetIds.map(() => '?').join(',');
  const rows = await db.getAllAsync<{ uuid: string; date: string }>(
    `SELECT a.uuid AS uuid, s.date AS date
       FROM asset_snapshot s
       JOIN asset a ON s.asset_id = a.id
      WHERE s.asset_id IN (${placeholders})`,
    assetIds
  );
  return rows.map((r) => `${r.uuid}|${r.date}`);
}
```

Replace `deleteSnapshot`:

```ts
export async function deleteSnapshot(assetId: number, date: string): Promise<void> {
  const db = await getDatabase();
  const asset = await db.getFirstAsync<{ uuid: string }>(
    'SELECT uuid FROM asset WHERE id = ?',
    [assetId]
  );
  await db.runAsync(
    'DELETE FROM asset_snapshot WHERE asset_id = ? AND date = ?',
    [assetId, date]
  );
  if (asset?.uuid) {
    await recordTombstones(db, 'snapshot', [`${asset.uuid}|${date}`]);
  }
}
```

- [ ] **Step 2: account-repo — tombstone account + cascaded assets + snapshots**

In `src/db/account-repo.ts`, extend imports:

```ts
import { getDatabase } from './database';
import { stampWrite, recordTombstones } from '../sync/stamp';
import { collectSnapshotTombstoneKeys } from './snapshot-repo';
import type { Account } from '../utils/types';
```

Replace `deleteAccount`:

```ts
export async function deleteAccount(id: number): Promise<void> {
  const db = await getDatabase();
  const account = await db.getFirstAsync<{ uuid: string }>(
    'SELECT uuid FROM account WHERE id = ?',
    [id]
  );
  if (!account) return;
  const assets = await db.getAllAsync<{ id: number; uuid: string }>(
    'SELECT id, uuid FROM asset WHERE account_id = ?',
    [id]
  );
  const snapshotKeys = await collectSnapshotTombstoneKeys(
    db,
    assets.map((a) => a.id)
  );
  // Record tombstones BEFORE the delete (the rows still exist to read).
  await recordTombstones(db, 'account', [account.uuid]);
  await recordTombstones(db, 'asset', assets.map((a) => a.uuid));
  await recordTombstones(db, 'snapshot', snapshotKeys);
  // FK ON DELETE CASCADE clears assets + snapshots locally.
  await db.runAsync('DELETE FROM account WHERE id = ?', [id]);
}
```

- [ ] **Step 3: asset-repo — tombstone asset + cascaded snapshots**

In `src/db/asset-repo.ts`, extend imports:

```ts
import { getDatabase } from './database';
import { stampWrite, recordTombstones } from '../sync/stamp';
import { collectSnapshotTombstoneKeys } from './snapshot-repo';
import type { Asset, AssetWithAccount } from '../utils/types';
```

Replace `deleteAsset`:

```ts
export async function deleteAsset(id: number): Promise<void> {
  const db = await getDatabase();
  const asset = await db.getFirstAsync<{ uuid: string }>(
    'SELECT uuid FROM asset WHERE id = ?',
    [id]
  );
  if (!asset) return;
  const snapshotKeys = await collectSnapshotTombstoneKeys(db, [id]);
  await recordTombstones(db, 'asset', [asset.uuid]);
  await recordTombstones(db, 'snapshot', snapshotKeys);
  await db.runAsync('DELETE FROM asset WHERE id = ?', [id]);
}
```

> Note: `asset-repo` and `snapshot-repo` now import from each other (`snapshot-repo` already imports `listAssets` from `asset-repo`; `asset-repo` now imports `collectSnapshotTombstoneKeys` from `snapshot-repo`). This cycle is between function bodies only (not module-load-time top-level code), so it resolves fine under Metro/TS — the existing `snapshot-repo → asset-repo` import already establishes the pattern.

- [ ] **Step 4: tran-repo — tombstone the transaction**

In `src/db/tran-repo.ts`, extend imports:

```ts
import { getDatabase } from './database';
import { stampWrite, recordTombstones } from '../sync/stamp';
import type { Transaction, TranType } from '../utils/types';
```

Replace `deleteTransaction`:

```ts
export async function deleteTransaction(id: number): Promise<void> {
  const db = await getDatabase();
  const tran = await db.getFirstAsync<{ uuid: string }>(
    'SELECT uuid FROM tran WHERE id = ?',
    [id]
  );
  await db.runAsync('DELETE FROM tran WHERE id = ?', [id]);
  if (tran?.uuid) {
    await recordTombstones(db, 'tran', [tran.uuid]);
  }
}
```

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 6: Manual verification**

```bash
npm run web
```

In the running app: delete a transaction, a snapshot, an asset (with snapshots), and an account (with assets + snapshots). Each delete succeeds with no console errors and the records vanish from the UI. Optionally inspect the `tombstone` table to confirm one row per deleted entity, including cascaded descendants (an account delete writes tombstones for the account, each child asset, and each of their snapshots).

- [ ] **Step 7: Commit**

```bash
git add src/db/snapshot-repo.ts src/db/account-repo.ts src/db/asset-repo.ts src/db/tran-repo.ts
git commit -m "feat(sync): record tombstones (incl. cascaded descendants) on all deletes"
```

---

## Known deferrals (handled in later phases, not Phase 1)

- **Backup import** (`src/services/backup.ts`) still inserts rows without uuid/updated_at and calls `resetDatabase()`. After a Phase-1 build, an import produces rows with NULL `uuid` (SQLite treats NULLs as distinct, so the unique index does not reject them) — harmless while sync is inactive. **Backup format → v3** (carry & re-insert uuid/updated_at) is spec §13 / rollout Phase 5.
- **`hlc.receive()`** (advancing the local clock past remote stamps during merge) is not needed until merge exists — spec rollout Phase 2.
- **No OneDrive/Graph/OAuth/UI** in Phase 1 — the app remains fully offline and unchanged from the user's perspective.

## Self-review notes

- **Spec coverage (§14 Phase 1 = "Schema + HLC + stamping + tombstones"):** v2 migration → Task 2; `hlc.ts` → Task 1; `device.ts` → Task 3; `stamp.ts` → Task 4; repo write paths → Task 5; repo delete paths → Task 6. The `clock.ts`/`sync_state` plumbing the spec implies for a persisted HLC → Task 3.
- **Type consistency:** `stampWrite(db, { withUuid })` returns `{ uuid, updatedAt }` and is consumed identically in Tasks 5–6; `recordTombstones(db, entity, uuids)` and `collectSnapshotTombstoneKeys(db, assetIds)` signatures match their call sites; `Entity` union includes `'snapshot'` (composite-key form) as used by all delete paths.
- **Re-entrancy:** every v2 step is guarded (`columnExists`, `WHERE … IS NULL`, `ON CONFLICT DO NOTHING`, `IF NOT EXISTS`) and `PRAGMA user_version = 2` is last.
</content>
</invoke>
