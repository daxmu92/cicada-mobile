# Cloud Sync — Phase 2 (Part 2): Apply + Reconcile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write the merge result into local SQLite — `reconcile.ts` (natural-key uuid adoption) and `apply.ts` (FK-ordered upsert, uuid→localId translation, explicit cascade delete, cascade-repair, UNIQUE-collision auto-suffix) — proven correct by a real-SQLite (`better-sqlite3`) integration harness including end-to-end two-device convergence tests.

**Architecture:** A new test-only `better-sqlite3` adapter exposes the existing `CicadaDB` interface so the real `migrate()` and the new apply code run against an in-memory SQLite (a faithful proxy: all three production backends are SQLite). `reconcile.ts` adopts a remote uuid onto a local row sharing its natural key. `apply.ts` walks parents→children building a `uuid→localId` map, reconciles then upserts each record, then applies tombstones with **explicit** descendant deletion (never relying on FK cascade — Tauri's pooled connections don't guarantee `PRAGMA foreign_keys`), then a defensive cascade-repair sweep.

**Tech Stack:** TypeScript (strict). Test harness: `node:test` + `tsx` (from Phase 1) + new **dev-only** `better-sqlite3` + `@types/better-sqlite3`.

## Scope note

This completes Phase 2 (the engine). It consumes `MergeResult`/`SyncDocument` from Part 1
(`merge.ts`/`document.ts`, already merged). It does **not** include the orchestrator
(`sync.ts`), `hlc.receive()`, WebDAV, or any UI — those are Phase 3/4.

## Global Constraints

- **Node 20+.** New dependencies are **devDependencies only**: `better-sqlite3` +
  `@types/better-sqlite3`. They must **never** be imported by app/runtime code — only by
  files under `src/sync/test-support/` and `*.test.ts`. App code never gains a native dep.
- **Apply must NOT rely on FK `ON DELETE CASCADE`.** Tauri's connection pool can't
  guarantee `PRAGMA foreign_keys = ON` (see CLAUDE.md). Every descendant deletion is
  issued explicitly (snapshots, then assets, then account).
- **FK-ordered apply:** accounts → assets → snapshots → trans → settings, building a
  `uuid → localIntId` map; children resolve their parent via that map.
- **uuid↔int translation lives entirely in `apply.ts`.** Screens keep using integer ids
  unchanged; the document/merge layers never carry local ids.
- **Sync identity:** account/asset/tran → `uuid`; snapshot → `(asset_id, date)` keyed by
  the document's `(assetUuid, date)`; setting → `key`. Snapshot tombstone uuid is the
  composite `"<assetUuid>|<date>"`.
- **Natural-key adoption (reconcile):** account by `name`; asset by `(accountUuid, name)`.
  **tran: never reconciled.** snapshot/setting need no adoption (their natural key IS the
  upsert key — no surrogate uuid).
- **UNIQUE collisions:** resolve as identity via adoption first; genuinely-different rows
  get the newer one **auto-suffixed** (`"Name (2)"`), recorded in `ApplyResult.suffixed`.
  Never fail the apply or silently drop a row.
- **Authoritative delete:** a tombstoned parent removes its descendants even if a
  descendant was edited concurrently (the merge may mark the child "live"); apply skips
  upserting a child whose parent is absent, and cascade-repair removes any live orphan.
- **`apply.ts`/`reconcile.ts` import only:** the `CicadaDB` type from `../db/migrations`,
  `MergeResult` from `./merge`, the record types from `./document`, and `tick` from
  `./clock`. No RN/Expo, no `better-sqlite3`.
- **Verification per task:** `npx tsc --noEmit` + `npm run lint` + `npm test` all green.
  (Repo has 2 pre-existing ESLint errors in `app/asset/[id].tsx` + 3 pre-existing warnings,
  unrelated — confirm no NEW issues.)

---

### Task 1: Real-SQLite test harness

**Files:**
- Create: `src/sync/test-support/sqlite.ts`
- Create: `src/sync/test-support/sqlite.test.ts`
- Modify: `package.json` (add `better-sqlite3` + `@types/better-sqlite3` devDeps; append the test file)

**Interfaces:**
- Consumes: `migrate`, `CicadaDB` from `../../db/migrations`.
- Produces:
  - `makeMemoryDb(): { db: CicadaDB; raw: import('better-sqlite3').Database }`
  - `makeMigratedDb(): Promise<{ db: CicadaDB; raw: import('better-sqlite3').Database }>`

- [ ] **Step 1: Install dev dependencies and append the test file**

```bash
npm install --save-dev better-sqlite3@^11.8.1 @types/better-sqlite3@^7.6.11
```

In `package.json`, extend the `test` script (keep existing files):

```json
    "test": "node --import tsx --test src/sync/hlc.test.ts src/sync/document.test.ts src/sync/merge.test.ts src/sync/test-support/sqlite.test.ts"
```

- [ ] **Step 2: Write the failing test**

