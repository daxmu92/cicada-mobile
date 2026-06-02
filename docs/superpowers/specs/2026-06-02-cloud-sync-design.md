# Cloud Sync — Design Spec

**Date:** 2026-06-02
**Status:** Approved design, rev 2 (revised after multi-agent review)
**Feature:** Multi-device sync of all CicadaFinScape data through the user's own
OneDrive, with offline-tolerant per-record merge.

## 0. Revision history

- **rev 1** — initial design (single-user multi-device, OneDrive, per-record LWW,
  HLC, all five targets, sync-on-open + manual, OneDrive account security).
- **rev 2** — revised after four parallel review passes (principles / architecture /
  consistency / feasibility). Material changes: a **non-isolated `/auth` route** for
  web/PWA OAuth (cross-origin isolation breaks in-app MSAL); **cascade-delete is
  authoritative and re-derived at apply time** (fixes an orphan/resurrection bug);
  **reconciliation runs whenever a natural key collides with a different uuid**, not
  once; **no heuristic transaction matching** on first connect; HLC encoding pinned and
  `receive()` persistence specified; Graph reads use `@microsoft.graph.downloadUrl`
  (the `:/content` 302 is CORS-blocked); explicit dependency / Tauri-plugin / dev-build
  checklist; redirect scheme corrected to `cicadamobile://`.

---

## 1. Goal & scope

CicadaFinScape is a local-first personal finance tracker. Today all data lives in
on-device SQLite with **no backend and no network dependency**. This feature adds
**optional, opt-in sync across one user's own devices** (phone, desktop, browser, PWA)
while preserving the "no backend we operate" principle: data moves through a single file
in the **user's own OneDrive**, not through a server we run. A user who never connects
an account is entirely unaffected — the app stays fully offline with zero network.

### Locked decisions

| Decision | Choice |
|---|---|
| Use case | Single user, multiple of their own devices |
| Transport | A single file in the user's own cloud storage |
| Provider (v1) | **OneDrive** via Microsoft Graph, OAuth 2.0 (PKCE), app-scoped folder |
| Merge model | **Per-record last-write-wins** (additive sync columns; integer PKs kept) |
| Conflict ordering | **Hybrid Logical Clocks (HLC)** — tolerant of device clock skew |
| Targets (v1) | All five: iOS, Android, browser, PWA, Tauri desktop |
| Web/PWA OAuth | A **separate non-isolated `/auth` route** runs MSAL and hands tokens back (see §11.4) |
| Sync timing | On app open/foreground + manual "Sync now" button |
| Encryption | **v1 plaintext**, rely on OneDrive account security; file format is encryption-ready |
| First-connect txn reconcile | **No auto-match** — transactions are treated as distinct; duplicates accepted |

### Non-goals (v1)

- No multi-user / shared-account editing, no real-time collaboration.
- No second storage provider (the `SyncRemote` interface leaves room for one later).
- No at-rest encryption (the `enc` envelope field reserves it; v1 ships plaintext — an
  explicit, accepted privacy trade-off, see §13).
- No version-vector conflict UI: same-record concurrent edits resolve by newest HLC.

---

## 2. Guiding principle & blast radius

**All sync orchestration, merge, transport, and auth live in a new `src/sync/` module,
and the schema change is purely additive.** Existing **read paths, screens, routes,
`UNIQUE` constraints, and the `id: number` type are untouched.**

What *does* change in existing code, honestly:
- **Every create/update repo write** calls a centralized `stampWrite()` helper to set
  `updated_at` (and `uuid` on insert). This touches `createAccount`, `renameAccount`,
  `setAccountArchived` (**including its cascade UPDATE to child assets**), `createAsset`,
  `updateAsset`, `setAssetArchived`, `upsertSnapshot`, `createTransaction`,
  `updateTransaction`, and `setSetting`.
- **Every delete repo fn** calls `recordTombstones(entity, uuids)` for the row **and all
  cascaded descendants** before the local delete: `deleteAccount`, `deleteAsset`,
  `deleteSnapshot`, `deleteTransaction`.

Centralizing both in `src/sync/stamp.ts` keeps the per-repo change uniform and reviewable
(important: there is no test runner — see §15).

---

## 3. Architecture

### 3.1 Module layout

