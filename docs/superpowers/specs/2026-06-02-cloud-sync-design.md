# Cloud Sync — Design Spec

**Date:** 2026-06-02
**Status:** Approved (pending implementation plan)
**Feature:** Multi-device sync of all CicadaFinScape data through the user's own
OneDrive, with offline-tolerant per-record merge.

---

## 1. Goal & scope

CicadaFinScape is a local-first personal finance tracker. Today all data lives in
on-device SQLite with **no backend and no network dependency**. This feature adds
optional **sync across one user's own devices** (phone, desktop, browser, PWA) while
preserving the "no backend we operate" principle: data moves through a single file in
the **user's own OneDrive**, not through a server we run.

### Locked decisions

| Decision | Choice |
|---|---|
| Use case | Single user, multiple of their own devices |
| Transport | A single file in the user's own cloud storage |
| Provider (v1) | **OneDrive** via Microsoft Graph, OAuth 2.0 (PKCE), app-scoped folder |
| Merge model | **Per-record last-write-wins** (Approach 1: additive sync columns; integer PKs kept) |
| Conflict ordering | **Hybrid Logical Clocks (HLC)** — tolerant of device clock skew |
| Targets (v1) | All five: iOS, Android, browser, PWA, Tauri desktop |
| Sync timing | On app open/foreground + manual "Sync now" button |
| Encryption | Rely on OneDrive account security; file format is encryption-ready for later |

### Non-goals (v1)

- No multi-user / shared-account editing, no real-time collaboration.
- No second storage provider (the `SyncRemote` interface leaves room for one later).
- No at-rest encryption (the `enc` envelope field reserves it for a future version).
- No version-vector conflict UI: same-field concurrent edits resolve by newest HLC
  (one value wins, deterministically). This is acceptable for a single user.

---

## 2. Guiding principle

**All sync complexity lives in a new `src/sync/` module plus a purely additive schema
migration. Existing repos, screens, routes, and integer primary keys stay as they are.**

The only existing code that changes:
- **Write paths** in the repos — stamp an HLC `updated_at` on insert/update.
- **Delete paths** in the repos — record tombstones (incl. cascaded descendants) so
  deletions propagate and don't resurrect.

**Read paths, `UNIQUE` constraints, screens, routes, and the `id: number` type stay
untouched.**

---

## 3. Architecture

### 3.1 Module layout

```
src/sync/
  hlc.ts              # Hybrid Logical Clock: tick() / receive(); persisted state
  device.ts           # stable per-device id (generated once)
  document.ts         # build/parse the sync file (extends buildBackup logic)
  merge.ts            # PURE per-record LWW merge (the testable core)
  apply.ts            # write a merged result to the local DB (FK-ordered)
  reconcile.ts        # one-time natural-key adoption on first connect
  sync.ts             # orchestrator: pull -> merge -> apply -> push (ETag-guarded)
  providers/
    types.ts          # SyncRemote interface (read/write/auth)
    onedrive.ts       # Microsoft Graph implementation
  auth/
    auth.ts           # native OAuth (expo-auth-session + PKCE)
    auth.web.ts       # web MSAL.js; branches to Tauri loopback when __TAURI_INTERNALS__
src/hooks/SyncContext.tsx   # status + connect/disconnect + syncNow; triggers on foreground
```

The Settings screen gains a **"Cloud Sync"** section: connect/disconnect OneDrive,
"Sync now" button, last-synced time, and status/error display.

### 3.2 Data flow

```
   device A                         OneDrive (approot)                   device B
  ┌────────┐   pull  ┌───────────────────────────────────┐   pull   ┌────────┐
  │ SQLite │◀────────│        cicada-sync.json            │─────────▶│ SQLite │
  │  +HLC  │────────▶│  (rows + HLC updated_at + tombs)   │◀─────────│  +HLC  │
  └────────┘  push   └───────────────────────────────────┘   push   └────────┘
         (ETag If-Match guards concurrent writers)
```

Each device: pull the file → merge it with local (pure, LWW by HLC) → apply to local
DB → push the merged result back (ETag-guarded). Idempotent and order-independent.

---