Create `src/sync/test-support/sqlite.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMemoryDb, makeMigratedDb } from './sqlite';

test('makeMemoryDb exposes the CicadaDB interface over better-sqlite3', async () => {
  const { db } = makeMemoryDb();
  await db.execAsync('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
  const r = await db.runAsync('INSERT INTO t (v) VALUES (?)', ['hi']);
  assert.equal(r.changes, 1);
  assert.ok(r.lastInsertRowId > 0);
  const row = await db.getFirstAsync<{ v: string }>('SELECT v FROM t WHERE id = ?', [r.lastInsertRowId]);
  assert.equal(row?.v, 'hi');
  const all = await db.getAllAsync<{ v: string }>('SELECT v FROM t');
  assert.equal(all.length, 1);
});

test('makeMigratedDb produces a v2 schema with sync_state seeded', async () => {
  const { db } = await makeMigratedDb();
  const ver = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  assert.equal(ver?.user_version, 2);
  // Phase-1 migration seeds deviceId + hlc into sync_state.
  const dev = await db.getFirstAsync<{ value: string }>("SELECT value FROM sync_state WHERE key = 'deviceId'");
  assert.ok(dev?.value && dev.value.length === 6);
  // Core tables exist and are queryable.
  for (const t of ['account', 'asset', 'asset_snapshot', 'tran', 'setting', 'tombstone']) {
    const rows = await db.getAllAsync(`SELECT * FROM ${t}`);
    assert.ok(Array.isArray(rows));
  }
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './sqlite'`.

- [ ] **Step 4: Write the implementation**

Create `src/sync/test-support/sqlite.ts`:

```ts
// TEST-ONLY. Imports better-sqlite3 (a native dev dependency) and must never be
// imported by app/runtime code — only by *.test.ts files. Gives the real
// migrate() and apply code a genuine in-memory SQLite to run against. All three
// production backends are SQLite, so this is a faithful behavioral proxy.

import Database from 'better-sqlite3';
import { migrate, type CicadaDB, type SqlParam } from '../../db/migrations';

export function makeMemoryDb(): { db: CicadaDB; raw: Database.Database } {
  const raw = new Database(':memory:');
  raw.pragma('foreign_keys = ON');

  const db: CicadaDB = {
    async getAllAsync<T = any>(sql: string, params: SqlParam[] = []): Promise<T[]> {
      return raw.prepare(sql).all(...params) as T[];
    },
    async getFirstAsync<T = any>(sql: string, params: SqlParam[] = []): Promise<T | null> {
      return (raw.prepare(sql).get(...params) ?? null) as T | null;
    },
    async runAsync(sql: string, params: SqlParam[] = []) {
      const r = raw.prepare(sql).run(...params);
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: r.changes };
    },
    async execAsync(sql: string): Promise<void> {
      raw.exec(sql);
    },
    async withTransactionAsync(task: () => Promise<void>): Promise<void> {
      // better-sqlite3's own transaction wrapper is sync-only; for tests we just
      // run the task (atomicity is not what these tests exercise).
      await task();
    },
  };
  return { db, raw };
}

export async function makeMigratedDb(): Promise<{ db: CicadaDB; raw: Database.Database }> {
  const h = makeMemoryDb();
  await migrate(h.db);
  return h;
}
```

