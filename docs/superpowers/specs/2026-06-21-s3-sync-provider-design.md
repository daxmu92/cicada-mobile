# S3-Compatible Sync Provider — Design

**Date:** 2026-06-21
**Status:** Approved design
**Relates to:** `2026-06-20-cloud-sync-webdav-design.md` (the `SyncRemote` interface this plugs into) and the completed cloud-sync v1 (Phases 1–5, merged). This adds a **second transport** behind the existing interface.

## 0. Goal & scope

Add a **generic S3-compatible** `SyncRemote` provider (Cloudflare R2 / AWS S3 / Backblaze B2 / MinIO) as an **alternative backend to WebDAV**, so the user isn't tied to 坚果云/WebDAV. R2 is the documented default example.

**Locked decisions (from brainstorming):**

| Decision | Choice |
|---|---|
| Targets | **iOS, Android, Tauri desktop** — same as WebDAV. Plain browser/PWA stays local-only (no web sync). |
| Provider breadth | **Generic S3-compatible** (path-style addressing), not R2-only. |
| Auth | **AWS SigV4**, implemented as a **pure-JS signer** (`@noble/hashes`), no `crypto.subtle`. |
| Encryption | **Out of scope.** Cloud provider assumed trusted; `enc` envelope stays reserved. |
| WebDAV | **Retained.** S3 is an added option, selected in Settings. |
| Concurrency | Reuse the orchestrator's existing `If-Match` + self-heal logic — **no orchestrator change**. |

**Non-goals:** web/PWA sync, at-rest encryption, replacing WebDAV, virtual-hosted-style addressing, multipart upload (the sync doc is tens of KB).

## 1. Why this fits with almost no churn

The cloud-sync engine is transport-agnostic: `sync.ts` (orchestrator), `merge.ts`, `apply.ts`, `document.ts`, `reconcile.ts` all operate on a `SyncRemote` and plaintext JSON. WebDAV is one implementation; S3 is another. The only existing code that changes is the **config/credential shape** (to carry which provider) and the **Settings UI** (to pick one). One new runtime dependency: **`@noble/hashes`** (pure-JS, zero native build, works on Hermes/web/Tauri/node → installs everywhere, unit-testable in node).

## 2. Module layout (delta)

```
src/sync/providers/
  s3.ts        # NEW: createS3Remote(config: S3Config, http: HttpClient): SyncRemote
  sigv4.ts     # NEW: pure-JS AWS Signature V4 signer
  webdav.ts    # unchanged
  types.ts     # unchanged (S3 reuses SyncRemote / WritePrecondition / ConflictError / AuthError / HttpClient)
src/sync/
  credentials.ts / credentials.web.ts   # generalize stored shape to a tagged union (provider: 'webdav' | 's3')
  remote.ts                              # createConfiguredRemote dispatches on the provider tag
src/components/CloudSyncSection.tsx      # add a provider selector + S3 fields
```

## 3. `S3Config` and the SigV4 signer

### 3.1 Config

```ts
export type S3Config = {
  endpoint: string;        // e.g. https://<account>.r2.cloudflarestorage.com  (R2)
                           //      https://s3.us-east-1.amazonaws.com           (AWS, path-style)
  region: string;          // R2: "auto"; AWS: the bucket region
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  objectKey?: string;      // default: "cicada/cicada-sync.json"
};
```

The full object URL is **path-style**: `joinUrl(endpoint, bucket + '/' + objectKey)`, e.g. `https://<acct>.r2.cloudflarestorage.com/cicada-bucket/cicada/cicada-sync.json`. Path-style is the common denominator across R2/AWS/B2/MinIO. (AWS deprecates path-style for *new* bucket creation tooling, but the request style still works; documented as a known constraint.)

### 3.2 `sigv4.ts` — pure-JS Signature V4

A single pure function, no I/O, no `crypto.subtle`:

```ts
import { sha256 } from '@noble/hashes/sha2';
import { hmac } from '@noble/hashes/hmac';

export type SignInput = {
  method: string;                         // GET | PUT
  url: string;                            // full path-style object URL
  headers: Record<string, string>;        // caller-provided (e.g. If-Match) — included in the signature
  body: string;                           // "" for GET
  region: string;
  service: string;                        // "s3"
  accessKeyId: string;
  secretAccessKey: string;
  amzDate: string;                        // "YYYYMMDDTHHMMSSZ" (caller supplies → testable)
};

// Returns the headers to MERGE into the request:
//   Authorization, x-amz-date, x-amz-content-sha256, host
export function signRequestV4(input: SignInput): Record<string, string>;
```

Algorithm (standard SigV4, hex/HMAC via `@noble/hashes`):
1. `x-amz-content-sha256 = hex(sha256(body))` (signed payload; `UNSIGNED-PAYLOAD` not used).
2. **Canonical request** = `method \n canonicalURI \n canonicalQuery("") \n canonicalHeaders \n signedHeaders \n payloadHash`. Canonical headers always include `host`, `x-amz-content-sha256`, `x-amz-date`, plus any caller header (lower-cased, sorted, trimmed). `host` is derived from the URL.
3. **String to sign** = `"AWS4-HMAC-SHA256" \n amzDate \n scope \n hex(sha256(canonicalRequest))`, scope = `<date>/<region>/<service>/aws4_request`.
4. **Signing key** = `HMAC(HMAC(HMAC(HMAC("AWS4"+secret, date), region), service), "aws4_request")`.
5. **Signature** = `hex(HMAC(signingKey, stringToSign))`.
6. `Authorization = "AWS4-HMAC-SHA256 Credential=<key>/<scope>, SignedHeaders=<signedHeaders>, Signature=<sig>"`.