## 4. Schema migration (`SCHEMA_VERSION` 1 → 2, additive only)

Defined in `src/db/migrations.ts`; runs on every backend via the `CicadaDB` interface.

- Add to `account`, `asset`, `tran`:
  - `uuid TEXT` + a `UNIQUE` index (global sync identity).
  - `updated_at TEXT` (HLC string).
- Add to `asset_snapshot`: `updated_at TEXT`. Its sync identity is the **natural key
  `(asset's uuid, date)`** — no separate uuid (snapshots are never renamed).
- Add to `setting`: `updated_at TEXT`. Identity is `key`.
- New table `tombstone(entity TEXT, uuid TEXT, deleted_at TEXT, PRIMARY KEY(entity, uuid))`.
  - For snapshots the `uuid` key is the composite `"<assetUuid>|<date>"`.
- New table `sync_state(key TEXT PRIMARY KEY, value TEXT)` — **device-local, never
  synced**: deviceId, HLC state, last ETag, last-synced time, connected-account info.
  OAuth tokens live in platform secure storage, **not** here.

### Backfill (in the `migrate()` v2 block)

- `uuid = lower(hex(randomblob(16)))` for every existing `account`/`asset`/`tran` row
  (generated in SQL, no JS round-trip needed).
- `updated_at` = a single HLC value stamped once at migration time, applied to all
  existing rows.
- Bump `PRAGMA user_version` to 2 and `SCHEMA_VERSION = 2`.

**Why a tombstone table instead of a `deleted` column:** keeps every existing `SELECT`
and `UNIQUE(name)` constraint unchanged. Local deletes stay hard-deletes; we merely
also record a tombstone so the deletion propagates and a stale create can't resurrect
the row. A `deleted` column would have forced partial unique indexes (table rebuild)
and a `deleted = 0` filter on every read query.

---

## 5. Hybrid Logical Clock (`hlc.ts`)

`updated_at` is a fixed-width string so a plain string comparison **is** the HLC
comparison:

```
"<physicalMs:15>-<counter:5>-<deviceId>"   e.g.  000001717300000000-00003-a1b2
```

- **`tick()`** (local edit): `phys = max(Date.now(), lastPhys)`; `counter` increments
  if `phys == lastPhys` else resets to 0; persist `(phys, counter)` to `sync_state`;
  return the encoded value.
- **`receive(remoteTs)`** (during merge): advance the local clock past every remote
  timestamp seen — `phys = max(lastPhys, remotePhys, Date.now())` with the counter rule
  — so later local edits always sort after merged-in remote edits.

This is what survives a wrong or backward device clock: ordering never depends on the
clock being accurate, only on the carried HLC advancing monotonically. Mirrors the
approach used by Actual Budget (the closest comparable finance app).

`device.ts` generates a short random device id once on first run and persists it in
`sync_state`; it feeds the HLC tie-break and is never reused across devices.

---

## 6. Sync file format

One file: `approot/cicada-sync.json` in the OneDrive app folder. An envelope reserves
room for future encryption without a format break:

```jsonc
{
  "syncFormatVersion": 1,
  "enc": "none",                  // future: "aes-gcm"
  "schemaVersion": 2,
  "generatedAt": "<ISO>",
  "generatedBy": "<deviceId>",
  "tables": {
    "account":  [{ "uuid", "name", "archived", "updated_at" }],
    "asset":    [{ "uuid", "accountUuid", "name", "categories", "archived", "updated_at" }],
    "snapshot": [{ "assetUuid", "date", "netWorth", "inflow", "profit", "updated_at" }],
    "tran":     [{ "uuid", "date", "type", "value", "cat", "note", "updated_at" }],
    "setting":  [{ "key", "value", "updated_at" }]
  },
  "tombstones": [{ "entity", "uuid", "deleted_at" }]
}
```

**Foreign keys travel as the parent's uuid** (`accountUuid`, `assetUuid`), never local
integer ids — this is how two devices' independent integer-id spaces reconcile.

`document.ts` builds this by extending the existing `buildBackup()` logic in
`src/services/backup.ts` (which already enumerates every row of every table).

---

## 7. Merge engine (`merge.ts`) — pure & testable