> If `tsc` reports a default-import error for `better-sqlite3`, the project tsconfig
> already enables `esModuleInterop` (Expo's base config); the `import Database from
> 'better-sqlite3'` form is correct. `PRAGMA user_version` is read via `prepare().get()`
> which better-sqlite3 supports.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — both harness tests green, plus all earlier suites.

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors (only pre-existing lint issues).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/sync/test-support/sqlite.ts src/sync/test-support/sqlite.test.ts
git commit -m "test(sync): better-sqlite3 CicadaDB harness for apply/reconcile tests"
```

---

### Task 2: Reconcile + apply upserts

**Files:**
- Create: `src/sync/reconcile.ts`
- Create: `src/sync/apply.ts`
- Create: `src/sync/apply.test.ts`
- Modify: `package.json` (append `apply.test.ts`)

**Interfaces:**
- Consumes: `CicadaDB` from `../db/migrations`; `MergeResult` from `./merge`;
  `AccountRecord`, `AssetRecord`, `SnapshotRecord`, `TranRecord`, `SettingRecord` from
  `./document`; `makeMigratedDb` from `./test-support/sqlite` (tests only).
- Produces:
  - `reconcile.ts`: `adoptAccountUuid(db, rec: AccountRecord): Promise<void>`,
    `adoptAssetUuid(db, rec: AssetRecord, accountId: number): Promise<void>`
  - `apply.ts`: `type ApplyResult = { suffixed: string[] }`,
    `applyMerge(db: CicadaDB, merged: MergeResult): Promise<ApplyResult>`
    (this task implements upserts + reconcile; tombstones/cascade come in Task 3, but the
    function and its tombstone loop scaffold are added now so the signature is final).

- [ ] **Step 1: Append the test file**

In `package.json`:

```json
    "test": "node --import tsx --test src/sync/hlc.test.ts src/sync/document.test.ts src/sync/merge.test.ts src/sync/test-support/sqlite.test.ts src/sync/apply.test.ts"
```

- [ ] **Step 2: Write the failing test**

Create `src/sync/apply.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMigratedDb } from './test-support/sqlite';
import { applyMerge } from './apply';
import type { MergeResult } from './merge';

const ts = (p: number, c = 0, d = 'aaaaaa') =>
  `${String(p).padStart(15, '0')}-${String(c).padStart(5, '0')}-${d}`;

function emptyMerge(): MergeResult {
  return { tables: { account: [], asset: [], snapshot: [], tran: [], setting: [] }, tombstones: [] };
}

test('applyMerge inserts a fresh account/asset/snapshot/tran/setting', async () => {
  const { db } = await makeMigratedDb();
  const m = emptyMerge();
  m.tables.account = [{ uuid: 'acc1', name: 'Bank', archived: 0, updated_at: ts(1) }];
  m.tables.asset = [{ uuid: 'as1', accountUuid: 'acc1', name: 'Savings', categories: '{}', archived: 0, updated_at: ts(2) }];
  m.tables.snapshot = [{ assetUuid: 'as1', date: '2026-06', netWorth: 100, inflow: 10, profit: 5, updated_at: ts(3) }];
  m.tables.tran = [{ uuid: 'tr1', date: '2026-06-01', type: 'INCOME', value: 50, cat: 'x', note: 'n', updated_at: ts(4) }];
  m.tables.setting = [{ key: 'currency', value: '$', updated_at: ts(5) }];

  const res = await applyMerge(db, m);
  assert.deepEqual(res.suffixed, []);

  const acc = await db.getFirstAsync<{ id: number; uuid: string }>('SELECT id, uuid FROM account');
  assert.equal(acc?.uuid, 'acc1');
  const as = await db.getFirstAsync<{ account_id: number; uuid: string }>('SELECT account_id, uuid FROM asset');
  assert.equal(as?.account_id, acc?.id); // FK resolved via uuid->id map
  const sn = await db.getFirstAsync<{ net_worth: number }>('SELECT net_worth FROM asset_snapshot');
  assert.equal(sn?.net_worth, 100);
  const tr = await db.getFirstAsync<{ value: number }>('SELECT value FROM tran');
  assert.equal(tr?.value, 50);
  const st = await db.getFirstAsync<{ value: string }>("SELECT value FROM setting WHERE key='currency'");
  assert.equal(st?.value, '$');
});

test('applyMerge updates an existing row by uuid', async () => {
  const { db } = await makeMigratedDb();
  const first = emptyMerge();
  first.tables.account = [{ uuid: 'acc1', name: 'Bank', archived: 0, updated_at: ts(1) }];
  await applyMerge(db, first);

  const second = emptyMerge();
  second.tables.account = [{ uuid: 'acc1', name: 'Renamed', archived: 1, updated_at: ts(9) }];
  await applyMerge(db, second);

  const rows = await db.getAllAsync<{ name: string; archived: number }>('SELECT name, archived FROM account');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Renamed');
  assert.equal(rows[0].archived, 1);
});

test('first-connect: same account name with a different uuid is adopted, not duplicated', async () => {
  const { db, raw } = await makeMigratedDb();
  // Local row created independently (its own uuid).
  raw.prepare('INSERT INTO account (name, archived, uuid, updated_at) VALUES (?, ?, ?, ?)')
    .run('Bank', 0, 'local-uuid', ts(1));
  // Remote brings "Bank" under a different uuid.
  const m = emptyMerge();
  m.tables.account = [{ uuid: 'remote-uuid', name: 'Bank', archived: 0, updated_at: ts(2) }];
  await applyMerge(db, m);

  const rows = await db.getAllAsync<{ uuid: string }>('SELECT uuid FROM account');
  assert.equal(rows.length, 1); // adopted, not duplicated
  assert.equal(rows[0].uuid, 'remote-uuid');
});

test('genuinely different accounts sharing a name: newer is auto-suffixed, not dropped', async () => {
  const { db, raw } = await makeMigratedDb();
  raw.prepare('INSERT INTO account (name, archived, uuid, updated_at) VALUES (?, ?, ?, ?)')
    .run('Bank', 0, 'uuidA', ts(5)); // local "Bank" is NEWER, keeps the name
  const m = emptyMerge();
  m.tables.account = [{ uuid: 'uuidB', name: 'Bank', archived: 0, updated_at: ts(1) }]; // different uuid, older
  const res = await applyMerge(db, m);

  const rows = await db.getAllAsync<{ name: string; uuid: string }>('SELECT name, uuid FROM account ORDER BY name');
  assert.equal(rows.length, 2); // both kept
  const suffixed = rows.find(r => r.uuid === 'uuidB');
  assert.equal(suffixed?.name, 'Bank (2)');
  assert.ok(res.suffixed.includes('account:Bank'));
});

test('asset re-parenting moves the asset to the new account', async () => {
  const { db } = await makeMigratedDb();
  const base = emptyMerge();
  base.tables.account = [
    { uuid: 'accA', name: 'A', archived: 0, updated_at: ts(1) },
    { uuid: 'accB', name: 'B', archived: 0, updated_at: ts(1) },
  ];
  base.tables.asset = [{ uuid: 'as1', accountUuid: 'accA', name: 'X', categories: '{}', archived: 0, updated_at: ts(2) }];
  await applyMerge(db, base);

  const move = emptyMerge();
  move.tables.account = base.tables.account;
  move.tables.asset = [{ uuid: 'as1', accountUuid: 'accB', name: 'X', categories: '{}', archived: 0, updated_at: ts(9) }];
  await applyMerge(db, move);

  const row = await db.getFirstAsync<{ account_id: number }>('SELECT account_id FROM asset WHERE uuid = ?', ['as1']);
  const accB = await db.getFirstAsync<{ id: number }>("SELECT id FROM account WHERE uuid = 'accB'");
  assert.equal(row?.account_id, accB?.id);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './apply'`.

- [ ] **Step 4: Write `reconcile.ts`**

Create `src/sync/reconcile.ts`:

```ts
import type { CicadaDB } from '../db/migrations';
import type { AccountRecord, AssetRecord } from './document';

// Natural-key uuid adoption. When a remote record's natural key matches a LOCAL
// row that has a DIFFERENT uuid (the onboarding case: both devices created the
// "same" account independently), adopt the remote uuid onto the local row so the
// subsequent upsert-by-uuid UPDATEs it instead of colliding on UNIQUE(name).
// Only adopt when no local row already holds the remote uuid (that would violate
// the uuid unique index). tran/snapshot/setting need no adoption — their natural
// key already IS the upsert key.

export async function adoptAccountUuid(db: CicadaDB, rec: AccountRecord): Promise<void> {
  const local = await db.getFirstAsync<{ id: number; uuid: string }>(
    'SELECT id, uuid FROM account WHERE name = ?',
    [rec.name]
  );
  if (!local || local.uuid === rec.uuid) return;
  const clash = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM account WHERE uuid = ?',
    [rec.uuid]
  );
  if (clash) return;
  await db.runAsync('UPDATE account SET uuid = ? WHERE id = ?', [rec.uuid, local.id]);
}

export async function adoptAssetUuid(
  db: CicadaDB,
  rec: AssetRecord,
  accountId: number
): Promise<void> {
  const local = await db.getFirstAsync<{ id: number; uuid: string }>(
    'SELECT id, uuid FROM asset WHERE account_id = ? AND name = ?',
    [accountId, rec.name]
  );
  if (!local || local.uuid === rec.uuid) return;
  const clash = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM asset WHERE uuid = ?',
    [rec.uuid]
  );
  if (clash) return;
  await db.runAsync('UPDATE asset SET uuid = ? WHERE id = ?', [rec.uuid, local.id]);
}
```

- [ ] **Step 5: Write `apply.ts` (upserts + reconcile; tombstone loop is a stub for Task 3)**

Create `src/sync/apply.ts`:

```ts
import type { CicadaDB } from '../db/migrations';
import type { MergeResult } from './merge';
import type {
  AccountRecord,
  AssetRecord,
  SnapshotRecord,
  TranRecord,
  SettingRecord,
} from './document';
import { adoptAccountUuid, adoptAssetUuid } from './reconcile';

export type ApplyResult = { suffixed: string[] };

/** A non-colliding name for `desired`, ignoring the row that owns `exceptUuid`. */
async function uniqueAccountName(db: CicadaDB, desired: string, exceptUuid: string): Promise<string> {
  let name = desired;
  let n = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const clash = await db.getFirstAsync<{ uuid: string }>(
      'SELECT uuid FROM account WHERE name = ? AND uuid != ?',
      [name, exceptUuid]
    );
    if (!clash) return name;
    name = `${desired} (${n++})`;
  }
}

async function uniqueAssetName(
  db: CicadaDB,
  accountId: number,
  desired: string,
  exceptUuid: string
): Promise<string> {
  let name = desired;
  let n = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const clash = await db.getFirstAsync<{ uuid: string }>(
      'SELECT uuid FROM asset WHERE account_id = ? AND name = ? AND uuid != ?',
      [accountId, name, exceptUuid]
    );
    if (!clash) return name;
    name = `${desired} (${n++})`;
  }
}

async function upsertAccount(db: CicadaDB, rec: AccountRecord, suffixed: string[]): Promise<number> {
  const existing = await db.getFirstAsync<{ id: number }>('SELECT id FROM account WHERE uuid = ?', [rec.uuid]);
  const name = await uniqueAccountName(db, rec.name, rec.uuid);
  if (name !== rec.name) suffixed.push(`account:${rec.name}`);
  if (existing) {
    await db.runAsync('UPDATE account SET name = ?, archived = ?, updated_at = ? WHERE uuid = ?', [
      name, rec.archived, rec.updated_at, rec.uuid,
    ]);
    return existing.id;
  }
  const r = await db.runAsync('INSERT INTO account (name, archived, uuid, updated_at) VALUES (?, ?, ?, ?)', [
    name, rec.archived, rec.uuid, rec.updated_at,
  ]);
  return r.lastInsertRowId;
}

async function upsertAsset(db: CicadaDB, rec: AssetRecord, accountId: number, suffixed: string[]): Promise<number> {
  const existing = await db.getFirstAsync<{ id: number }>('SELECT id FROM asset WHERE uuid = ?', [rec.uuid]);
  const name = await uniqueAssetName(db, accountId, rec.name, rec.uuid);
  if (name !== rec.name) suffixed.push(`asset:${rec.name}`);
  if (existing) {
    await db.runAsync(
      'UPDATE asset SET account_id = ?, name = ?, categories = ?, archived = ?, updated_at = ? WHERE uuid = ?',
      [accountId, name, rec.categories, rec.archived, rec.updated_at, rec.uuid]
    );
    return existing.id;
  }
  const r = await db.runAsync(
    'INSERT INTO asset (account_id, name, categories, archived, uuid, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [accountId, name, rec.categories, rec.archived, rec.uuid, rec.updated_at]
  );
  return r.lastInsertRowId;
}

async function upsertSnapshot(db: CicadaDB, rec: SnapshotRecord, assetId: number): Promise<void> {
  await db.runAsync(
    `INSERT INTO asset_snapshot (asset_id, date, net_worth, inflow, profit, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(asset_id, date) DO UPDATE SET
       net_worth = excluded.net_worth, inflow = excluded.inflow,
       profit = excluded.profit, updated_at = excluded.updated_at`,
    [assetId, rec.date, rec.netWorth, rec.inflow, rec.profit, rec.updated_at]
  );
}

async function upsertTran(db: CicadaDB, rec: TranRecord): Promise<void> {
  const existing = await db.getFirstAsync<{ id: number }>('SELECT id FROM tran WHERE uuid = ?', [rec.uuid]);
  if (existing) {
    await db.runAsync('UPDATE tran SET date = ?, type = ?, value = ?, cat = ?, note = ?, updated_at = ? WHERE uuid = ?', [
      rec.date, rec.type, rec.value, rec.cat, rec.note, rec.updated_at, rec.uuid,
    ]);
    return;
  }
  await db.runAsync('INSERT INTO tran (date, type, value, cat, note, uuid, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    rec.date, rec.type, rec.value, rec.cat, rec.note, rec.uuid, rec.updated_at,
  ]);
}

async function upsertSetting(db: CicadaDB, rec: SettingRecord): Promise<void> {
  await db.runAsync(
    `INSERT INTO setting (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [rec.key, rec.value, rec.updated_at]
  );
}

export async function applyMerge(db: CicadaDB, merged: MergeResult): Promise<ApplyResult> {
  const suffixed: string[] = [];
  await db.withTransactionAsync(async () => {
    const accountId = new Map<string, number>();
    for (const rec of merged.tables.account) {
      await adoptAccountUuid(db, rec);
      accountId.set(rec.uuid, await upsertAccount(db, rec, suffixed));
    }

    const assetId = new Map<string, number>();
    for (const rec of merged.tables.asset) {
      const accId = accountId.get(rec.accountUuid);
      if (accId === undefined) continue; // orphan (parent absent) — cascade-repair handles it (Task 3)
      await adoptAssetUuid(db, rec, accId);
      assetId.set(rec.uuid, await upsertAsset(db, rec, accId, suffixed));
    }

    for (const rec of merged.tables.snapshot) {
      const asId = assetId.get(rec.assetUuid);
      if (asId === undefined) continue; // orphan snapshot — skip
      await upsertSnapshot(db, rec, asId);
    }

    for (const rec of merged.tables.tran) await upsertTran(db, rec);
    for (const rec of merged.tables.setting) await upsertSetting(db, rec);

    // Tombstone application + cascade-repair are added in Task 3.
  });
  return { suffixed };
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all 5 `apply.test.ts` tests plus earlier suites.

- [ ] **Step 7: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors (only pre-existing lint issues).

- [ ] **Step 8: Commit**

```bash
git add package.json src/sync/reconcile.ts src/sync/apply.ts src/sync/apply.test.ts
git commit -m "feat(sync): apply upserts + natural-key reconcile (uuid->id, suffix)"
```

---

### Task 3: Tombstone application + explicit cascade + cascade-repair

**Files:**
- Modify: `src/sync/apply.ts` (add tombstone application, explicit descendant delete, cascade-repair to `applyMerge`)
- Modify: `src/sync/apply.test.ts` (add delete/cascade tests)

**Interfaces:**
- Consumes: everything from Task 2; `MergeResult.tombstones` (`TombstoneRecord[]`).
- Produces: no new exports — `applyMerge`'s behavior is completed.

- [ ] **Step 1: Write the failing tests (append to `apply.test.ts`)**

Append to `src/sync/apply.test.ts`:

```ts
test('a tombstone deletes the matching local row and is persisted for propagation', async () => {
  const { db } = await makeMigratedDb();
  const seed = emptyMerge();
  seed.tables.tran = [{ uuid: 'tr1', date: 'd', type: 'INCOME', value: 1, cat: '', note: '', updated_at: ts(1) }];
  await applyMerge(db, seed);

  const del = emptyMerge();
  del.tombstones = [{ entity: 'tran', uuid: 'tr1', deleted_at: ts(2) }];
  await applyMerge(db, del);

  assert.equal((await db.getAllAsync('SELECT * FROM tran')).length, 0);
  const tomb = await db.getFirstAsync<{ deleted_at: string }>("SELECT deleted_at FROM tombstone WHERE entity='tran' AND uuid='tr1'");
  assert.equal(tomb?.deleted_at, ts(2)); // kept locally so it keeps propagating
});

test('a tombstone does NOT delete a resurrected (newer) live record', async () => {
  const { db } = await makeMigratedDb();
  const m = emptyMerge();
  // merge already decided the record is live (newer than the tombstone); apply must keep it.
  m.tables.tran = [{ uuid: 'tr1', date: 'd', type: 'INCOME', value: 1, cat: '', note: '', updated_at: ts(5) }];
  m.tombstones = [{ entity: 'tran', uuid: 'tr1', deleted_at: ts(2) }];
  await applyMerge(db, m);
  assert.equal((await db.getAllAsync('SELECT * FROM tran')).length, 1);
});

test('deleting an account explicitly removes its assets and snapshots (no FK reliance)', async () => {
  const { db, raw } = await makeMigratedDb();
  raw.pragma('foreign_keys = OFF'); // simulate Tauri, where ON DELETE CASCADE may not fire
  const seed = emptyMerge();
  seed.tables.account = [{ uuid: 'acc1', name: 'Bank', archived: 0, updated_at: ts(1) }];
  seed.tables.asset = [{ uuid: 'as1', accountUuid: 'acc1', name: 'S', categories: '{}', archived: 0, updated_at: ts(2) }];
  seed.tables.snapshot = [{ assetUuid: 'as1', date: '2026-06', netWorth: 1, inflow: 0, profit: 0, updated_at: ts(3) }];
  await applyMerge(db, seed);

  const del = emptyMerge();
  del.tombstones = [{ entity: 'account', uuid: 'acc1', deleted_at: ts(9) }];
  await applyMerge(db, del);

  assert.equal((await db.getAllAsync('SELECT * FROM account')).length, 0);
  assert.equal((await db.getAllAsync('SELECT * FROM asset')).length, 0);       // explicit delete, not FK
  assert.equal((await db.getAllAsync('SELECT * FROM asset_snapshot')).length, 0);
});

test('parent-delete wins over a concurrent child edit (cascade-repair removes the live orphan)', async () => {
  const { db, raw } = await makeMigratedDb();
  raw.pragma('foreign_keys = OFF');
  const seed = emptyMerge();
  seed.tables.account = [{ uuid: 'acc1', name: 'Bank', archived: 0, updated_at: ts(1) }];
  seed.tables.asset = [{ uuid: 'as1', accountUuid: 'acc1', name: 'S', categories: '{}', archived: 0, updated_at: ts(2) }];
  await applyMerge(db, seed);

  // The account is tombstoned, but the asset survives the merge as "live" (edited concurrently).
  const m = emptyMerge();
  m.tables.asset = [{ uuid: 'as1', accountUuid: 'acc1', name: 'S-edited', categories: '{}', archived: 0, updated_at: ts(8) }];
  m.tombstones = [{ entity: 'account', uuid: 'acc1', deleted_at: ts(9) }];
  await applyMerge(db, m);

  assert.equal((await db.getAllAsync('SELECT * FROM account')).length, 0);
  assert.equal((await db.getAllAsync('SELECT * FROM asset')).length, 0); // orphan removed — parent delete wins
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — the new delete/cascade tests fail (rows not deleted) because `applyMerge` does not yet apply tombstones.

- [ ] **Step 3: Add tombstone application + cascade-repair to `apply.ts`**

In `src/sync/apply.ts`, add these helpers above `applyMerge`:

```ts
import type { TombstoneRecord } from './document';

/** Explicitly delete an account and ALL descendants (never relies on FK cascade). */
async function deleteAccountTree(db: CicadaDB, uuid: string): Promise<void> {
  const acc = await db.getFirstAsync<{ id: number }>('SELECT id FROM account WHERE uuid = ?', [uuid]);
  if (!acc) return;
  await db.runAsync(
    'DELETE FROM asset_snapshot WHERE asset_id IN (SELECT id FROM asset WHERE account_id = ?)',
    [acc.id]
  );
  await db.runAsync('DELETE FROM asset WHERE account_id = ?', [acc.id]);
  await db.runAsync('DELETE FROM account WHERE id = ?', [acc.id]);
}

async function deleteAssetTree(db: CicadaDB, uuid: string): Promise<void> {
  const a = await db.getFirstAsync<{ id: number }>('SELECT id FROM asset WHERE uuid = ?', [uuid]);
  if (!a) return;
  await db.runAsync('DELETE FROM asset_snapshot WHERE asset_id = ?', [a.id]);
  await db.runAsync('DELETE FROM asset WHERE id = ?', [a.id]);
}

async function applyTombstone(
  db: CicadaDB,
  t: TombstoneRecord,
  live: { account: Set<string>; asset: Set<string>; snapshot: Set<string>; tran: Set<string> }
): Promise<void> {
  // Always persist the tombstone locally (max deleted_at) so it keeps propagating.
  await db.runAsync(
    `INSERT INTO tombstone (entity, uuid, deleted_at) VALUES (?, ?, ?)
     ON CONFLICT(entity, uuid) DO UPDATE SET deleted_at = excluded.deleted_at`,
    [t.entity, t.uuid, t.deleted_at]
  );
  // If the merge kept the record alive (resurrection), do not delete it.
  if (t.entity === 'account') {
    if (live.account.has(t.uuid)) return;
    await deleteAccountTree(db, t.uuid);
  } else if (t.entity === 'asset') {
    if (live.asset.has(t.uuid)) return;
    await deleteAssetTree(db, t.uuid);
  } else if (t.entity === 'tran') {
    if (live.tran.has(t.uuid)) return;
    await db.runAsync('DELETE FROM tran WHERE uuid = ?', [t.uuid]);
  } else if (t.entity === 'snapshot') {
    if (live.snapshot.has(t.uuid)) return;
    const sep = t.uuid.indexOf('|');
    const assetUuid = t.uuid.slice(0, sep);
    const date = t.uuid.slice(sep + 1);
    await db.runAsync(
      'DELETE FROM asset_snapshot WHERE date = ? AND asset_id = (SELECT id FROM asset WHERE uuid = ?)',
      [date, assetUuid]
    );
  }
}

/** Defensive sweep: remove any live orphan whose parent ended up absent. */
async function cascadeRepair(db: CicadaDB): Promise<void> {
  await db.runAsync('DELETE FROM asset WHERE account_id NOT IN (SELECT id FROM account)');
  await db.runAsync('DELETE FROM asset_snapshot WHERE asset_id NOT IN (SELECT id FROM asset)');
}
```

Then, inside `applyMerge`, replace the trailing comment
`// Tombstone application + cascade-repair are added in Task 3.` with:

```ts
    const live = {
      account: new Set(merged.tables.account.map((r) => r.uuid)),
      asset: new Set(merged.tables.asset.map((r) => r.uuid)),
      snapshot: new Set(merged.tables.snapshot.map((r) => `${r.assetUuid}|${r.date}`)),
      tran: new Set(merged.tables.tran.map((r) => r.uuid)),
    };
    for (const t of merged.tombstones) await applyTombstone(db, t, live);

    await cascadeRepair(db);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all `apply.test.ts` tests (9 total) plus earlier suites.

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors (only pre-existing lint issues).

- [ ] **Step 6: Commit**

```bash
git add src/sync/apply.ts src/sync/apply.test.ts
git commit -m "feat(sync): apply tombstones with explicit cascade + cascade-repair"
```

---

### Task 4: End-to-end two-device convergence tests

Proves the whole engine: build → merge → apply on two independent DBs converges to the
same state, and a second sync round is a no-op (idempotent).

**Files:**
- Create: `src/sync/convergence.test.ts`
- Modify: `package.json` (append `convergence.test.ts`)

**Interfaces:**
- Consumes: `makeMigratedDb` (`./test-support/sqlite`), `buildDocument` (`./document`),
  `merge` (`./merge`), `applyMerge` (`./apply`).

- [ ] **Step 1: Append the test file**

In `package.json`:

```json
    "test": "node --import tsx --test src/sync/hlc.test.ts src/sync/document.test.ts src/sync/merge.test.ts src/sync/test-support/sqlite.test.ts src/sync/apply.test.ts src/sync/convergence.test.ts"
```

- [ ] **Step 2: Write the convergence tests**

Create `src/sync/convergence.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Database } from 'better-sqlite3';
import { makeMigratedDb } from './test-support/sqlite';
import { buildDocument } from './document';
import { merge } from './merge';
import { applyMerge } from './apply';
import type { CicadaDB } from '../db/migrations';

const ts = (p: number, c = 0, d = 'aaaaaa') =>
  `${String(p).padStart(15, '0')}-${String(c).padStart(5, '0')}-${d}`;

// Snapshot of the domain tables for equality comparison (ignores local ids).
async function snapshotState(db: CicadaDB) {
  const norm = (rows: any[], keys: string[]) =>
    rows
      .map((r) => keys.map((k) => `${k}=${r[k]}`).join('|'))
      .sort();
  return {
    account: norm(await db.getAllAsync('SELECT uuid, name, archived FROM account'), ['uuid', 'name', 'archived']),
    asset: norm(
      await db.getAllAsync('SELECT a.uuid AS uuid, acc.uuid AS p, a.name AS name FROM asset a JOIN account acc ON a.account_id = acc.id'),
      ['uuid', 'p', 'name']
    ),
    snapshot: norm(
      await db.getAllAsync('SELECT a.uuid AS p, s.date AS date, s.net_worth AS nw FROM asset_snapshot s JOIN asset a ON s.asset_id = a.id'),
      ['p', 'date', 'nw']
    ),
    tran: norm(await db.getAllAsync('SELECT uuid, value FROM tran'), ['uuid', 'value']),
  };
}

// One full sync round between two DBs via a shared document (A pushes, B pulls+pushes, A pulls).
async function syncRound(a: { db: CicadaDB }, b: { db: CicadaDB }) {
  const docA = await buildDocument(a.db, { generatedBy: 'A', generatedAt: 'x' });
  const docB = await buildDocument(b.db, { generatedBy: 'B', generatedAt: 'x' });
  await applyMerge(b.db, merge(docB, docA)); // B merges in A
  const docB2 = await buildDocument(b.db, { generatedBy: 'B', generatedAt: 'x' });
  await applyMerge(a.db, merge(docA, docB2)); // A merges in B's merged result
}

test('two devices with disjoint offline edits converge to the same state', async () => {
  const A = await makeMigratedDb();
  const B = await makeMigratedDb();
  // A creates account+asset; B creates a transaction. Independent uuids.
  await applyMerge(A.db, {
    tables: {
      account: [{ uuid: 'accA', name: 'Bank', archived: 0, updated_at: ts(1) }],
      asset: [{ uuid: 'asA', accountUuid: 'accA', name: 'S', categories: '{}', archived: 0, updated_at: ts(2) }],
      snapshot: [], tran: [], setting: [],
    },
    tombstones: [],
  });
  await applyMerge(B.db, {
    tables: { account: [], asset: [], snapshot: [],
      tran: [{ uuid: 'trB', date: 'd', type: 'INCOME', value: 7, cat: '', note: '', updated_at: ts(3) }],
      setting: [] },
    tombstones: [],
  });

  await syncRound(A, B);

  assert.deepEqual(await snapshotState(A.db), await snapshotState(B.db));
  // Both ended up with the account, asset, and the transaction.
  assert.equal((await A.db.getAllAsync('SELECT * FROM account')).length, 1);
  assert.equal((await A.db.getAllAsync('SELECT * FROM tran')).length, 1);
});

test('a delete on A propagates to B and a second round changes nothing (idempotent)', async () => {
  const A = await makeMigratedDb();
  const B = await makeMigratedDb();
  const seed = {
    tables: { account: [], asset: [], snapshot: [],
      tran: [{ uuid: 'tr1', date: 'd', type: 'INCOME', value: 1, cat: '', note: '', updated_at: ts(1) }],
      setting: [] },
    tombstones: [],
  };
  await applyMerge(A.db, seed);
  await applyMerge(B.db, seed);
  // A deletes the transaction.
  await applyMerge(A.db, {
    tables: { account: [], asset: [], snapshot: [], tran: [], setting: [] },
    tombstones: [{ entity: 'tran', uuid: 'tr1', deleted_at: ts(5) }],
  });

  await syncRound(A, B);
  assert.equal((await B.db.getAllAsync('SELECT * FROM tran')).length, 0); // delete propagated
  const stateAfterFirst = await snapshotState(B.db);

  await syncRound(A, B); // second round
  assert.deepEqual(await snapshotState(B.db), stateAfterFirst); // no change — idempotent
  assert.deepEqual(await snapshotState(A.db), await snapshotState(B.db));
});

test('first-connect: both devices independently created the same-named account -> one account', async () => {
  const A = await makeMigratedDb();
  const B = await makeMigratedDb();
  await applyMerge(A.db, {
    tables: { account: [{ uuid: 'accA', name: 'Cash', archived: 0, updated_at: ts(1) }], asset: [], snapshot: [], tran: [], setting: [] },
    tombstones: [],
  });
  await applyMerge(B.db, {
    tables: { account: [{ uuid: 'accB', name: 'Cash', archived: 0, updated_at: ts(2) }], asset: [], snapshot: [], tran: [], setting: [] },
    tombstones: [],
  });

  await syncRound(A, B);
  await syncRound(A, B); // a second round to let adoption settle both directions

  assert.deepEqual(await snapshotState(A.db), await snapshotState(B.db));
  assert.equal((await A.db.getAllAsync('SELECT * FROM account')).length, 1); // adopted into one
});
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all convergence tests plus every earlier suite.

> If the first-connect convergence test does not collapse to a single account, the bug is
> in adoption ordering (reconcile must run before upsert at each level) or in the round
> exchanging documents — fix `reconcile.ts`/`apply.ts`, not the test.

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors (only pre-existing lint issues).

- [ ] **Step 5: Commit**

```bash
git add package.json src/sync/convergence.test.ts
git commit -m "test(sync): end-to-end two-device convergence + idempotency"
```

---

## Self-review notes

- **Spec coverage (design §8 apply, §10 reconcile):** uuid→id FK-ordered upsert → Task 2;
  natural-key adoption (account by name, asset by (accountUuid,name); tran none;
  snapshot/setting key-is-identity) → Task 2 (`reconcile.ts`); UNIQUE auto-suffix +
  re-parenting → Task 2; tombstone apply + authoritative cascade (explicit, no FK
  reliance) + cascade-repair → Task 3; end-to-end convergence/idempotency verification
  (design §11) → Task 4.
- **Type consistency:** `applyMerge(db, merged: MergeResult): Promise<ApplyResult>` is
  defined in Task 2 and only extended (not re-signed) in Task 3. `adoptAccountUuid`/
  `adoptAssetUuid` signatures match their Task-2 call sites. Snapshot composite key
  `"<assetUuid>|<date>"` is identical in `applyTombstone`, the `live.snapshot` set, and
  Phase 1's persisted tombstones.
- **Tauri FK caveat honored:** Task 3 deletes descendants explicitly and the tests run
  with `foreign_keys = OFF` to prove it does not depend on cascade.
- **No new runtime dependency:** `better-sqlite3` is dev-only, imported solely from
  `test-support/` and `*.test.ts`.
- **No placeholders; every step carries complete code or an exact command.**
</content>