```
src/sync/
  hlc.ts              # Hybrid Logical Clock: tick() / receive(); persisted state
  device.ts           # stable per-device id (generated once)
  stamp.ts            # stampWrite() / recordTombstones() — called by repos
  document.ts         # build/parse the sync file (extends buildBackup logic)
  merge.ts            # PURE per-record LWW merge (the testable core)
  apply.ts            # write a merged result to the local DB (FK-ordered, cascade-repair)
  reconcile.ts        # natural-key uuid adoption (runs on key/uuid conflict)
  sync.ts             # orchestrator: pull -> merge -> apply -> push (precondition-guarded)
  providers/
    types.ts          # SyncRemote interface (read/write/auth)
    onedrive.ts       # Microsoft Graph implementation
  auth/
    auth.ts           # native OAuth (expo-auth-session + expo-crypto PKCE)
    auth.web.ts       # web MSAL via the /auth route; branches to Tauri loopback
src/hooks/SyncContext.tsx   # status + connect/disconnect + syncNow; triggers on foreground
app/auth/                   # NON-isolated web route that runs MSAL (see §11.4)
```

The Settings screen gains a **"Cloud Sync"** section: connect/disconnect OneDrive,
"Sync now", last-synced time, and status/error display.

### 3.2 Data flow

```
   device A                         OneDrive (approot)                   device B
  ┌────────┐   pull  ┌───────────────────────────────────┐   pull   ┌────────┐
  │ SQLite │◀────────│        cicada-sync.json            │─────────▶│ SQLite │
  │  +HLC  │────────▶│  (rows + HLC updated_at + tombs)   │◀─────────│  +HLC  │
  └────────┘  push   └───────────────────────────────────┘   push   └────────┘
         (ETag precondition guards concurrent writers)
```

Each device: pull → merge with local (pure, LWW by HLC) → apply to local DB → push the
merged result (precondition-guarded). Merge + apply are idempotent and order-independent.

---

## 4. Schema migration (`SCHEMA_VERSION` 1 → 2, additive only)

Defined in `src/db/migrations.ts`; runs on every backend via the `CicadaDB` interface.

- Add to `account`, `asset`, `tran`: `uuid TEXT` (+ a `UNIQUE` index) and
  `updated_at TEXT` (HLC string).
- Add to `asset_snapshot`: **`updated_at TEXT` only**. Its sync identity is the natural
  key **`(asset's uuid, date)`** — and this is deliberate: a snapshot is a *content
  cell* ("this asset's net worth for this month"), not an entity. There is logically one
  value per `(asset, month)`, so two devices setting it is a genuine LWW conflict on the
  same cell, which is exactly what we want. Giving snapshots a surrogate uuid would
  instead make the common case (both devices have the same month) collide on the
  `PRIMARY KEY (asset_id, date)`. (Delete-then-recreate of a snapshot is therefore
  treated as an LWW edit to the same cell; the normal edit path is `upsertSnapshot`
  anyway, so a literal delete+insert is rare — accepted.)
- Add to `setting`: `updated_at TEXT`. Identity is `key`.
- New table `tombstone(entity TEXT, uuid TEXT, deleted_at TEXT, PRIMARY KEY(entity, uuid))`.
  For snapshots the `uuid` key is the composite `"<assetUuid>|<date>"`.
- New table `sync_state(key TEXT PRIMARY KEY, value TEXT)` — **device-local, never
  synced**: deviceId, HLC state, last ETag, last-synced time, connected-account info,
  reconcile-done flag. OAuth tokens live in platform secure storage, **not** here.

### Backfill (in the `migrate()` v2 block) — must be re-entrant

Tauri has no atomic transaction (`tauri-sqlite.ts` `withTransactionAsync` is a no-op and
`execAsync` splits on `;`), so the v2 block must survive interruption:

1. `ALTER TABLE … ADD COLUMN` for each new column (idempotent on re-run because a second
   `ADD COLUMN` would error — guard with the existing `columnExists()` helper, mirroring
   the v1 migration).
2. `UPDATE <table> SET uuid = lower(hex(randomblob(16))) WHERE uuid IS NULL` — re-entrant.
   (`randomblob`/`hex`/`lower` are core SQLite, identical on all three backends.)
3. `UPDATE <table> SET updated_at = '<migration HLC>' WHERE updated_at IS NULL`.
4. Create the `UNIQUE` index on `uuid` **after** backfill.
5. `PRAGMA user_version = 2` **strictly last**, so an interrupted run re-enters cleanly.