`amzDate` is a parameter (not read from a clock inside), so the signer is deterministic and testable against AWS's published known-answer vectors.

## 4. `s3.ts` — `createS3Remote(config, http)`

`http` is the same injected `HttpClient` (native `fetch` / Tauri `plugin-http`) the WebDAV provider uses — so Tauri's CORS-free path is preserved and tests can inject a mock. Each call signs with the current UTC `amzDate` (via `Date`), merges the signed headers, then dispatches through `http`.

- **`isConnected()`** → `Boolean(endpoint && bucket && accessKeyId && secretAccessKey)`.
- **`read()`** → signed `GET`. `200` → `{ content: await res.text(), etag: res.headers.get('ETag') }`; `404` → `null`; `401|403` → `throw new AuthError()`; other non-2xx → `Error`.
- **`write(content, pre)`** → signed `PUT` with `Content-Type: application/json` and body=content:
  - `pre.kind === 'ifMatch'` → header `If-Match: <etag>`
  - `pre.kind === 'ifNoneMatch'` → header `If-None-Match: *`
  - `pre.kind === 'none'` → no precondition header
  - `412` → `throw new ConflictError()`; `401|403` → `AuthError`; `200/201` → `{ etag: res.headers.get('ETag') }`.
  - **No directory creation** — unlike WebDAV there is no MKCOL; the object key is created implicitly.
- **`testConnection()`** → signed `GET` of the object. `200` or `404` → success (connected; 404 just means not seeded yet); `401|403` → `AuthError`; other → `Error`.

Because S3 returns no `ETag` on some `PUT`s (provider-dependent), `write` returning `etag: null` is allowed — the orchestrator already re-reads when needed.

## 5. Concurrency — no orchestrator change

S3/R2 always return `ETag` on `GET`, so `runSync` will use `{ kind: 'ifMatch', etag }` on update and `{ kind: 'ifNoneMatch' }` on the first-write/seed. R2 and modern AWS honor conditional writes → stale `If-Match` returns `412` → `ConflictError` → re-pull/re-merge/retry (existing logic). A provider that ignores the precondition simply overwrites → the **already-built self-heal convergence** (every push is preceded by pull+merge; merge is commutative/idempotent) keeps devices consistent. Either way is correct; we **empirically confirm** the chosen provider's `If-Match` behavior with a probe (mirroring the 坚果云 test, recorded in this spec on completion).

## 6. Config / credentials / Settings

### 6.1 Stored shape (tagged union)

```ts
export type StoredRemoteConfig =
  | ({ provider: 'webdav' } & WebDavConfig)
  | ({ provider: 's3' } & S3Config);
```

`credentials.ts` / `credentials.web.ts` store/load this union (secure storage; secrets never leave the device). Back-compat: a stored value with **no `provider` field** is treated as `'webdav'` (existing users keep working).

### 6.2 `remote.ts`

```ts
export function createConfiguredRemote(config: StoredRemoteConfig): SyncRemote {
  return config.provider === 's3'
    ? createS3Remote(config, httpClient)
    : createWebDavRemote(config, httpClient);
}
```

### 6.3 Settings UI

`CloudSyncSection` gains a **provider selector** (two chips: `WebDAV` | `S3`). The form renders the matching fields:
- WebDAV (unchanged): server URL, account, app password.
- S3: endpoint, region, bucket, access key ID, secret access key (+ optional object key, default shown).

`Test connection` / `Connect` / `Sync now` / `Disconnect` / status all work identically (they go through `SyncContext` → `createConfiguredRemote`). The selector is disabled while connected (same as the existing fields).

## 7. Error handling

- `401/403` → `AuthError` → Settings shows "auth failed, check keys".
- Network failure (`TypeError`) → offline (existing `classify`).
- `412` → `ConflictError` → orchestrator retry.
- Malformed `endpoint` (not a URL) → `testConnection`/`read` throws a clear `Error` before signing.
- Clock skew: SigV4 rejects requests with a timestamp far from server time (`403 RequestTimeTooSkewed`). Surfaced as `AuthError` with a hint; rare on modern devices.

## 8. Testing

- **`sigv4.ts` (unit, node):** sign a known request and assert the exact `Authorization`/signature against **AWS's published SigV4 test-suite vectors** (and at least one R2-style `region:"auto"` case). This is the highest-value test — signing correctness.
- **`s3.ts` (unit, node, mock `HttpClient`):** `read` 200/404/403; `write` ifMatch/ifNoneMatch/none and 412→ConflictError, 403→AuthError; header assembly (precondition headers present/absent; signed headers merged). Mirrors `webdav.test.ts`.
- **`remote.ts` (unit):** `createConfiguredRemote` dispatches `s3`→S3, `webdav`/no-tag→WebDAV.
- **Manual (developer):** round-trip against a real R2 (or local MinIO) bucket — `testConnection`/`write`/`read`, and a stale-`If-Match` probe to record whether conditional writes are honored.

No engine/orchestrator tests change (S3 is invisible to them); the existing 78 stay green.

## 9. Module-boundary notes

- `sigv4.ts` is a pure function (no I/O, no clock, no RN/expo) → fully node-testable and reusable.
- `s3.ts` depends only on `sigv4.ts`, the `SyncRemote`/`HttpClient` types, and `@noble/hashes` (transitively via sigv4) → node-testable with a mock client.
- The provider union touches `credentials.*`, `remote.ts`, and `CloudSyncSection.tsx` — the UI being the largest single piece.