Signature: `merge(local, remoteDoc) -> mergedResult`. No DB or network access inside,
so it can be unit-tested in isolation.

Per table, **last-write-wins by HLC**:

1. Key each record by its sync identity:
   - `account` / `asset` / `tran` → `uuid`
   - `snapshot` → `"<assetUuid>|<date>"`
   - `setting` → `key`
2. For every key in `local ∪ remote`, keep the copy with the greater `updated_at`
   (string compare).
3. A **tombstone competes like a record**: if the newest `updated_at` / `deleted_at`
   for a key is the tombstone, the record is deleted; otherwise it lives. Delete-vs-edit
   races resolve by recency in both directions.
4. Feed every remote `updated_at` through `hlc.receive()` so the local clock ends up
   ahead of everything merged in.

The result is **commutative and idempotent**: running it twice, or in either device
order, converges to the same state.

---

## 8. Applying the merge (`apply.ts`) — FK-ordered, id-translating

Runs inside `withTransactionAsync` (a no-op on Tauri — see §12). Walks parents→children
so foreign keys resolve, building a `uuid → localIntId` map as it goes:

1. **accounts** — upsert by uuid; a new uuid gets a fresh autoincrement id.
2. **assets** — resolve `accountUuid` to a local id via the map; upsert by uuid.
3. **snapshots** — resolve `assetUuid`; upsert by `(assetId, date)`.
4. **trans** — upsert by uuid. **settings** — upsert by key.
5. **tombstones** — hard-delete the matching local rows and record the tombstone
   locally so it keeps propagating.

Existing screens keep using integer ids exactly as today; UUID↔int translation happens
only here.

---

## 9. Deletes & cascade (the only change to existing write paths)

Today `deleteAccount` relies on FK `ON DELETE CASCADE`, which erases descendants with no
record — so they would resurrect from the other device. Fix: each delete repo function,
before deleting, enumerates the affected uuids and writes tombstones for the row **and
all cascaded descendants** (account → its assets → their snapshots). The local
hard-delete still happens; each tombstone carries an `hlc.tick()` so it wins over a
stale create.

Symmetrically, every create/update repo function calls `hlc.tick()` to stamp
`updated_at`.

---

## 10. First connect with pre-existing data (`reconcile.ts`)

Onboarding edge case: a user already has data on two devices before enabling sync, so
the "same" account has a different uuid on each — a blind insert would hit
`UNIQUE(name)`. On a device's **first** sync where the cloud file already exists *and*
local has data, a one-time reconciliation **adopts the remote uuid** onto the matching
local row by natural key:

- `account` by `name`
- `asset` by `(accountUuid, name)`
- `snapshot` by `(assetUuid, date)`
- `setting` by `key`
- `tran` has no natural key → matched heuristically by `(date, type, value, cat, note)`;
  unmatched rows are kept as distinct (small duplicate risk, acknowledged).

Then the normal LWW merge runs. On first connect the user is shown a one-time choice:
**Merge** (default) or **Replace this device with cloud**.

---

## 11. OneDrive provider & OAuth

### 11.1 `SyncRemote` interface (`providers/types.ts`)

Keeps a second provider slot-in-able later:

```ts
interface SyncRemote {
  isConnected(): boolean;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  read(): Promise<{ content: string; etag: string } | null>;        // null if absent
  write(content: string, ifMatchEtag: string | null): Promise<{ etag: string }>;
  // throws ConflictError on HTTP 412
}
```

### 11.2 Azure app registration (one-time, done by the user/developer)

- Public client (no secret), Authorization Code + **PKCE**.
- Scopes: `Files.ReadWrite.AppFolder offline_access`.
- Redirect URIs per platform (see below).
- Account type: **personal Microsoft account recommended** to avoid NVIDIA-tenant
  admin consent. `client_id` is baked into app config.

### 11.3 Microsoft Graph calls (app folder)

- Read: `GET /me/drive/special/approot:/cicada-sync.json:/content` → 404 if absent;
  capture the `ETag`.
- Write: `PUT …:/content` with `If-Match: <etag>` (or `If-None-Match: *` to create).
  **HTTP 412 = the remote changed under us** → re-pull and re-merge.
