# Cloud Sync — WebDAV Transport Design (supersedes OneDrive transport)

**Date:** 2026-06-20
**Status:** Approved design
**Supersedes:** the transport / auth / platform / orchestration sections (§6 setting-shape
note, §11, §12) of `2026-06-02-cloud-sync-design.md`. Everything else in that spec —
schema v2, HLC, merge/apply/reconcile, the `cicada-sync.json` document format, the
encryption-ready envelope, backup v3, tombstone GC — **still stands unchanged.**

## 0. Why this revision

The original spec routed sync through the user's OneDrive via Microsoft Graph + OAuth
(PKCE). Two problems made that heavy: (1) accessing OneDrive **requires registering an
app** in Entra/Azure to obtain a `client_id` — unavoidable for Graph, and fiddly; (2)
the web/PWA OAuth path fought cross-origin isolation (the spec's most complex section,
§11.4 — a non-isolated `/auth` route, MSAL, BroadcastChannel handoff).

This revision replaces the transport with **WebDAV** (default target: 坚果云 / Nutstore,
but any standard WebDAV server works). WebDAV uses **Basic auth with an app-specific
password** — no OAuth, no app registration, no `/auth` route, no MSAL, no deep links.
The `SyncRemote` interface is retained so an **S3-compatible provider (Cloudflare R2 /
Backblaze B2) can be added later** without touching the engine.

### Locked decisions (delta from the original)

| Decision | Choice |
|---|---|
| Transport (v1) | **WebDAV**, a single file `<base>/cicada/cicada-sync.json` |
| Default server | 坚果云 (`https://dav.jianguoyun.com/dav/`); any standard WebDAV accepted |
| Auth | **HTTP Basic** (account + app-specific password) over HTTPS. No OAuth. |
| Targets (v1) | **iOS, Android, Tauri desktop.** Plain browser/PWA: sync UI hidden, app stays local-only |
| Concurrency | **`If-Match`/`If-None-Match` when the server honors them; self-healing convergence when it does not** (see §5) |
| Credential storage | native → `expo-secure-store`; Tauri → secure store plugin |
| Second provider | **S3/R2 deferred** — `SyncRemote` leaves room (see §7) |

Unchanged locked decisions from the original: per-record LWW by HLC; additive sync
columns + integer PKs; **v1 plaintext** with an encryption-ready `enc` envelope; no
multi-user / real-time; no auto-match of transactions on first connect.

### Non-goals (v1)

- No web/PWA sync (the only target where WebDAV would hit browser CORS). The web build
  keeps working **locally**; its Cloud Sync settings section is simply hidden.
- No S3/R2 provider yet (interface-ready only).
- No at-rest encryption (envelope reserved).
- No OAuth / app registration of any kind.

---

## 1. Why WebDAV is dramatically simpler here

