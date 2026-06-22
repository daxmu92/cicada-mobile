# Cloud Sync: Deletion Propagation & Sync Timing — Design

Date: 2026-06-22
Status: approved (pending spec review)
Builds on: cloud sync v1 (WebDAV, HLC + LWW + tombstones).

## Problem

Three issues surfaced in real use:

1. **Reset / import doesn't stick.** Load sample data → "reset" → next sync resurrects
   the old data. Importing your own backup mixes imported data with resurrected cloud
   records. Root cause: `resetDatabase()` (`migrations.ts:164` `resetSchema`) does
   `DROP TABLE` on **every** table including `tombstone` and `sync_state`, then
   re-migrates to an empty DB. A local wipe therefore produces **no tombstones**, so it
   carries no information that says "these were deleted." On the next `runSync`,
   `merge(local = empty, remote = old data)` keeps the remote rows (nothing beats or
   suppresses them) and pulls them back. The merge engine is behaving correctly — the
   wipe simply never expressed a deletion. The same `resetDatabase()` is wired to three
   user actions, all affected: Settings reset (`settings.tsx:59`), `importBackup`
   (`backup.ts:113`), and `loadSampleData` (`sample-data.ts:95`).

2. **Delete buttons dead on desktop.** (Diagnosed alongside; fixed already — see
   "Piece A".) Four modals called React Native's `Alert.alert`, which react-native-web
   stubs as a no-op, so confirm dialogs never appeared on web/Tauri desktop.

3. **Sync timing.** Sync only fires on app launch, foreground, and the manual button
   (`SyncContext.tsx:103–140`). No sync-after-write, so edits sit un-synced until the
   next launch/foreground.

## Decisions (from brainstorming)

- **Reset and import propagate deletions "everywhere"** — via tombstones, staying inside
  the existing merge model — not a local-only re-pull.
- **Sync timing = debounced-after-writes + sync-on-background**, not literal
  sync-on-every-write (full-document upload makes per-write sync chatty and
  conflict-prone).
- **Reset UX** = a prominent confirmation that spells out the consequences (erases data
  from this device, the cloud, **and every other synced device**; irreversible), plus a
  choice to also delete app settings.

## Non-goals

- At-rest encryption, delta/compression sync, S3 provider, web/PWA sync — all deferred
  (tracked elsewhere). The full-document JSON upload stays as-is; a personal DB is small
  enough that debounced full-sync is fine.
- A conflict-resolution UI. LWW remains the model.

---

## Piece A — Dialog fix (DONE)

Migrated all four modals (`manage-accounts`, `edit-asset`, `add-record`,
`add-transaction`) off raw `Alert.alert` to `confirmAsync`/`notify` from
`src/utils/dialog.ts`. Added an ESLint `no-restricted-syntax` rule banning
`Alert.alert` in `app/**` and `src/**` (excluding `dialog.ts`) so the class of bug
can't silently return. Verified: `tsc --noEmit` clean, `npm run lint` clean. Not a sync
problem; recorded here for completeness.

---

## Piece B — Deletion propagation (the core work)

### B1. A single erase primitive

Introduce `eraseAllData(opts: { includeSettings: boolean }): Promise<void>` in the sync
layer (alongside `stamp.ts` / a new `erase.ts`). It does **not** drop tables; it:

1. Enumerates every live row's identity per entity:
   - `account.uuid`, `asset.uuid`, `tran.uuid`
   - snapshots by composite key `"<assetUuid>|<date>"`
   - `setting` keys **only if** `includeSettings` is true
2. `recordTombstones(entity, uuids)` for each set — one fresh HLC via `tick()`, so the
   tombstones out-stamp the data they replace.
3. `DELETE FROM` the data rows locally (keeping `tombstone` and `sync_state` intact).

This keeps the device's HLC clock and `deviceId` stable, and leaves tombstones in place
to be pushed.

The existing `resetSchema` (DROP + migrate, new identity, local-only) is **retained but
demoted** to a low-level corruption-recovery / hard-reset primitive. It is no longer
wired to user-facing destructive actions.

### B2. Freshness guarantee

A tombstone only suppresses a record when `deleted_at >= updated_at`. To make deletion
actually stick against a peer's clock-skewed stamps, the user-facing erase flow is:

1. **Pre-sync** (best-effort): `syncNow()` to pull the latest remote and fold its max
   stamp into the local clock via `receiveRemote`. Skipped/ignored if offline.
2. **Erase**: `eraseAllData(...)` — tombstones now stamped from a clock `>=` everything
   seen in the cloud.
3. **Post-sync**: `syncNow()` to push the tombstones (and emptied state) up.

Residual, documented risk: an edit made on another device *offline* and stamped newer
than our tombstone will win on its next sync (standard LWW concurrent-edit-vs-delete).
Acceptable for a single-user app.

### B3. Wiring the three callers

- **Settings "Reset / Erase all data"** → new confirmation modal (B4) → `eraseAllData`
  with the chosen `includeSettings`, wrapped in the pre/post-sync flow.