**First-merge caveat:** all existing rows on a device share one migration HLC. On the
first sync between two devices that each already had data, LWW therefore resolves
**coarsely** (whole-device, not per-record) for pre-existing rows. This is surfaced via
the Merge/Replace choice in §10 and documented in §13.

---

## 5. Hybrid Logical Clock (`hlc.ts`)

`updated_at` is a **fixed-width** string so a plain ordinal string compare *is* the HLC
compare. Format: `<physicalMs:15>-<counter:5>-<deviceId:6>`, e.g.:

```
001717300000000-00003-a1b2c3
```

(`Date.now()` is 13 digits today; 15 gives ~8000 years of headroom. Widths are frozen —
ordering correctness depends on it.)

- **`tick()`** (local edit): `phys = max(Date.now(), lastPhys)`; `counter` increments if
  `phys == lastPhys` else resets to 0; **overflow**: if `counter` would exceed 99999, set
  `phys += 1` and `counter = 0`. Persist `(phys, counter)` to `sync_state`; return the
  encoded value.
- **`receive(remoteTs)`** (during merge): advance the local clock past every remote
  timestamp seen — `phys = max(lastPhys, remotePhys, Date.now())` with the counter rule —
  so later local edits sort after merged-in remote edits.
- **Durability:** `receive()` **must persist** the advanced state in the *same
  transaction as `apply()`* (native/web). On Tauri (no transaction) persist it
  immediately before the push; an interrupted sync re-merges idempotently next time.
- **Comparison:** always ordinal (`a < b` on JS strings is code-unit ordinal — correct).
  Never `localeCompare` (used elsewhere only for display sorting).

`device.ts` generates a fixed-width random device id once on first run, persists it in
`sync_state`, and never reuses it across devices; it is the HLC tie-break.

---

## 6. Sync file format

One file: `approot/cicada-sync.json` in the OneDrive app folder. An envelope reserves
room for future encryption:

```jsonc
{
  "syncFormatVersion": 1,
  "enc": "none",                  // future: "aes-gcm"; v1 client STOPS on any other value
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

- **Foreign keys travel as the parent's uuid** (`accountUuid`, `assetUuid`), never local
  integer ids — that's how two devices' independent integer-id spaces reconcile.
- `document.ts` extends `buildBackup()` (`src/services/backup.ts`), which already
  enumerates every row. **Note:** `buildBackup` currently emits `setting` as a
  `Record<string,string>`; the sync document needs the array-with-`updated_at` form
  above, so the builder must change the setting shape (not blindly reuse it).
- **Forward-compat:** a v1 client that pulls a file with `enc != "none"` or
  `schemaVersion > 2` **stops** with "please update the app" — it never tries to apply
  data it can't fully understand (§12 step 4).

---

## 7. Merge engine (`merge.ts`) — pure & testable

Signature: `merge(local, remoteDoc) -> mergedResult`. No DB or network access, so it is
unit-testable in isolation (and must import nothing from RN/Expo — see §15).

Per table, **last-write-wins by HLC (ordinal compare):**

1. Key each record by its sync identity:
   - `account` / `asset` / `tran` → `uuid`
   - `snapshot` → `"<assetUuid>|<date>"`
   - `setting` → `key`
2. For every key in `local ∪ remote`, keep the copy with the greater `updated_at`.
3. A **tombstone competes like a record** (by `deleted_at`): if the newest stamp for a
   key is the tombstone, the record is deleted; else it lives. Delete-vs-edit races
   resolve by recency in both directions.
4. Feed every remote stamp through `hlc.receive()` so the local clock ends up ahead.

The result is **commutative and idempotent**. **Subtree integrity** (a deleted parent
must not leave live orphans) is *not* expressible by per-key LWW alone; it is enforced
authoritatively in `apply()` (§8) — delete of a parent wins over a concurrent edit to a
descendant.

---

## 8. Applying the merge (`apply.ts`) — FK-ordered, id-translating, cascade-repairing

Runs inside `withTransactionAsync` (a no-op on Tauri — see §13). Walks parents→children,
building a `uuid → localIntId` map:

1. **accounts** → upsert by uuid; a new uuid gets a fresh autoincrement id.
2. **assets** → resolve `accountUuid` via the map; upsert by uuid. Asset **re-parenting**
   (a different `accountUuid`) is an `UPDATE asset.account_id`.
3. **snapshots** → resolve `assetUuid`; upsert by `(assetId, date)`.
4. **trans** → upsert by uuid. **settings** → upsert by key.
5. **tombstones** → hard-delete matching local rows; keep the tombstone locally so it
   keeps propagating.
6. **Cascade repair (authoritative delete):** after the above, any surviving record whose
   resolved parent is absent or tombstoned is **deleted and tombstoned** (account gone ⇒
   its assets+snapshots go; asset gone ⇒ its snapshots go). This makes "the user deleted
   the parent" win over a concurrent descendant edit, and guarantees no dangling FK ever
   reaches SQL.

**`UNIQUE` collisions during apply** (two *distinct* uuids carrying the same
`account.name` or `asset(account_id,name)`):
- First resolve as identity via natural-key adoption (§10) — if the names match because
  it's the *same* logical record with a different uuid, adopt and merge.
- If they are genuinely different records that happen to share a name, **auto-suffix the
  newer one** (`"Brokerage (2)"`) and flag it in the sync status. Never fail the apply or
  silently drop a row.

Asset re-parenting must also re-check `UNIQUE(account_id, name)` at the new parent and
auto-suffix on collision.

Existing screens keep using integer ids exactly as today; all uuid↔int translation lives
here.

---

## 9. Deletes & cascade (the change to existing delete paths)

Today `deleteAccount` relies on FK `ON DELETE CASCADE`, which erases descendants with no
record — so they would resurrect from the other device. Fix: each delete repo fn calls
`recordTombstones()` for the row **and all cascaded descendant uuids** (enumerated via a
`SELECT` before the delete) — account → its assets → their snapshots. The local
hard-delete still happens; each tombstone carries an `hlc.tick()`.

This is belt-and-suspenders with §8 step 6: delete-time tombstones propagate the intent,
and apply-time cascade-repair guarantees integrity even if a descendant was edited
concurrently on the other device.

---

## 10. Reconciliation (`reconcile.ts`) — runs on natural-key/uuid conflict

The onboarding case: a user already has data on two devices before enabling sync, so the
"same" account has a different uuid on each — a blind insert would hit `UNIQUE(name)`.

**Trigger:** reconciliation is **not** gated on a one-shot "first sync" flag (the device
that *seeds* the file would skip it and then collide). Instead, during merge/apply,
whenever a remote record's **natural key matches a local record with a different uuid**,
adopt the remote uuid onto the local row before applying:
- `account` by `name`; `asset` by `(accountUuid, name)`; `snapshot` by `(assetUuid, date)`;
  `setting` by `key`.
- **`tran`: no reconciliation.** Transactions have no natural key; matching by content is
  rejected (it can silently collapse two genuinely separate identical transactions and
  corrupt monthly totals). They are treated as distinct; if the same transaction was
  entered on two devices pre-sync, it appears twice and the user deletes the extra.

**First connect with local data + existing remote file** offers a one-time choice:
**Merge** (default; natural-key adoption as above) or **Replace this device with cloud**.
Because pre-existing rows share one migration HLC (§4), the user is warned that a Merge
resolves pre-sync edits coarsely (whole-device), and that **device-local settings**
(currency, forward-fill, colors) may be overwritten by the other device on first sync.

---

## 11. OneDrive provider & OAuth

### 11.1 `SyncRemote` interface (`providers/types.ts`)

```ts
type WritePrecondition =
  | { kind: 'ifMatch'; etag: string }   // update: fail (412) if remote changed
  | { kind: 'ifNoneMatch' }             // create-only: fail (412) if file exists
  | { kind: 'none' };

