# Cloud Sync — Phase 2 (Part 1): Sync Document + Merge Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, dependency-free core of cloud sync — the `cicada-sync.json` document (build/parse/serialize) and the order-independent per-record last-write-wins `merge()` — both fully unit-tested under `node --test`, with no DB writes and no network.

**Architecture:** Two new files in `src/sync/`. `document.ts` defines the wire types, a DB-reading `buildDocument()` (the only impure function — pure SELECTs, no writes), and pure `parseDocument()`/`serializeDocument()`. `merge.ts` is 100% pure: it takes two documents and returns the merged live record set + unioned tombstones, using HLC ordinal compare for LWW and treating each tombstone as a competing record. apply (writing the merge into SQLite) and reconcile are the *next* plan.

**Tech Stack:** TypeScript (strict). Reuses the Phase-1 `node:test` + `tsx` harness. No new dependencies.

## Scope note

The design spec's Phase 2 bundles document + merge + apply + reconcile. This plan
deliberately covers only **document + merge** — the pure half. They form a complete,
independently-testable unit (a merge engine with full coverage of the highest-risk LWW /
tombstone logic). **apply.ts + reconcile.ts** are DB-bound, need a real-SQLite test
harness, and are specified in a follow-up plan that consumes `merge()`'s output type
defined here. This split keeps each plan fully-coded and reviewable.

## Global Constraints

- **Node 20+.** **No new dependency** in this plan (runtime or dev) — the Phase-1
  `tsx` + `node:test` harness is reused.
- **`merge.ts` is 100% pure:** it imports only `compareHlc` from `./hlc` and types from
  `./document`. No DB, no `Date`, no RN/Expo. It must stay node-testable.
- **`document.ts` pure functions** (`parseDocument`, `serializeDocument`, all types) import
  nothing from RN/Expo. `buildDocument()` may import the `CicadaDB` type and
  `SCHEMA_VERSION` from `../db/migrations`; it issues **only SELECTs**, never writes.
- **HLC comparison is ordinal via `compareHlc(a, b)`** (from Phase 1). Never `localeCompare`,
  never raw `<` on stamps outside `compareHlc`.
- **Foreign keys travel as the parent's uuid** in the document: `asset.accountUuid`,
  `snapshot.assetUuid` — never local integer ids.
- **Sync identity per table:** `account`/`asset`/`tran` → `uuid`; `snapshot` →
  composite `"<assetUuid>|<date>"`; `setting` → `key`. **Settings have no tombstones.**