- **`importBackup`** ("make my data exactly this, everywhere"):
  - Replace the current `resetDatabase()` call with: tombstone the set difference
    `(oldUuids − backupUuids)` so dropped records propagate, then `restoreBackupDoc`
    upserting the backup's records **re-stamped with a fresh HLC** (one `tick()`) so the
    whole import out-stamps the cloud. Settings included in the backup overwrite local.
  - Then post-sync to push. (Pre-sync optional; import is inherently authoritative.)
  - Keeps using the existing per-record `freshStamp` mechanism in `restoreBackupDoc`.
- **`loadSampleData`** → same erase primitive (`includeSettings: false`) then seed the
  sample rows (freshly stamped), then post-sync. This makes "load sample" replace the
  cloud too, matching reset semantics and removing the resurrection footgun. (Sample
  data is a demo/dev affordance; propagating is consistent and avoids a special case.)

### B4. Reset confirmation modal

A dedicated modal screen (`app/modals/erase-data.tsx`) rather than `window.confirm`
(which can't host a checkbox and renders identically across native + desktop):

- Title + body that explicitly state: this permanently erases all financial data from
  **this device, the cloud, and every other synced device**, and cannot be undone.
- A toggle: **"Also delete app settings"** (currency, forward-fill, gain-color,
  language) — default **off** (keep settings).
- A destructive confirm button + cancel. (Optional hardening: require the button to be
  the deliberate action; no typed-phrase gate for v1 — YAGNI.)
- On confirm: run the B2 flow; show progress and a final `notify` on completion/error.

### B5. Merge-engine impact

None. Tombstones, suppression, and convergence already exist and are tested. This work
only changes **who records tombstones** (now also reset/import/sample) — it does not
change merge/apply semantics.

---

## Piece C — Debounced + background sync

### C1. Dirty signal

Add a tiny module (`src/sync/dirty.ts`) exposing `bumpDirty()` and a subscribe
callback. Call `bumpDirty()` at the end of every mutating repo function (the natural
choke point: `account-repo`, `asset-repo`, `snapshot-repo`, `tran-repo`, and settings
writes). `bumpDirty` is a no-op when sync is unavailable/disconnected.

### C2. Debounce in SyncContext

`SyncContext` subscribes to the dirty signal and schedules a sync:

- **Trailing debounce ~3s**: sync 3s after the last write settles.
- **Hard ceiling ~30s**: a continuous stream of writes still flushes at least every 30s.
- Reuse the existing `inFlight` guard. If a write lands mid-sync, set a "re-sync
  pending" flag and run once more after the current sync completes.

### C3. Background flush

Extend the existing `AppState` listener: on transition to `background`/`inactive`,
flush any pending dirty sync immediately (best-effort; mobile background time is
limited). Foreground/launch/manual triggers stay.

### C4. Tuning

Debounce (3s) and ceiling (30s) are constants in one place, easy to tune. Not exposed
in settings for v1.

---

## Piece D — Testing

### Current state

Pure Node `node --test` unit tests over an in-memory `CicadaDB` fake:
`merge`, `apply`, `convergence`, `hlc`, `document`, `sync`. Strong on engine logic.

### Why bug #1 shipped

Nothing exercises a **destructive round-trip** — a device wiping/importing and then
syncing against a *populated* cloud. Convergence tests cover diverging edits, not
deletion propagation.

### Additions (all in the existing harness, no device needed)

`runSync`-level scenario tests using the existing fake in-memory `SyncRemote` + DB:

1. **Reset propagates**: device A seeds cloud → A `eraseAllData` → sync → cloud emptied
   (only tombstones) → device B syncs → B's data deleted. No resurrection on a 2nd sync.
2. **Import-as-truth**: cloud has records X,Y → import a backup containing X',Z →
   after sync, cloud/B converge to X',Z (Y tombstoned, X' wins, Z added).
3. **No-resurrect**: delete a record → sync → re-run sync → it stays deleted.
4. **includeSettings** on/off: settings tombstoned only when requested.
5. **Freshness**: a remote record stamped before the erase is suppressed; the
   concurrent-newer-edit-wins case is asserted as the documented exception.

### Structural guard

The `Alert.alert` ESLint rule (Piece A) is the "test" for bug #3 — UI no-op behavior is
impractical to unit-test, so it's prevented structurally instead.

### Out of scope for automated tests

Real WebDAV server + real mobile dev build remain a documented **manual checklist**
(cannot be unit-tested). The new scenario tests would have caught bug #1; the manual
checklist still covers credential persistence and the live transport.

---

## Sequencing

- **A**: done.
- **B**: deletion propagation (erase primitive + freshness flow + 3 callers + reset
  modal + scenario tests 1–4).
- **C**: debounced + background sync.
- **D**: scenario tests land with B (deletion) and a small set with C if useful.

## Risks / open questions

- **Tombstone volume**: erasing a large DB writes many tombstones (GC'd after 90 days).
  Fine for a personal app.
- **Sample-data propagation**: confirmed intentional — loading sample replaces the cloud
  too. If a user loads sample while connected expecting a local-only preview, that
  expectation is now wrong; the reset modal copy / a note on the sample button should
  make this clear.
- **Offline erase**: tombstones are recorded locally and pushed on the next successful
  sync; freshness vs a peer's future-dated offline edit is only guaranteed after a
  successful pre-sync `receiveRemote`. Documented LWW limitation.