- Clock-skew check: read the `Date` response header (Microsoft server time); warn if the
  device clock is wildly off.

### 11.4 OAuth per target (all PKCE, no secret)

| Target | Mechanism | Token storage | Redirect |
|---|---|---|---|
| Web / PWA | `@azure/msal-browser` (popup/redirect) | MSAL cache | web origin |
| iOS / Android | `expo-auth-session` + PKCE | `expo-secure-store` | `cicadafinscape://auth` |
| Tauri desktop | loopback + system browser | Tauri secure store | `http://localhost:<port>/callback` |

Tauri branches inside `auth.web.ts` on `window.__TAURI_INTERNALS__`, mirroring the
existing `database.web.ts` pattern. Graph CORS is supported for the browser/MSAL path.

---

## 12. Orchestration (`sync.ts`) & timing

```
syncNow():
  1. not connected?  -> no-op
  2. remote = provider.read()
  3. remote == null  -> write local as seed (If-None-Match: *); save etag; done
  4. parse; if remoteDoc.schemaVersion > app schema -> "please update app", stop
  5. first sync AND local has data -> reconcile.ts
  6. merged = merge(local, remoteDoc); apply(merged)        # idempotent
  7. write(buildDocument(), If-Match: remote.etag)
       └ 412 ConflictError -> re-pull, re-merge, retry (bounded x3)
  8. save lastEtag + lastSyncedAt; status = ok
```

**Concurrency:** the `If-Match: <etag>` on write guarantees we never overwrite a remote
change that landed between our read and write; a 412 loops back to re-pull/re-merge
(bounded retries, then surface an error).

**Triggers:**
- On app launch and on `AppState` → `active` (foreground), debounced, skipped if a sync
  is already in flight.
- Manual **"Sync now"** button in Settings.

`SyncContext` exposes status (`idle | syncing | error`) and the last-synced time to the UI.

---

## 13. Error handling & edge cases

- **Offline / network error** → status "offline"; retry on the next trigger; local data
  is never touched.
- **Auth/refresh failure** → prompt the user to reconnect.
- **Corrupt/invalid remote file** → refuse to apply, keep local intact, offer
  "overwrite cloud with this device."
- **Schema mismatch** → remote newer than the app ⇒ stop and ask to update; remote older
  ⇒ migrate-on-read into the current shape before merge.
- **Tauri non-atomic apply** (`withTransactionAsync` is a no-op there per
  `tauri-sqlite.ts`) → if apply is interrupted, the next sync re-merges and converges,
  because merge + apply are idempotent. Documented and accepted.
- **Backup format** bumps to **v3** to carry `uuid` / `updated_at`, so export/import
  round-trips sync identity instead of resetting it. (`src/services/backup.ts`.)

---

## 14. Phased rollout

Each phase is independently mergeable and verifiable with `npx tsc --noEmit` +
`npm run lint` + running the relevant platform.

1. **Schema + HLC + tombstones** — v2 migration, `hlc.ts`, `device.ts`, delete-path
   tombstones, write-path stamping. App still works fully offline.
2. **Document + merge + apply + reconcile** — the pure engine and DB application. The
   merge function is unit-testable in isolation (adds a lightweight test harness, since
   the project has no runner today).
3. **OneDrive provider + OAuth** per platform, behind the `SyncRemote` interface.
4. **Orchestration + `SyncContext` + Settings UI + triggers.**
5. **Backup v3, polish, cross-target verification** (browser/PWA OPFS, Tauri, native).

---

## 15. Verification

No test runner is configured. Verify with:
- `npx tsc --noEmit` (strict) and `npm run lint` after each phase.
- A small standalone test harness for `merge.ts` (pure function; the highest-risk logic).
- Manual cross-target checks: two devices/targets, offline edits on each, then sync and
  confirm convergence; delete-propagation; first-connect reconciliation; 412 retry.

---

## 16. Open prerequisites (user action)

- Register the Azure app and provide the `client_id` (one-time).
- Decide personal vs NVIDIA-tenant Microsoft account (personal avoids admin consent).
