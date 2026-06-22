# Sync Scheduler & Desktop Hardening — Design

Date: 2026-06-22
Status: approved (pending spec review)
Builds on: cloud sync v1 + the deletion-propagation/timing branch (`fix/cloud-sync-deletion-and-dialogs`).

## Problem / motivation

Two threads, agreed with the user:

**A. Sync timing.** Today sync fires from two *uncoordinated* places — `SyncContext.doSync` (launch / foreground / debounced-after-write) and direct `syncNow()` calls inside `eraseAllDataAndSync` / `importBackup` / `loadSampleData`. They can race (the whole-branch review flagged this). Triggers also lean on React Native `AppState` (background/foreground) which is unreliable on the Tauri desktop webview. And every sync does a full read→merge→write even when nothing changed, re-uploading the entire DB (already ~180 KB).

The user wants the textbook offline-first scheduler: **push on local change (debounced), poll periodically (~5 min) for other devices' changes, and skip work when nothing changed.**

**B. Desktop hardening.** Two issues cost hours this session:
- A **service worker** (`public/sw.js`, registered unconditionally in `app/+html.tsx`) precaches the JS bundle and serves it **stale** on the Tauri desktop build, surviving an HTTP-cache clear. A SW has no value on desktop (assets are embedded) and is pure downside.
- `scripts/build-windows.sh` printed `==> Done` even when `tauri build` had errored (e.g. an invalid `tauri.conf.json`), producing stale artifacts silently.

## Verified facts grounding the design

- 坚果云 (and WebDAV generally) **honors conditional GET**: `If-None-Match: <etag>` → `304 Not Modified` when unchanged, `200`+body when changed; `HEAD` works. (Tested live this session.) This makes a periodic poll nearly free when idle.
- 坚果云 honors `If-Match` (412) — already used for optimistic concurrency.

## Goals

1. One sync coordinator; no racing entry points.
2. Triggers: on-write (debounced), periodic (~5 min while app open), launch, and window blur/close (desktop-reliable). Mobile foreground/background still honored where it works.
3. Skip no-ops: when local is clean, a poll costs one conditional `304`; never re-upload an unchanged DB.
4. Desktop: no service worker; build fails loudly on error.
5. Verify the prior deletion fix end-to-end on the corrected build.

## Non-goals

Encryption, delta-sync (we do whole-doc but skip when identical), S3/web sync — all out of scope this round. Tombstone-GC horizon unchanged.

---

## Design

### 1. Sync coordinator (extracted from React)

Create `src/sync/scheduler.ts` — a module-level singleton (NOT React) that owns all timing/coordination so both React and plain services use one path.

```ts
type SyncReason = 'launch' | 'write' | 'periodic' | 'lifecycle' | 'manual';
type SyncStatusListener = (s: { status: SyncStatus; lastSyncedAt: number | null; lastError: string | null }) => void;

export const syncScheduler = {
  start(): void;                  // begin periodic timer; idempotent
  stop(): void;                   // clear timers (cleanup)
  markDirty(): void;              // a local write happened → schedule a debounced push
  requestSync(reason: SyncReason): Promise<void>;  // coalesced; never throws
  subscribe(cb: SyncStatusListener): () => void;   // status for the UI
  getState(): { status: SyncStatus; lastSyncedAt: number | null; lastError: string | null };
};
```

Internals:
- **inFlight guard + pending flag** (the re-sync-pending logic, now centralized): if a request arrives mid-sync, run exactly once more after.
- **Debounce** for `markDirty`: trailing ~2500 ms, hard ceiling ~15 s (tunable consts). Reuses `createDebouncer`.
- **Periodic timer**: every `PERIODIC_MS` (default **5 min**) calls `requestSync('periodic')`. Started by `start()`, cleared by `stop()`.
- All sync execution goes through one private `runOnce(reason)` that applies the dirty/conditional logic below.

`bumpDirty`/`subscribeDirty` (`src/sync/dirty.ts`) collapse into the scheduler: repos call `syncScheduler.markDirty()`. (Keep a thin `dirty.ts` shim if it reduces churn, but the scheduler is the owner.)

### 2. Dirty tracking + ETag (skip no-ops)

- In-memory `dirty: boolean` in the scheduler — set by `markDirty()`, cleared after a successful push. Reliable within a session.
- Persistent `cloud_etag` in `sync_state` — the ETag of the cloud doc as of our last successful sync (so conditional reads work; updated on every successful read/write that returns an ETag).
- **Crash safety:** in-memory `dirty` is lost on restart, so **launch always does a full sync** (push whatever local has). Conditional skipping only applies when we *know* local is clean (in-session).

`runOnce(reason)`:
1. `reason === 'launch'` → **full sync** (unconditional), regardless of dirty.
2. Else if `dirty` → **full sync** (push local changes).
3. Else (clean) → **conditional sync**: `remote.read({ ifNoneMatch: cloud_etag })`:
   - `'not-modified'` → **skip** (no download/merge/upload). Done.
   - data (changed) → pull + merge + apply locally; store new etag. **No upload** (local contributed nothing).
   - absent (404) → seed (same as today).

### 3. Conditional read (provider) + skip-identical-write (engine)

`SyncRemote.read` gains an optional arg (additive; existing callers unaffected):