- **Tombstone identity:** `"<entity>|<uuid>"`, where for snapshots `uuid` is the composite
  `"<assetUuid>|<date>"` (matches what Phase 1's `recordTombstones` already wrote).
- **`schemaVersion` in a built document equals `SCHEMA_VERSION`** (currently 2). The
  envelope is fixed: `syncFormatVersion: 1`, `enc: 'none'`.
- **merge must be commutative and idempotent** (order-independent; merging a doc with
  itself is a no-op on the live set).
- **Verification per task:** `npx tsc --noEmit` + `npm run lint` + `npm test` all green.
  (Repo has 2 pre-existing ESLint errors in `app/asset/[id].tsx` + 3 pre-existing warnings,
  unrelated — confirm no NEW issues.)

---

### Task 1: Sync document — types, build, parse, serialize

**Files:**
- Create: `src/sync/document.ts`
- Create: `src/sync/document.test.ts`
- Modify: `package.json` (append `document.test.ts` to the `test` script)

**Interfaces:**
- Consumes: `CicadaDB`, `SCHEMA_VERSION` from `../db/migrations`.
- Produces (used by Task 2 and the apply/reconcile plan):
  - Record types `AccountRecord`, `AssetRecord`, `SnapshotRecord`, `TranRecord`,
    `SettingRecord`, `TombstoneRecord`; container `SyncTables`; document `SyncDocument`.
  - `buildDocument(db: CicadaDB, meta: { generatedBy: string; generatedAt: string }): Promise<SyncDocument>`
  - `parseDocument(content: string): SyncDocument`
  - `serializeDocument(doc: SyncDocument): string`

- [ ] **Step 1: Append the test file to the `test` script**

In `package.json`, change the `test` script to add the new file (keep `hlc.test.ts`):

```json
    "test": "node --import tsx --test src/sync/hlc.test.ts src/sync/document.test.ts"
```

- [ ] **Step 2: Write the failing test**

Create `src/sync/document.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDocument, serializeDocument, type SyncDocument } from './document';

function sampleDoc(): SyncDocument {
  return {
    syncFormatVersion: 1,
    enc: 'none',
    schemaVersion: 2,
    generatedAt: '2026-06-20T00:00:00.000Z',
    generatedBy: 'a1b2c3',
    tables: {
      account: [{ uuid: 'acc-1', name: 'Bank', archived: 0, updated_at: '000000000000100-00000-a1b2c3' }],
      asset: [{ uuid: 'as-1', accountUuid: 'acc-1', name: 'Savings', categories: '{}', archived: 0, updated_at: '000000000000100-00001-a1b2c3' }],
      snapshot: [{ assetUuid: 'as-1', date: '2026-06', netWorth: 100, inflow: 0, profit: 0, updated_at: '000000000000100-00002-a1b2c3' }],
      tran: [{ uuid: 'tr-1', date: '2026-06-01', type: 'INCOME', value: 50, cat: '', note: '', updated_at: '000000000000100-00003-a1b2c3' }],
      setting: [{ key: 'currency', value: '$', updated_at: '000000000000100-00004-a1b2c3' }],
    },
    tombstones: [{ entity: 'tran', uuid: 'tr-old', deleted_at: '000000000000099-00000-a1b2c3' }],
  };
}

test('serializeDocument -> parseDocument round-trips', () => {
  const doc = sampleDoc();
  const back = parseDocument(serializeDocument(doc));
  assert.deepEqual(back, doc);
});

test('parseDocument rejects non-JSON', () => {
  assert.throws(() => parseDocument('{not json'), /valid JSON/);
});

test('parseDocument rejects wrong syncFormatVersion', () => {
  const doc = { ...sampleDoc(), syncFormatVersion: 2 };
  assert.throws(() => parseDocument(JSON.stringify(doc)), /syncFormatVersion/);
});

test('parseDocument rejects a missing table', () => {
  const doc: any = sampleDoc();
  delete doc.tables.tran;
  assert.throws(() => parseDocument(JSON.stringify(doc)), /tables\.tran/);
});

test('parseDocument rejects a non-array table', () => {
  const doc: any = sampleDoc();
  doc.tables.account = {};
  assert.throws(() => parseDocument(JSON.stringify(doc)), /tables\.account/);
});

test('parseDocument rejects missing tombstones array', () => {
  const doc: any = sampleDoc();
  delete doc.tombstones;
  assert.throws(() => parseDocument(JSON.stringify(doc)), /tombstones/);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './document'`.

- [ ] **Step 4: Write the implementation**

Create `src/sync/document.ts`:

```ts
import type { CicadaDB } from '../db/migrations';
import { SCHEMA_VERSION } from '../db/migrations';

// The cicada-sync.json wire format. Foreign keys travel as the PARENT'S uuid
// (accountUuid / assetUuid) so two devices' independent integer-id spaces line up.

export type AccountRecord = {
  uuid: string;
  name: string;
  archived: number;
  updated_at: string;
};

export type AssetRecord = {
  uuid: string;
  accountUuid: string;
  name: string;
  categories: string; // JSON string, stored verbatim
  archived: number;
  updated_at: string;
};

export type SnapshotRecord = {
  assetUuid: string;
  date: string; // "YYYY-MM"
  netWorth: number;
  inflow: number;
  profit: number;
  updated_at: string;
};

export type TranRecord = {
  uuid: string;
  date: string;
  type: string;
  value: number;
  cat: string;
  note: string;
  updated_at: string;
};

export type SettingRecord = {
  key: string;
  value: string;
  updated_at: string;
};

export type TombstoneRecord = {
  entity: string;
  uuid: string; // for snapshots: "<assetUuid>|<date>"
  deleted_at: string;
};

export type SyncTables = {
  account: AccountRecord[];
  asset: AssetRecord[];
  snapshot: SnapshotRecord[];
  tran: TranRecord[];
  setting: SettingRecord[];
};

export type SyncDocument = {
  syncFormatVersion: 1;
  enc: 'none';
  schemaVersion: number;
  generatedAt: string;
  generatedBy: string;
  tables: SyncTables;
  tombstones: TombstoneRecord[];
};

const TABLE_NAMES: (keyof SyncTables)[] = ['account', 'asset', 'snapshot', 'tran', 'setting'];

/**
 * Read the whole local DB into a SyncDocument. SELECT-only (never writes).
 * FKs are resolved to parent uuids via joins. `archived` comes back as 0/1.
 */
export async function buildDocument(
  db: CicadaDB,
  meta: { generatedBy: string; generatedAt: string }
): Promise<SyncDocument> {
  const account = await db.getAllAsync<AccountRecord>(
    'SELECT uuid, name, archived, updated_at FROM account'
  );
  const asset = await db.getAllAsync<AssetRecord>(
    `SELECT a.uuid AS uuid, acc.uuid AS accountUuid, a.name AS name,
            a.categories AS categories, a.archived AS archived, a.updated_at AS updated_at
       FROM asset a
       JOIN account acc ON a.account_id = acc.id`
  );
  const snapshot = await db.getAllAsync<SnapshotRecord>(
    `SELECT a.uuid AS assetUuid, s.date AS date, s.net_worth AS netWorth,
            s.inflow AS inflow, s.profit AS profit, s.updated_at AS updated_at
       FROM asset_snapshot s
       JOIN asset a ON s.asset_id = a.id`
  );
  const tran = await db.getAllAsync<TranRecord>(
    'SELECT uuid, date, type, value, cat, note, updated_at FROM tran'
  );
  const setting = await db.getAllAsync<SettingRecord>(
    'SELECT key, value, updated_at FROM setting'
  );
  const tombstones = await db.getAllAsync<TombstoneRecord>(
    'SELECT entity, uuid, deleted_at FROM tombstone'
  );

  return {
    syncFormatVersion: 1,
    enc: 'none',
    schemaVersion: SCHEMA_VERSION,
    generatedAt: meta.generatedAt,
    generatedBy: meta.generatedBy,
    tables: { account, asset, snapshot, tran, setting },
    tombstones,
  };
}

export function serializeDocument(doc: SyncDocument): string {
  return JSON.stringify(doc);
}

/**
 * Structural validation only. Policy checks (enc !== 'none', schemaVersion ahead
 * of this app) are the orchestrator's job, not this function's.
 */
export function parseDocument(content: string): SyncDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('sync document is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('sync document is not an object');
  }
  const d = parsed as Record<string, unknown>;
  if (d.syncFormatVersion !== 1) {
    throw new Error(`unsupported syncFormatVersion: ${String(d.syncFormatVersion)}`);
  }
  if (!d.tables || typeof d.tables !== 'object') {
    throw new Error('sync document missing tables');
  }
  const tables = d.tables as Record<string, unknown>;
  for (const name of TABLE_NAMES) {
    if (!Array.isArray(tables[name])) {
      throw new Error(`sync document tables.${name} is not an array`);
    }
  }
  if (!Array.isArray(d.tombstones)) {
    throw new Error('sync document tombstones is not an array');
  }
  return parsed as SyncDocument;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all `document.test.ts` and the existing `hlc.test.ts` tests green.

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors (only the pre-existing lint issues).

- [ ] **Step 7: Commit**

```bash
git add package.json src/sync/document.ts src/sync/document.test.ts
git commit -m "feat(sync): cicada-sync document types, build/parse/serialize"
```

---

### Task 2: Pure merge engine (`merge.ts`)

**Files:**
- Create: `src/sync/merge.ts`
- Create: `src/sync/merge.test.ts`
- Modify: `package.json` (append `merge.test.ts` to the `test` script)

**Interfaces:**
- Consumes: `compareHlc` from `./hlc`; all record/table/document types from `./document`.
- Produces (used by the apply/reconcile plan):
  - `type MergeResult = { tables: SyncTables; tombstones: TombstoneRecord[] }`
  - `merge(local: SyncDocument, remote: SyncDocument): MergeResult`

- [ ] **Step 1: Append the test file to the `test` script**

In `package.json`, change the `test` script to add `merge.test.ts`:

```json
    "test": "node --import tsx --test src/sync/hlc.test.ts src/sync/document.test.ts src/sync/merge.test.ts"
```

- [ ] **Step 2: Write the failing test**

Create `src/sync/merge.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { merge } from './merge';
import type { SyncDocument } from './document';

// HLC strings are fixed-width; a bigger phys sorts later. Helper for readability.
const ts = (phys: number, counter = 0, dev = 'aaaaaa') =>
  `${String(phys).padStart(15, '0')}-${String(counter).padStart(5, '0')}-${dev}`;

function emptyDoc(): SyncDocument {
  return {
    syncFormatVersion: 1, enc: 'none', schemaVersion: 2,
    generatedAt: 'x', generatedBy: 'dev',
    tables: { account: [], asset: [], snapshot: [], tran: [], setting: [] },
    tombstones: [],
  };
}

test('disjoint records from both sides are unioned', () => {
  const local = emptyDoc();
  local.tables.account = [{ uuid: 'a', name: 'A', archived: 0, updated_at: ts(1) }];
  const remote = emptyDoc();
  remote.tables.account = [{ uuid: 'b', name: 'B', archived: 0, updated_at: ts(1) }];
  const r = merge(local, remote);
  assert.deepEqual(r.tables.account.map(a => a.uuid).sort(), ['a', 'b']);
});

test('same uuid: the greater updated_at wins (remote newer)', () => {
  const local = emptyDoc();
  local.tables.account = [{ uuid: 'a', name: 'old', archived: 0, updated_at: ts(1) }];
  const remote = emptyDoc();
  remote.tables.account = [{ uuid: 'a', name: 'new', archived: 0, updated_at: ts(2) }];
  const r = merge(local, remote);
  assert.equal(r.tables.account.length, 1);
  assert.equal(r.tables.account[0].name, 'new');
});

test('same uuid: local newer wins', () => {
  const local = emptyDoc();
  local.tables.account = [{ uuid: 'a', name: 'localnew', archived: 0, updated_at: ts(5) }];
  const remote = emptyDoc();
  remote.tables.account = [{ uuid: 'a', name: 'remoteold', archived: 0, updated_at: ts(2) }];
  const r = merge(local, remote);
  assert.equal(r.tables.account[0].name, 'localnew');
});

test('tombstone newer than the record suppresses it', () => {
  const local = emptyDoc();
  local.tables.tran = [{ uuid: 't', date: 'd', type: 'INCOME', value: 1, cat: '', note: '', updated_at: ts(1) }];
  const remote = emptyDoc();
  remote.tombstones = [{ entity: 'tran', uuid: 't', deleted_at: ts(2) }];
  const r = merge(local, remote);
  assert.equal(r.tables.tran.length, 0);
  assert.deepEqual(r.tombstones, [{ entity: 'tran', uuid: 't', deleted_at: ts(2) }]);
});

test('record newer than the tombstone (resurrection) keeps the record', () => {
  const local = emptyDoc();
  local.tables.tran = [{ uuid: 't', date: 'd', type: 'INCOME', value: 1, cat: '', note: '', updated_at: ts(5) }];
  const remote = emptyDoc();
  remote.tombstones = [{ entity: 'tran', uuid: 't', deleted_at: ts(2) }];
  const r = merge(local, remote);
  assert.equal(r.tables.tran.length, 1);
});

test('tombstones union keeps the greater deleted_at', () => {
  const local = emptyDoc();
  local.tombstones = [{ entity: 'asset', uuid: 'x', deleted_at: ts(1) }];
  const remote = emptyDoc();
  remote.tombstones = [{ entity: 'asset', uuid: 'x', deleted_at: ts(9) }];
  const r = merge(local, remote);
  assert.deepEqual(r.tombstones, [{ entity: 'asset', uuid: 'x', deleted_at: ts(9) }]);
});

test('snapshot identity is composite (assetUuid|date)', () => {
  const local = emptyDoc();
  local.tables.snapshot = [{ assetUuid: 'as', date: '2026-06', netWorth: 1, inflow: 0, profit: 0, updated_at: ts(1) }];
  const remote = emptyDoc();
  remote.tables.snapshot = [
    { assetUuid: 'as', date: '2026-06', netWorth: 2, inflow: 0, profit: 0, updated_at: ts(2) }, // same cell, newer
    { assetUuid: 'as', date: '2026-07', netWorth: 3, inflow: 0, profit: 0, updated_at: ts(1) }, // different cell
  ];
  const r = merge(local, remote);
  const june = r.tables.snapshot.find(s => s.date === '2026-06');
  const july = r.tables.snapshot.find(s => s.date === '2026-07');
  assert.equal(june?.netWorth, 2);
  assert.equal(july?.netWorth, 3);
  assert.equal(r.tables.snapshot.length, 2);
});

test('a snapshot tombstone uses the composite key', () => {
  const local = emptyDoc();
  local.tables.snapshot = [{ assetUuid: 'as', date: '2026-06', netWorth: 1, inflow: 0, profit: 0, updated_at: ts(1) }];
  const remote = emptyDoc();
  remote.tombstones = [{ entity: 'snapshot', uuid: 'as|2026-06', deleted_at: ts(2) }];
  const r = merge(local, remote);
  assert.equal(r.tables.snapshot.length, 0);
});

test('settings merge by key and are never tombstone-suppressed', () => {
  const local = emptyDoc();
  local.tables.setting = [{ key: 'currency', value: '$', updated_at: ts(1) }];
  const remote = emptyDoc();
  remote.tables.setting = [{ key: 'currency', value: '¥', updated_at: ts(2) }];
  remote.tombstones = [{ entity: 'setting', uuid: 'currency', deleted_at: ts(9) }]; // must be ignored
  const r = merge(local, remote);
  assert.equal(r.tables.setting.length, 1);
  assert.equal(r.tables.setting[0].value, '¥');
});

test('merge is commutative on the live set', () => {
  const a = emptyDoc();
  a.tables.account = [{ uuid: 'a', name: 'A1', archived: 0, updated_at: ts(1) }];
  a.tables.tran = [{ uuid: 't', date: 'd', type: 'INCOME', value: 1, cat: '', note: '', updated_at: ts(3) }];
  const b = emptyDoc();
  b.tables.account = [{ uuid: 'a', name: 'A2', archived: 0, updated_at: ts(2) }];
  b.tombstones = [{ entity: 'tran', uuid: 't', deleted_at: ts(2) }];
  const ab = merge(a, b);
  const ba = merge(b, a);
  const norm = (xs: { uuid: string; name: string }[]) => xs.map(x => `${x.uuid}:${x.name}`).sort();
  assert.deepEqual(norm(ab.tables.account), norm(ba.tables.account));
  assert.equal(ab.tables.tran.length, ba.tables.tran.length);
  assert.equal(ab.tables.tran.length, 1); // tran edit (ts3) beats tombstone (ts2)
});

test('merge is idempotent: merging a built result with one input is stable', () => {
  const a = emptyDoc();
  a.tables.account = [{ uuid: 'a', name: 'A', archived: 0, updated_at: ts(2) }];
  const b = emptyDoc();
  b.tables.account = [{ uuid: 'a', name: 'A', archived: 0, updated_at: ts(1) }];
  const once = merge(a, b);
  const asDoc: SyncDocument = { ...a, tables: once.tables, tombstones: once.tombstones };
  const twice = merge(asDoc, b);
  assert.deepEqual(twice.tables.account, once.tables.account);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './merge'`.

- [ ] **Step 4: Write the implementation**

Create `src/sync/merge.ts`:

```ts
import { compareHlc } from './hlc';
import type {
  SyncDocument,
  SyncTables,
  TombstoneRecord,
} from './document';

export type MergeResult = {
  tables: SyncTables;
  tombstones: TombstoneRecord[];
};

const snapshotKey = (s: { assetUuid: string; date: string }): string =>
  `${s.assetUuid}|${s.date}`;

/** Keep, per key, the record with the greater stamp (ordinal HLC compare). */
function mergeByKey<T>(
  local: T[],
  remote: T[],
  key: (r: T) => string,
  stamp: (r: T) => string
): Map<string, T> {
  const out = new Map<string, T>();
  for (const r of local) out.set(key(r), r);
  for (const r of remote) {
    const k = key(r);
    const cur = out.get(k);
    if (!cur || compareHlc(stamp(r), stamp(cur)) > 0) out.set(k, r);
  }
  return out;
}

export function merge(local: SyncDocument, remote: SyncDocument): MergeResult {
  // Tombstones compete like records, keyed "<entity>|<uuid>", by deleted_at.
  const tombMap = mergeByKey(
    local.tombstones,
    remote.tombstones,
    (t) => `${t.entity}|${t.uuid}`,
    (t) => t.deleted_at
  );

  const accounts = mergeByKey(local.tables.account, remote.tables.account, (r) => r.uuid, (r) => r.updated_at);
  const assets = mergeByKey(local.tables.asset, remote.tables.asset, (r) => r.uuid, (r) => r.updated_at);
  const snapshots = mergeByKey(local.tables.snapshot, remote.tables.snapshot, snapshotKey, (r) => r.updated_at);
  const trans = mergeByKey(local.tables.tran, remote.tables.tran, (r) => r.uuid, (r) => r.updated_at);
  const settings = mergeByKey(local.tables.setting, remote.tables.setting, (r) => r.key, (r) => r.updated_at);

  // A record is suppressed when a tombstone for the same entity+key is at least
  // as new as the record (delete wins ties; HLC ties across devices are
  // impossible — different deviceId — and on one device tick() is strictly
  // increasing, so "tie" never arises in practice).
  const live = <T>(
    entity: string,
    map: Map<string, T>,
    tombKey: (r: T) => string,
    stamp: (r: T) => string
  ): T[] => {
    const result: T[] = [];
    for (const r of map.values()) {
      const t = tombMap.get(`${entity}|${tombKey(r)}`);
      if (t && compareHlc(t.deleted_at, stamp(r)) >= 0) continue;
      result.push(r);
    }
    return result;
  };

  return {
    tables: {
      account: live('account', accounts, (r) => r.uuid, (r) => r.updated_at),
      asset: live('asset', assets, (r) => r.uuid, (r) => r.updated_at),
      snapshot: live('snapshot', snapshots, snapshotKey, (r) => r.updated_at),
      tran: live('tran', trans, (r) => r.uuid, (r) => r.updated_at),
      setting: Array.from(settings.values()), // settings are never tombstoned
    },
    tombstones: Array.from(tombMap.values()),
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all `merge.test.ts`, `document.test.ts`, `hlc.test.ts` tests green.

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors (only the pre-existing lint issues).

- [ ] **Step 7: Commit**

```bash
git add package.json src/sync/merge.ts src/sync/merge.test.ts
git commit -m "feat(sync): pure per-record LWW merge engine"
```

---

## What this plan does NOT cover (next plan)

- **`apply.ts`** — FK-ordered write of a `MergeResult` into SQLite, uuid→localId
  translation, authoritative cascade-repair, `UNIQUE`-collision auto-suffix.
- **`reconcile.ts`** — natural-key uuid adoption on first connect.
- **A real-SQLite (`better-sqlite3`) integration harness** to test apply + reconcile +
  merge end-to-end (build two in-memory DBs, simulate offline edits on each, sync,
  assert convergence). That harness decision is made in the apply/reconcile plan because
  apply is the first code that genuinely needs a DB to test.
- **`hlc.receive()` / `advanceReceive`** (advancing the local clock past merged-in remote
  stamps) — belongs with the orchestrator (sync.ts), Phase 4.

## Self-review notes

- **Spec coverage (design §6 document, §7 merge):** document envelope + FK-as-parent-uuid
  + settings-as-array-with-updated_at → Task 1; per-record LWW by HLC + tombstone-competes
  + commutative/idempotent → Task 2. apply (§8) and reconcile (§10) are explicitly the
  next plan.
- **Type consistency:** `MergeResult.tables` is the same `SyncTables` shape `buildDocument`
  produces, so the apply plan can consume either. `snapshotKey`/tombstone composite
  `"<assetUuid>|<date>"` is identical to Phase 1's `recordTombstones` snapshot key and to
  the document's `snapshot` identity. `compareHlc` is the only stamp comparator used.
- **Purity:** `merge.ts` imports only `compareHlc` + types; `document.ts` pure functions
  import nothing from RN/Expo; `buildDocument` is SELECT-only.
- **No placeholders; every step carries complete code.**
</content>