interface SyncRemote {
  isConnected(): boolean;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  read(): Promise<{ content: string; etag: string } | null>;   // null if absent
  write(content: string, pre: WritePrecondition): Promise<{ etag: string }>;
  // throws ConflictError on HTTP 412
}
```

The explicit precondition lets the orchestrator express the create-only seed write
(§12 step 3) distinctly from a normal update.

### 11.2 Azure app registration (one-time, done by the user/developer)

- Public client (no secret), Authorization Code + **PKCE**.
- Scopes: `Files.ReadWrite.AppFolder offline_access`.
- Redirect URIs per platform (§11.4).
- Account type: **personal Microsoft account recommended** to avoid NVIDIA-tenant admin
  consent. `client_id` is baked into app config.

### 11.3 Microsoft Graph calls (app folder)

- **Read (CORS-safe):** `GET /me/drive/special/approot:/cicada-sync.json` → 404 if absent;
  capture `eTag` and read `@microsoft.graph.downloadUrl`, then `fetch` that pre-authed URL
  for the content. (The `:/content` download answers with a **302** that is CORS-blocked
  for browser/PWA/WebView callers — do not use it for reads.)
- **Write:** `PUT /me/drive/special/approot:/cicada-sync.json:/content` with `If-Match:
  <etag>` (update) or `If-None-Match: *` (create). **HTTP 412 = remote changed / already
  exists.** Bearer-token `PUT` is a CORS request and works under COEP `credentialless`.
- **Size guard:** simple `PUT :/content` supports ≤ 4 MB. If the serialized document
  exceeds ~4 MB, fall back to `createUploadSession`. (A single-user dataset stays well
  under 4 MB for years; the guard is cheap insurance.)
- **Clock-skew check:** read the `Date` response header (Microsoft server time); warn if
  the device clock is wildly off.

### 11.4 OAuth per target (all PKCE, no secret)

Cross-origin isolation (COOP `same-origin` + COEP `credentialless`, mandatory for
wa-sqlite OPFS — set in `metro.config.js`, `scripts/serve-web.js`,
`src-tauri/tauri.conf.json`) **breaks in-app MSAL**: COOP `same-origin` nulls a popup's
`window.opener`, severing MSAL's token handoff, and we cannot relax COOP without losing
OPFS. Therefore:

| Target | Mechanism | Token storage | Redirect |
|---|---|---|---|
| Web / PWA | MSAL.js on a **separate, non-isolated `/auth` route** (served *without* COOP/COEP), tokens handed to the isolated app via `BroadcastChannel`/storage event | MSAL cache (auth route) → relayed | `/auth/callback` |
| iOS / Android | `expo-auth-session` + `expo-crypto` (PKCE) | `expo-secure-store` | `cicadamobile://auth` |
| Tauri desktop | **loopback** (`tauri-plugin-oauth`) + system browser (`tauri-plugin-opener`); **not** MSAL-in-WebView (same COOP problem) | Tauri secure storage | `http://localhost:<port>/callback` |

- `serve-web.js` already sets headers per-response, so gating COOP/COEP off for `/auth*`
  is a small conditional; the Metro dev middleware needs the same path-gate, and the
  Tauri header config must exempt the auth route (or, preferably, desktop uses the
  loopback path and never loads MSAL in the WebView).
- Web/PWA OAuth via the `/auth` route is a **named v1 work item** (§14 phase 4), not an
  afterthought.

### 11.5 New dependencies & native prerequisites

All NEW (not in `package.json` / `src-tauri`); pin to Expo SDK 54 / React 19 compatible
versions:

- Web/PWA: `@azure/msal-browser` (confined to `auth.web.ts` / the `/auth` route; must not
  enter the native bundle).
- Native: `expo-auth-session`, `expo-crypto`, `expo-secure-store`. **Native deep-link
  OAuth requires a dev build / EAS build — it does not work in Expo Go.**