```ts
read(opts?: { ifNoneMatch?: string }):
  Promise<{ content: string; etag: string | null } | 'not-modified' | null>;
```

WebDAV impl: when `opts?.ifNoneMatch` is set, send `If-None-Match`; on `304` return `'not-modified'`. `null` stays "absent" (404). `read()` with no args behaves exactly as today.

`runSync` (engine) gains a **skip-identical guard**: after building `outDoc`, if `outDoc === pulled.content`, skip the `write` entirely (the cloud already holds exactly this). This prevents redundant uploads even on the dirty path / when a merge produced no net change, and returns a `{ status: 'unchanged' }` outcome. (Also store `cloud_etag` from the read.)

`runSync` should also return/propagate the final ETag so the scheduler can persist `cloud_etag`.

### 4. Unify the entry points

- `eraseAllDataAndSync`, `importBackup`, `loadSampleData` stop calling `syncNow()` directly. Instead: do the local data op, then `syncScheduler.markDirty()` + `await syncScheduler.requestSync('write')`. The "pre-sync to advance the clock" step becomes `await syncScheduler.requestSync('launch')`-style full sync *before* the destructive op where needed (erase/import still want the clock advanced first — keep an explicit pre-sync via the scheduler, not a raw `syncNow`).
- `SyncContext` becomes a thin adapter: on mount `syncScheduler.start()` + `requestSync('launch')`; subscribes to `syncScheduler` for status; `syncNow()`/`overwriteCloud()` buttons call the scheduler; on unmount `stop()`. The existing crash-recovery (`SYNC_IN_PROGRESS` → `cascadeRepair`) stays at launch.

### 5. Lifecycle triggers (desktop-reliable)

- Keep RN `AppState` 'active' → `requestSync('lifecycle')` (works on mobile).
- Add **web/desktop** triggers via DOM (guarded to web/Tauri): `visibilitychange` (→ on hidden, flush if dirty; on visible, requestSync), and `beforeunload`/`blur` → best-effort flush if dirty. These fire reliably in the Tauri webview where RN AppState background does not.
- Periodic timer covers the gap regardless.

### 6. Service worker: off on desktop

In `app/+html.tsx`, gate registration:

```js
if ('serviceWorker' in navigator) {
  if (window.__TAURI_INTERNALS__) {
    // Desktop: assets are embedded; a SW only serves stale bundles. Unregister any
    // leftover from a prior build so existing installs self-heal.
    navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister()));
  } else {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function (err) { /* existing */ });
    });
  }
}
```

Web/PWA keeps its SW unchanged. The `no-store` meta in `+html.tsx` stays.

### 7. build-windows.sh fail-fast

The script must abort with a non-zero exit (and NOT print `==> Done`) if `tauri build` fails. It already has `set -euo pipefail`, but the failing `tauri build` runs inside `npm run tauri:build` whose non-zero status is apparently not propagating (likely the powershell.exe invocation / a pipe). Fix: check the build step's exit status explicitly and `exit 1` on failure before the "copy artifacts / Done" section. Verify by intentionally breaking the config once.

---

## Testing

Engine/scheduler logic is platform-free and unit-testable (node `--import tsx --test`):

- **scheduler.test.ts** (injected fake clock/timers + fake remote + in-memory state):
  - write → debounced single sync; burst coalesces to one.
  - periodic when clean + remote unchanged → conditional read returns `'not-modified'` → no merge/no write (assert remote untouched).
  - periodic when clean + remote changed → pulls + applies, no upload.
  - dirty → full sync + write; dirty cleared after.
  - inFlight + pending: request mid-sync runs exactly once more.
- **sync.test.ts** additions: `runSync` skip-identical-write (outDoc === pulled.content → no write, status 'unchanged'); ETag propagation.
- **webdav.test.ts** additions: `read({ ifNoneMatch })` sends the header and maps `304 → 'not-modified'`, `200 → data`, `404 → null`.

Not unit-tested (manual on desktop): the SW unregister, DOM lifecycle triggers, `SyncContext` wiring, build-script fail-fast.

**Manual desktop checklist (also closes the prior unverified deletion fix):**
1. Connect 坚果云 — no error.
2. Load sample → reset (new modal) → data gone; inspect DB: tombstones written, `deviceId` unchanged; reconnect/sync → stays gone (no resurrection).
3. Edit a record → within a few seconds it syncs (watch the cloud file ETag change); idle 5 min → a poll happens but the cloud file is untouched (304 skip).
4. Rebuild → relaunch → app loads the new bundle with no manual cache clear (SW gone).

---

## Risks / notes

- **Launch always full-syncs** (can't trust in-memory dirty across restart) — one full upload per launch even if nothing changed. Acceptable; could later persist a dirty flag to make launch conditional too.
- **Pull-only path correctness:** when clean + remote changed, we apply remote and must NOT push. Guard via the skip-identical check (outDoc will equal pulled) so even if the code path pushes, it's a no-op.
- **`requestSync` never throws** — errors surface via status/`lastError` (so a failed best-effort flush on close can't crash anything). Keeps the `.catch(()=>{})` semantics but centralized.
- Debounce/periodic/ceiling values are single-source consts, easy to tune (5 min, 2.5 s, 15 s).
