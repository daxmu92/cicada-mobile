# Cloud Sync — Phase 5 Design: Backup v3, Tombstone GC, Polish

**Date:** 2026-06-21
**Status:** Approved design
**Extends:** `2026-06-02-cloud-sync-design.md` §13–14 and `2026-06-20-cloud-sync-webdav-design.md`. Phases 1–4 are complete and merged to `master`. This is the final phase.

## 0. Scope

Three deliverables, all on top of the working sync feature:

1. **Backup v3** — make export/import carry sync identity so a restored device participates in sync correctly (today a v2 restore leaves NULL `uuid`/`updated_at` → broken merges).
2. **Tombstone GC** — bound the tombstone set with a 90-day retention window, pruned after a successful sync.
3. **Polish** — a `sync-in-progress` crash-recovery flag (Tauri non-atomic apply) + the carried-over Phase-2 Minor cleanups.

Non-goals (unchanged): at-rest encryption (the `enc` envelope stays reserved), multi-user, web/PWA sync.

## 1. Backup v3 (`src/services/backup.ts`)

`BACKUP_VERSION = 3`. The current file is v2 (`{version, exportedAt, accounts, assets, snapshots, transactions, settings: Record<string,string>}`), and `restoreBackup` resets the DB then re-INSERTs rows **without** `uuid`/`updated_at` — so restored rows have NULL sync identity.

### 1.1 `buildBackup` (v3 shape)

Each row gains its sync columns; settings become an array (so the merge identity round-trips); a top-level `tombstones` array is added:

```ts
type BackupAccountV3  = { id; name; archived; uuid: string; updated_at: string };
type BackupAssetV3    = { id; accountId; name; categories; archived; uuid: string; updated_at: string };
type BackupSnapshotV3 = { assetId; date; netWorth; inflow; profit; updated_at: string }; // identity = (assetId,date)
type BackupTranV3     = { id; date; type; value; cat; note; uuid: string; updated_at: string };
type BackupSettingV3  = { key: string; value: string; updated_at: string };
type BackupTombstone  = { entity: string; uuid: string; deleted_at: string };

type BackupFileV3 = {
  version: 3;
  exportedAt: string;
  accounts: BackupAccountV3[];
  assets: BackupAssetV3[];
  snapshots: BackupSnapshotV3[];
  transactions: BackupTranV3[];
  settings: BackupSettingV3[];
  tombstones: BackupTombstone[];
};
```

The in-memory `BackupFile` type becomes a union of the legacy shape (v1/v2) and v3, or v3 with optional sync fields — implementation detail for the plan. `exportBackup` is otherwise unchanged (Blob download on web, `expo-file-system` + `expo-sharing` on native).

### 1.2 Import / restore

`parseBackup` still rejects `version > 3`. `restoreBackup` branches on `parsed.version`:

- **v3** → INSERT rows **with** their carried `uuid`/`updated_at`; INSERT settings with `updated_at`; INSERT the `tombstones`. Sync identity is preserved exactly, so the next sync merges correctly and does not resurrect deleted rows.
- **v1 / v2 (legacy)** → INSERT as today (no sync columns), then **backfill fresh** `uuid` (`lower(hex(randomblob(16)))`) on every NULL and a single fresh `updated_at` stamp (`tick()`) on every NULL — mirroring the v2 migration's backfill. The restored dataset becomes sync-capable as **new** data (no NULL identity). Legacy backups have no tombstones, so none are restored.