The user confirmed sync is needed only on **phone + Tauri desktop** — neither enforces
browser CORS (RN `fetch` and Tauri's HTTP plugin both bypass it). That removes the
single hardest part of the original design. Net deletions from the original scope:

- ❌ Azure app registration / `client_id`
- ❌ the non-isolated `/auth` route, MSAL.js, `BroadcastChannel` token handoff
- ❌ `expo-auth-session`, `expo-crypto` (PKCE), `cicadamobile://` deep link, loopback OAuth
- ❌ Graph `@microsoft.graph.downloadUrl` / `:/content` CORS dance

Replaced by: a Basic `Authorization` header and standard `GET`/`PUT`/`PROPFIND`/`MKCOL`.

---

## 2. Module layout (delta from original §3.1)

Phase 1 (`hlc.ts`, `device.ts`, `stamp.ts`, `clock.ts`, `sync-state-repo.ts`) is **done
and unchanged**. Phase 2 (`document.ts`, `merge.ts`, `apply.ts`, `reconcile.ts`) is
**unchanged from the original spec**. This revision only changes what sits below the
orchestrator:

```
src/sync/
  document.ts         # (Phase 2, unchanged) build/parse cicada-sync.json
  merge.ts            # (Phase 2, unchanged) pure per-record LWW
  apply.ts            # (Phase 2, unchanged) FK-ordered apply + cascade-repair
  reconcile.ts        # (Phase 2, unchanged) natural-key uuid adoption
  sync.ts             # orchestrator (revised §5: WebDAV preconditions, self-heal)
  available.ts        # isSyncAvailable(): native OR Tauri, never plain web
  http.ts             # native HTTP client = global fetch
  http.web.ts         # web build: Tauri -> @tauri-apps/plugin-http fetch; plain browser -> n/a
  credentials.ts      # secure get/set of {baseUrl, username, appPassword} (native)
  credentials.web.ts  # Tauri secure store; plain browser -> no-op
  providers/
    types.ts          # SyncRemote, WritePrecondition, ConflictError, HttpClient
    webdav.ts         # WebDAV implementation (the only provider in v1)
src/hooks/SyncContext.tsx   # status + connect/disconnect + syncNow; native/desktop only
```

The Settings screen gains a **"Cloud Sync"** section (hidden when `!isSyncAvailable()`):
server URL (default 坚果云), account, app password, **Test connection**, Connect /
Disconnect, **Sync now**, last-synced time, status/error.

---

## 3. HTTP layer (the only platform-conditional piece)

Mirrors the existing `database.ts` / `database.web.ts` split:

- **`http.ts` (native, iOS/Android):** exports `httpClient = globalThis.fetch`. RN `fetch`
  supports Basic auth and arbitrary methods (`PUT`, `PROPFIND`, `MKCOL`); no CORS.
- **`http.web.ts` (web build):** at runtime checks `window.__TAURI_INTERNALS__` (same probe
  `database.web.ts` already uses). **Tauri desktop** → lazy-import `@tauri-apps/plugin-http`
  and use its `fetch` (bypasses the webview's CORS, supports all methods). **Plain
  browser/PWA** → sync is disabled (`isSyncAvailable()` is false), so this path is never
  taken; `httpClient` throws if called.

`HttpClient` is the minimal shape the provider needs:

```ts
type HttpClient = (url: string, init: {
  method: string;
  headers: Record<string, string>;
  body?: string;
}) => Promise<{ status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>;
```

`fetch` and the Tauri plugin's `fetch` both satisfy this directly.

### Tauri capability

`@tauri-apps/plugin-http` requires a capability grant. Because the WebDAV host is
**user-configured** (any server), the grant must be broad: allow `https://**/*` (and
`http://**/*` for LAN servers) in `src-tauri/capabilities/`. This is acceptable for a
user-controlled desktop app and is documented as such (same trust posture as the
plaintext-in-cloud stance).

---

## 4. WebDAV provider (`providers/webdav.ts`)

### 4.1 `SyncRemote` interface (`providers/types.ts`)

```ts
type WritePrecondition =
  | { kind: 'ifMatch'; etag: string }   // update: server should 412 if remote changed
  | { kind: 'ifNoneMatch' }             // create-only: server should 412 if file exists
  | { kind: 'none' };                   // unconditional overwrite (fallback)

class ConflictError extends Error {}    // thrown on HTTP 412

interface SyncRemote {
  isConnected(): boolean;
  testConnection(): Promise<void>;                 // throws on auth/network failure
  read(): Promise<{ content: string; etag: string | null } | null>;  // null on 404
  write(content: string, pre: WritePrecondition): Promise<{ etag: string | null }>;
}
```

`etag` is **nullable**: if the server does not return an `ETag` header, conditional
writes are not possible and the orchestrator falls back to `{ kind: 'none' }` (§5).

### 4.2 Config & identity

Stored split: **secrets in secure storage, non-secrets in `sync_state`.**

- Secure storage (`credentials.ts`): `{ baseUrl, username, appPassword }`.
- `sync_state` (device-local, never synced — already exists from Phase 1): `filePath`
  (default `cicada/cicada-sync.json`), `lastEtag`, `lastSyncedAt`, `reconcileDone` flag.

The full file URL = `joinUrl(baseUrl, filePath)`, e.g.
`https://dav.jianguoyun.com/dav/cicada/cicada-sync.json`.

### 4.3 WebDAV calls (all with `Authorization: Basic base64(username:appPassword)`)

- **`testConnection()`** — `PROPFIND` the base folder with `Depth: 0` (坚果云 supports
  `Depth: 0/1`). 207 → ok; 401 → bad credentials; network error → offline.
- **Ensure folder (before a create)** — `MKCOL <base>/cicada/`. 201 (created) or 405
  (already exists) both count as success; idempotent.
- **`read()`** — `GET` the file. 200 → `{ content: body, etag: headers.get('ETag') }`;
  404 → `null`. Capture the `ETag` for later `If-Match`.
- **`write(content, pre)`** — `PUT` the file with `content` as body and
  `Content-Type: application/json`, adding:
  - `pre.kind === 'ifMatch'`   → header `If-Match: <etag>`
  - `pre.kind === 'ifNoneMatch'` → header `If-None-Match: *`
  - `pre.kind === 'none'`       → no precondition header
  On 200/201/204 → return `{ etag: headers.get('ETag') }`. On **412 → throw
  `ConflictError`**. On 401 → auth error (prompt reconnect).
- **Size:** the document is tens of KB; far under 坚果云's 500 MB WebDAV `PUT` limit. No
  chunked upload needed.
- **Rate limits:** 坚果云 free = 600 requests / 30 min (paid 1500). One sync = ~2–4
  requests; trivially within budget even with retries.

---

## 5. Orchestration & concurrency (`sync.ts`) — revised from original §12

```
syncNow():
  1. !isConnected -> no-op
  2. remote = provider.read()                       # GET; null on 404
  3. remote == null:
       ensureFolder(); provider.write(buildDocument(), { kind: 'ifNoneMatch' })  # seed
         └ ConflictError (someone else seeded) -> goto 2
       else save etag; done
  4. parse remote; if enc != "none" OR schemaVersion > 2 -> stop ("please update app")
  5. detect natural-key/uuid conflicts -> reconcile.ts (+ first-connect Merge/Replace)
  6. merged = merge(local, remoteDoc); apply(merged)        # pure, idempotent (Phase 2)
  7. pre = remote.etag ? { kind: 'ifMatch', etag: remote.etag } : { kind: 'none' }
     provider.write(buildDocument(), pre)
       └ ConflictError -> re-pull, re-merge, retry (exponential backoff + jitter)
  8. save lastEtag + lastSyncedAt; status = ok
```

**When the server honors conditional writes** (`If-Match`/`If-None-Match`), this is
identical in strength to the original Graph/ETag design: a concurrent writer between
read and write is caught by 412, and each retry re-pulls + re-merges, making **monotonic
progress** toward convergence.

**When the server returns no ETag** (conditional writes unavailable), step 7 degrades to
an unconditional `PUT`. Correctness still holds *eventually* because:
- every push is preceded by a pull + merge (step 6), so we never push *less* than we saw;
- if device B overwrites a version device A pushed in the same window, A's changes are
  **still in A's local SQLite + tombstones**, and A's next sync re-pushes them — the
  merge is commutative/idempotent, so the system **re-converges**.
- The only residual data-loss case is a record edited on a device that then **never syncs
  again**. For a single user with foreground-triggered sync, this window is small and
  **documented as accepted** (§8).

**Triggers:** app launch + `AppState` → `active` (debounced, skipped if a sync is in
flight) + manual **Sync now**. Only registered when `isSyncAvailable()`.

---

## 6. First-connect, reconciliation, document, merge — unchanged

These carry over verbatim from `2026-06-02-cloud-sync-design.md`:

- **Document format** (§6 there): the same `cicada-sync.json` envelope
  (`syncFormatVersion`, `enc`, `schemaVersion`, `tables` keyed by uuid, `tombstones`).
  FKs travel as parent uuids. The `setting` table is emitted in the array-with-`updated_at`
  form (the one builder change noted there).
- **Merge** (§7): pure per-record LWW by HLC ordinal compare; tombstone competes as a record.
- **Apply** (§8): FK-ordered, uuid→localId translation, authoritative cascade-repair,
  `UNIQUE`-collision auto-suffix.
- **Reconciliation** (§10): natural-key uuid adoption on collision; **no `tran` matching**;
  first-connect **Merge (default) / Replace** choice; the migration-HLC coarse-merge caveat.
- **Deletes & cascade** (§9): already implemented in Phase 1 (tombstones incl. cascaded
  descendants).

---

## 7. Deferred S3/R2 provider (interface-ready, not built)

`SyncRemote` maps cleanly onto S3-compatible storage for a future `providers/s3.ts`:
`read` = `GetObject` (404 → null, `ETag` captured), `write` with `If-None-Match: *`
(create-only) and `If-Match: <etag>` (update; R2 and modern S3 support both). Auth =
SigV4 with a user-supplied access-key/secret (a tiny browser-capable signer such as
`aws4fetch`), which **would** restore web/PWA sync (S3 CORS is bucket-configurable).
Out of scope for v1; listed so the interface is not narrowed against it.

---

## 8. Error handling & edge cases (delta)

- **Offline / network error** → status "offline"; retry next trigger; local untouched.
- **401 (bad app password / revoked)** → status "auth error"; prompt to re-enter credentials.
- **412 on update** → re-pull, re-merge, retry with backoff+jitter.
- **412 on create-only seed** → another device seeded; go to read path.
- **No-ETag server** → unconditional overwrite with self-healing convergence (§5);
  **accepted, documented** residual loss window.
- **Corrupt/invalid remote file** → refuse to apply; keep local intact; offer "overwrite
  cloud with this device."
- **`enc`/`schemaVersion` ahead of this app** → stop, ask to update; never partial-apply.
- **Tauri non-atomic apply** → unchanged from original (idempotent re-merge converges;
  `sync-in-progress` flag in `sync_state`).
- **Privacy (plaintext in cloud)** → unchanged stance; protection is the user's WebDAV
  account + app password; `enc` envelope reserves AES-GCM later.
- **App password stored on device** → secure storage (native `expo-secure-store`; Tauri
  secure store). Same trust class as the plaintext-cloud stance; documented.
- **Backup v3 / tombstone GC** → unchanged from original (Phase 5).

---

## 9. New dependencies & prerequisites

- **Native:** `expo-secure-store` (Expo SDK 54 compatible) for credentials. **No** OAuth
  libs. No WebDAV library — standard `fetch` + WebDAV verbs.
- **Tauri desktop:** `@tauri-apps/plugin-http` (CORS-free HTTP) + a secure-storage plugin
  (`tauri-plugin-store` for simplicity, consistent with the plaintext stance; or
  `tauri-plugin-stronghold` as a hardening option — document the choice), plus matching
  grants in `src-tauri/capabilities/` (HTTP scope `https://**/*` + `http://**/*`).
- **User prerequisite (one-time, trivial):** in 坚果云 web → 账户信息 / 安全选项 →
  添加应用密码 → copy the WebDAV address (`https://dav.jianguoyun.com/dav/`), the account
  (email), and the generated app password. **No app registration, no admin consent.**

---

## 10. Phased rollout (revised)

Phase 1 is **complete**. Each remaining phase is independently mergeable and verified with
`npx tsc --noEmit` + `npm run lint` + `npm test` + running the relevant platform.

2. **Engine** — `document.ts`, `merge.ts` (pure, unit-tested with the Phase-1 `node:test`
   harness), `apply.ts`, `reconcile.ts`. No network. *(unchanged from original Phase 2)*
3. **WebDAV provider** — `providers/types.ts` (`SyncRemote`/`WritePrecondition`/
   `ConflictError`/`HttpClient`), `providers/webdav.ts`, the `http.ts`/`http.web.ts` split,
   `available.ts`, `credentials.ts`/`credentials.web.ts`. Conditional writes + `MKCOL` +
   no-ETag fallback.
4. **Orchestration + UI** — `sync.ts` (revised §5), `SyncContext`, Settings "Cloud Sync"
   section (native/desktop only), triggers (launch / foreground / manual). **No OAuth —
   far smaller than the original Phase 4.**
5. **Backup v3, tombstone GC, polish, cross-target verification.** *(unchanged)*

---

## 11. Verification

- `npx tsc --noEmit` + `npm run lint` + `npm test` after each phase.
- `merge.ts` pure unit tests (LWW ordering, tombstone competition, cascade-repair,
  natural-key adoption, HLC compare/overflow) — Phase 2.
- Manual cross-target (Phase 4): **phone + Tauri desktop**, offline edits on each → sync →
  confirm convergence; delete-propagation incl. parent-delete vs concurrent child-edit;
  first-connect Merge and Replace; **empirically confirm whether 坚果云 honors `If-Match`**
  (a `PUT` with a stale `If-Match` should return 412 if supported) and that convergence
  holds either way; 401 handling on a wrong app password.

### 11.1 坚果云 empirical results (2026-06-21, RESOLVED)

Ran the real provider (`createWebDavRemote` + Node global `fetch`) against live
坚果云 via `scripts/test-webdav.ts`. Findings:

- **Auth + PROPFIND**: ✅ Basic auth with an app password works.
- **MKCOL + PUT**: ✅ first `ifNoneMatch` write creates the `cicada/` collection.
- **GET returns `ETag`**: ✅ (e.g. `1v5Q743Hsb9Jo1ykreJPig`) — usable for `If-Match`.
- **`If-Match`**: ✅ **HONORED** — a `PUT` with a stale `If-Match` returns **412**
  (→ `ConflictError`); a correct `If-Match` succeeds.
- **`If-None-Match`**: ❌ **IGNORED** — a create-only `PUT` to an existing file
  succeeds instead of 412.
- **PUT returns no `ETag`** — after a write, must `read()` (or the next pull) to
  get the fresh etag.

**Decision for Phase 4:** use standard optimistic concurrency on `If-Match`
(read → merge → `write(ifMatch, etag)`; on 412 re-pull/merge/retry). The
pessimistic self-healing fallback is **not needed**. The first write (no remote
file) goes through `ifNoneMatch` (which also triggers MKCOL); 坚果云 ignoring
If-None-Match only affects a simultaneous-first-write race, which the union LWW
merge converges on the next sync. Note the provider only MKCOLs on the
`ifNoneMatch` path, so the orchestrator's **first write must use `ifNoneMatch`**;
subsequent writes use `ifMatch`.
</content>