- Desktop (Rust): `tauri-plugin-oauth` (loopback callback) + an opener plugin + a secure
  storage plugin (e.g. `tauri-plugin-stronghold`; or accept `tauri-plugin-store`
  plaintext, consistent with §1's account-security stance — document the choice), plus
  matching grants in `src-tauri/capabilities/`.
- Already present and reused: `@tauri-apps/plugin-sql`, `expo-sqlite`, `expo-web-browser`,
  `expo-linking`.

---

## 12. Orchestration (`sync.ts`) & timing

```
syncNow():
  1. not connected? -> no-op
  2. remote = provider.read()
  3. remote == null -> write(buildDocument(), { kind: 'ifNoneMatch' })   # seed/create
        └ 412 (someone else seeded) -> go to step 2 (then reconcile + merge)
     else save etag; done
  4. parse; if enc != "none" OR schemaVersion > 2 -> "please update app", stop
  5. detect natural-key/uuid conflicts -> reconcile.ts (and first-connect Merge/Replace)
  6. merged = merge(local, remoteDoc); apply(merged)        # idempotent
  7. write(buildDocument(), { kind: 'ifMatch', etag: remote.etag })
        └ 412 ConflictError -> re-pull, re-merge, retry (exponential backoff + jitter)
  8. save lastEtag + lastSyncedAt; status = ok
```

- **Concurrency:** `If-Match`/`If-None-Match` guarantees we never clobber a remote change
  that landed between read and write. Each 412 retry re-pulls and re-merges; because the
  merged document only grows toward convergence, retries make **monotonic progress**
  (no livelock). Backoff + jitter avoids spurious failures when two devices wake together.
- **Triggers:** on app launch and on `AppState` → `active` (debounced, skipped if a sync
  is in flight), plus the manual **"Sync now"** button.

`SyncContext` exposes status (`idle | syncing | error`) and last-synced time.

---

## 13. Error handling & edge cases

- **Offline / network error** → status "offline"; retry next trigger; local data untouched.
- **Auth/refresh failure** → prompt reconnect.
- **Corrupt/invalid remote file** → refuse to apply, keep local intact, offer "overwrite
  cloud with this device."
- **`enc`/`schemaVersion` ahead of this app** → stop, ask to update; never partial-apply.
- **Tauri non-atomic apply** (`withTransactionAsync` no-op) → an interrupted apply may
  briefly leave the local DB inconsistent and the UI re-queries on focus; the next sync
  re-merges and converges (merge + apply are idempotent). Mitigation: set a
  "sync-in-progress" flag in `sync_state` and fully re-run an interrupted apply before the
  UI reads. Accepted, documented; same class of risk the existing `restoreBackup` already
  carries, but exercised more often.
- **Privacy (plaintext in cloud):** v1 stores full financial data as plaintext JSON in the
  account-scoped OneDrive app folder. Accepted threat model: protection is the user's
  Microsoft account security; readable by Microsoft and by anyone with the user's
  credentials. The `enc` envelope reserves passphrase AES-GCM for a later version with no
  format break.
- **Tombstone GC:** tombstones are retained and keep propagating; left unbounded the file
  grows with every lifetime delete. v1 keeps a fixed retention window (documented) and
  accepts that a device offline longer than the window may resurrect a row; a future
  device-registry-based horizon can tighten this.
- **Backup format → v3** to carry `uuid`/`updated_at`. The v3 **import path must INSERT
  the backup's `uuid`/`updated_at`** rather than letting the v2 migration backfill fresh
  ones (the migration's `WHERE uuid IS NULL` guard naturally preserves provided values) —
  otherwise a restore re-randomizes sync identity and breaks future merges.

---

## 14. Phased rollout

Each phase is independently mergeable and verifiable with `npx tsc --noEmit` +
`npm run lint` + running the relevant platform.

0. **Prerequisites** — register the Azure app (get `client_id`); confirm personal vs
   tenant account; add Tauri plugins + capabilities; confirm native dev-build pipeline.
1. **Schema + HLC + stamping + tombstones** — re-entrant v2 migration, `hlc.ts`,
   `device.ts`, `stamp.ts`, repo write/delete paths. App still works fully offline.
2. **Document + merge + apply + reconcile** — the pure engine + DB application +
   cascade-repair + natural-key adoption. `merge.ts` is unit-tested (§15).
3. **OneDrive provider + Graph** (metadata+downloadUrl read, precondition writes, size
   guard) behind `SyncRemote`.
4. **OAuth per target** — native (`expo-auth-session`, dev build), desktop (loopback
   plugins), **web/PWA `/auth` route + token handoff** — plus `SyncContext`, Settings UI,
   and triggers.
5. **Backup v3, tombstone GC, polish, cross-target verification.**

---

## 15. Verification

No test runner is configured ("don't look for one"). Approach:
- `npx tsc --noEmit` (strict) and `npm run lint` after each phase.
- **`merge.ts` is pure** (no RN/Expo imports) and tested with `node --test` via a `tsx`
  dev-dependency — the lowest-footprint option that respects "no runner framework." This
  covers the highest-risk logic: LWW ordering, tombstone competition, cascade-repair,
  natural-key adoption, HLC compare/overflow.
- Manual cross-target checks: two targets, offline edits on each → sync → confirm
  convergence; delete-propagation incl. parent-delete vs concurrent child-edit;
  first-connect reconciliation (Merge and Replace); 412 retry; web `/auth` round-trip.

---

## 16. Open prerequisites (user action)

- Register the Azure app and provide the `client_id`.
- Choose personal vs NVIDIA-tenant Microsoft account (personal avoids admin consent).
- Accept that native OAuth requires a **dev/EAS build**, not Expo Go.