Backfill must run **inside** the same restore transaction (native) so a restore is still all-or-nothing where the backend allows it. (Tauri's restore remains non-atomic, as already documented.)

### 1.3 Why this is correct

Per `2026-06-02` §13: the v3 import path must INSERT the backup's `uuid`/`updated_at` rather than letting fresh ones be minted, or a restore re-randomizes sync identity and breaks future merges. Carrying tombstones additionally prevents a restored device from resurrecting rows it had deleted before the backup (the delete is still known). Legacy backfill keeps old backups usable without a NULL-identity trap.

## 2. Tombstone GC

Tombstones propagate forever otherwise. `deleted_at` is an HLC string whose **physical component is ms-epoch** (`parseHlc(deleted_at).phys`), so age is computable without a separate timestamp.

```ts
// src/sync/sync.ts (or a sibling gc.ts)
gcTombstones(db: CicadaDB, nowMs: number, retentionDays = 90): Promise<number>
// DELETE FROM tombstone WHERE <parsed phys> < nowMs - retentionDays*86_400_000; returns rows pruned.
```

Called at the **end of `runSync`** after a successful push (both the `merged` and, harmlessly, the `seeded` path may call it — seeded has no tombstones to prune). Pure-DB and idempotent → unit-testable with the better-sqlite3 harness.

**Accepted risk (documented, unchanged from §13):** a device offline longer than the retention window can resurrect a single row — its un-GC'd peer still holds the live row and re-propagates it. For single-user, foreground-triggered sync this window is acceptable. A future device-registry horizon can tighten it.

The 90 days is a constant (`TOMBSTONE_RETENTION_DAYS = 90`); the SQL filters by parsed phys, not by string compare (HLC strings are not date-ordered across the counter/device fields, but phys alone is the wall-clock).

## 3. Polish

### 3.1 `sync-in-progress` crash-recovery flag

Tauri's pooled connection makes `applyMerge` non-atomic (its `withTransactionAsync` is a no-op there), so a crash mid-apply can leave a partially-merged DB. Mitigation (spec §13):

- `runSync` sets `sync_state['sync_in_progress'] = '1'` immediately before `applyMerge`, and `'0'` after a successful push. Left `'1'` on any failure.
- On launch, `SyncContext` (only when `isSyncAvailable()`): if the flag is `'1'`, run `cascadeRepair(db)` (exported from `apply.ts`) to drop any orphaned children left by a half-applied merge, then clear the flag, then proceed with the normal launch sync. The launch sync's idempotent re-merge fully reconciles. If offline, `cascadeRepair` alone leaves the local DB internally consistent (no dangling FKs) until the next successful sync.

`cascadeRepair` is currently a private helper in `apply.ts` (`DELETE FROM asset WHERE account_id NOT IN (SELECT id FROM account)` + the snapshot equivalent). Phase 5 exports it unchanged so the recovery path can call it.

### 3.2 Carried-over Phase-2 Minor cleanups

- **reconcile.ts** — the adopt SELECTs fetch `updated_at` but never use it. Drop the column from both `adoptAccountUuid` and `adoptAssetUuid` SELECTs.
- **apply.ts `live` sets** — built from `merged.tables.*` (all merged rows), including assets/snapshots skipped as orphans (parent absent). Build the `live` sets from the **actually-applied** uuids instead, so the resurrection-suppression check in `applyTombstone` reflects what's really in the DB. (Behaviorally harmless today — a tombstone for a never-inserted orphan finds nothing to delete either way — but it removes a latent inconsistency.)
- **suffix re-stamp — documented, NOT changed.** When `applyMerge` renames a genuine-uuid-collision row to "`X (2)`", it keeps the record's `updated_at`. Re-stamping with a fresh HLC inside apply would make apply non-idempotent (every sync re-suffixes + re-stamps → ping-pong), which is worse. So this is left as-is and documented: in the rare genuine-uuid-collision case (same name **and** different uuid **and** a uuid clash that blocks adoption), the suffixed name may differ across devices until a manual rename. This collision is extremely unlikely given reconcile unifies same-name rows on uuid adoption first.

## 4. Error handling & edge cases

- **Corrupt/old backup** → `parseBackup` throws (existing behavior); restore is not attempted; live data untouched until `resetDatabase()` (the existing import contract — import replaces all data).
- **v3 with unknown extra fields** → ignored (structural validation only checks required arrays, like `parseDocument`).
- **GC during a no-ETag sync** → unaffected; GC is local and runs after the push regardless of precondition mode.
- **Recovery flag set but sync fails at launch** → `cascadeRepair` already ran (local consistency), flag stays set until a sync succeeds; no data loss (re-merge is idempotent).

## 5. Testing

Unit (node:test + tsx + the better-sqlite3 harness; `backup.ts` itself imports RN/expo so its **pure pieces** — `buildBackup`'s row-mapping and `restoreBackup`'s SQL — are tested against the harness `CicadaDB`, not through the RN file-IO wrappers; if `backup.ts` can't be imported under tsx, extract the build/restore core into a testable module the plan defines):

- **Backup v3 round-trip:** build a doc from a stamped DB → serialize → parse → restore into a fresh harness DB → assert `uuid`/`updated_at`/tombstones survive byte-for-byte.
- **Legacy restore backfill:** restore a v2-shaped file → assert every row has a non-NULL `uuid` and `updated_at` (fresh), and no tombstones.
- **`gcTombstones`:** seed tombstones with phys above/below the cutoff → assert only the old ones are pruned; returns the count.
- **`cascadeRepair` + recovery:** insert an orphan asset/snapshot → run repair → orphans gone; flag-set → recovery clears it.

Manual / cross-target (developer): export on one device → import on another → connect both to 坚果云 → sync → confirm no resurrection and identical state; verify a v2 backup still imports (backfilled) and the app works.

## 6. Module layout (delta)

```
src/services/backup.ts     # v3 build/parse/restore (+ legacy backfill); extract a testable core if needed
src/sync/sync.ts           # + gcTombstones call at end of runSync; + sync_in_progress flag around applyMerge
src/sync/apply.ts          # export cascadeRepair; build live sets from applied uuids
src/sync/reconcile.ts      # drop unused updated_at from adopt SELECTs
src/hooks/SyncContext.tsx  # launch recovery: if sync_in_progress, cascadeRepair + clear, then sync
```

No new dependencies. No schema change (still `SCHEMA_VERSION = 2`).
