# Cloud Sync — Phase 3 (Part 1): WebDAV Provider Protocol Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the WebDAV transport — the `SyncRemote` interface and a `createWebDavRemote()` provider implementing the read/write/test-connection protocol (Basic auth, `GET`/`PUT`/`PROPFIND`/`MKCOL`, `If-Match`/`If-None-Match`, 404→null, 412→ConflictError, ETag capture) — entirely against an **injected `HttpClient`**, so it is fully unit-tested with a mock client and needs no network, no native dependency, and no real WebDAV server. Plus `isSyncAvailable()`.

**Architecture:** Two node-pure files (`providers/types.ts`, `providers/webdav.ts`) plus one tiny platform shim (`available.ts`). The provider is a pure protocol translator: it takes a `WebDavConfig` and an `HttpClient` (the same minimal shape `fetch` and Tauri's `@tauri-apps/plugin-http` both satisfy) and turns `SyncRemote` calls into HTTP requests. The platform selection of the real `HttpClient` and credential storage are deferred to Part 2 (they need native deps + dev builds and can't be node-tested).

**Tech Stack:** TypeScript (strict). Tests: `node:test` + `tsx` (from Phase 1) with a mock `HttpClient`. **No new dependency.** Uses the global `btoa` (present in Node 20, RN Hermes, browser, and Tauri webview).

## Scope note

This is the testable half of the WebDAV spec's Phase 3 (`2026-06-20-cloud-sync-webdav-design.md` §3–§4). **Part 2 (separate plan)** wires the real platform `HttpClient` (`http.ts` native `fetch` / `http.web.ts` Tauri `@tauri-apps/plugin-http`), credential secure-storage (`credentials.ts` `expo-secure-store` / `credentials.web.ts` Tauri secure store), the Tauri Rust plugin + `src-tauri/capabilities` grant, and the new dependencies. The orchestrator (`sync.ts`), `hlc.receive()`, `SyncContext`, and the Settings UI are Phase 4.

## Global Constraints

- **Node 20+. No new dependency** (runtime or dev) in this plan. Tests use an in-file mock `HttpClient`; auth uses the global `btoa`.
- **`providers/types.ts` and `providers/webdav.ts` import NOTHING** from React Native, Expo, better-sqlite3, or any platform HTTP library — they are node-pure so they stay unit-testable. `webdav.ts` uses only the injected `HttpClient`, its config, and the global `btoa`.
- **The provider is a mechanical protocol translator.** It does NOT decide retry, fallback, or precondition policy — it sends exactly the `WritePrecondition` it is given. (The no-ETag→unconditional-write fallback is the orchestrator's job in Phase 4; the provider simply returns `etag: null` when the server sends no `ETag`.)
- **`HttpClient` shape** (satisfied by both `fetch` and `@tauri-apps/plugin-http`'s `fetch`): `(url: string, init: { method: string; headers: Record<string,string>; body?: string }) => Promise<{ status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>`.
- **WebDAV protocol (spec §4.3):** Basic auth header `Authorization: Basic base64(username:appPassword)`; `read` = `GET` (200 → content + `ETag`; 404 → `null`); `write` = `PUT` the file with `Content-Type: application/json` plus `If-Match: <etag>` (ifMatch) or `If-None-Match: *` (ifNoneMatch) or no precondition (none); create-writes (`ifNoneMatch`) first `MKCOL` the parent folder (201 created or 405 exists both = success); `testConnection` = `PROPFIND` the base with `Depth: 0`. **HTTP 412 → throw `ConflictError`.** 401 → throw an auth error.
- **Default file path:** `cicada/cicada-sync.json`, resolved relative to `config.baseUrl` (e.g. `https://dav.jianguoyun.com/dav/`).
- **`isConnected()`** is true iff `baseUrl`, `username`, and `appPassword` are all non-empty.
- **Verification per task:** `npx tsc --noEmit` + `npm run lint` + `npm test` all green. (Repo has 2 pre-existing ESLint errors in `app/asset/[id].tsx` + 3 pre-existing warnings, unrelated — confirm no NEW issues.)

---

### Task 1: `SyncRemote` types + WebDAV read / testConnection

**Files:**
- Create: `src/sync/providers/types.ts`
- Create: `src/sync/providers/webdav.ts`
- Create: `src/sync/providers/webdav.test.ts`
- Modify: `package.json` (append `webdav.test.ts` to the `test` script)

**Interfaces:**
- Consumes: nothing (node-pure).
- Produces:
  - `types.ts`: `type WritePrecondition`, `class ConflictError`, `type HttpResponse`, `type HttpClient`, `interface SyncRemote`.
  - `webdav.ts`: `type WebDavConfig`, `createWebDavRemote(config: WebDavConfig, http: HttpClient): SyncRemote` (this task implements `isConnected`, `read`, `testConnection`; `write` is added in Task 2).

- [ ] **Step 1: Append the test file**

In `package.json`, extend the `test` script (keep existing files):

```json
    "test": "node --import tsx --test src/sync/hlc.test.ts src/sync/document.test.ts src/sync/merge.test.ts src/sync/test-support/sqlite.test.ts src/sync/apply.test.ts src/sync/convergence.test.ts src/sync/providers/webdav.test.ts"
```

- [ ] **Step 2: Write the failing test**

Create `src/sync/providers/webdav.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWebDavRemote } from './webdav';
import type { HttpClient, HttpResponse } from './types';

type Recorded = { url: string; method: string; headers: Record<string, string>; body?: string };

// A mock HttpClient that records requests and returns scripted responses.
function makeMock(
  responder: (r: Recorded) => { status: number; headers?: Record<string, string>; body?: string }
): { client: HttpClient; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const client: HttpClient = async (url, init) => {
    const rec: Recorded = { url, method: init.method, headers: init.headers, body: init.body };
    calls.push(rec);
    const res = responder(rec);
    const h = res.headers ?? {};
    const lower: Record<string, string> = {};
    for (const k of Object.keys(h)) lower[k.toLowerCase()] = h[k];
    const response: HttpResponse = {
      status: res.status,
      headers: { get: (n: string) => lower[n.toLowerCase()] ?? null },
      text: async () => res.body ?? '',
    };
    return response;
  };
  return { client, calls };
}

const config = {
  baseUrl: 'https://dav.jianguoyun.com/dav/',
  username: 'me@example.com',
  appPassword: 'secret',
};

test('read() GETs the default file path with a Basic auth header', async () => {
  const { client, calls } = makeMock(() => ({ status: 200, headers: { ETag: '"v1"' }, body: '{"k":1}' }));
  const remote = createWebDavRemote(config, client);
  const result = await remote.read();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].url, 'https://dav.jianguoyun.com/dav/cicada/cicada-sync.json');
  // Basic auth = base64("me@example.com:secret"); verify against an independent oracle.
  const expectedAuth = 'Basic ' + Buffer.from('me@example.com:secret').toString('base64');
  assert.equal(calls[0].headers['Authorization'], expectedAuth);
  assert.deepEqual(result, { content: '{"k":1}', etag: '"v1"' });
});

test('read() returns null on 404', async () => {
  const { client } = makeMock(() => ({ status: 404 }));
  const remote = createWebDavRemote(config, client);
  assert.equal(await remote.read(), null);
});

test('read() returns etag:null when the server sends no ETag', async () => {
  const { client } = makeMock(() => ({ status: 200, body: '{}' }));
  const remote = createWebDavRemote(config, client);
  assert.deepEqual(await remote.read(), { content: '{}', etag: null });
});

test('read() throws on an unexpected status (500)', async () => {
  const { client } = makeMock(() => ({ status: 500 }));
  const remote = createWebDavRemote(config, client);
  await assert.rejects(() => remote.read(), /500/);
});

test('testConnection() sends PROPFIND Depth:0 to the base URL', async () => {
  const { client, calls } = makeMock(() => ({ status: 207 }));
  const remote = createWebDavRemote(config, client);
  await remote.testConnection();
  assert.equal(calls[0].method, 'PROPFIND');
  assert.equal(calls[0].url, 'https://dav.jianguoyun.com/dav/');
  assert.equal(calls[0].headers['Depth'], '0');
});

test('testConnection() throws a clear error on 401', async () => {
  const { client } = makeMock(() => ({ status: 401 }));
  const remote = createWebDavRemote(config, client);
  await assert.rejects(() => remote.testConnection(), /authentication|401/i);
});

test('isConnected() reflects whether credentials are present', () => {
  assert.equal(createWebDavRemote(config, makeMock(() => ({ status: 200 })).client).isConnected(), true);
  const bare = { baseUrl: '', username: '', appPassword: '' };
  assert.equal(createWebDavRemote(bare, makeMock(() => ({ status: 200 })).client).isConnected(), false);
});

test('a custom filePath overrides the default', async () => {
  const { client, calls } = makeMock(() => ({ status: 404 }));
  const remote = createWebDavRemote({ ...config, filePath: 'foo/bar.json' }, client);
  await remote.read();
  assert.equal(calls[0].url, 'https://dav.jianguoyun.com/dav/foo/bar.json');
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './webdav'`.

- [ ] **Step 4: Write `types.ts`**

Create `src/sync/providers/types.ts`:

```ts
// Transport-agnostic sync remote. The WebDAV implementation is in webdav.ts;
// an S3/R2 implementation could be added later behind the same interface.

export type WritePrecondition =
  | { kind: 'ifMatch'; etag: string }   // update: server should 412 if remote changed
  | { kind: 'ifNoneMatch' }             // create-only: server should 412 if file exists
  | { kind: 'none' };                   // unconditional overwrite (orchestrator fallback)

export class ConflictError extends Error {
  constructor(message = 'remote precondition failed (HTTP 412)') {
    super(message);
    this.name = 'ConflictError';
  }
}

// The minimal HTTP response shape the provider needs. Both the global `fetch`
// Response and @tauri-apps/plugin-http's Response satisfy it.
export type HttpResponse = {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
};

export type HttpClient = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string }
) => Promise<HttpResponse>;

export interface SyncRemote {
  isConnected(): boolean;
  testConnection(): Promise<void>;                                   // throws on auth/network failure
  read(): Promise<{ content: string; etag: string | null } | null>; // null if the file is absent (404)
  write(content: string, pre: WritePrecondition): Promise<{ etag: string | null }>; // throws ConflictError on 412
}
```

- [ ] **Step 5: Write `webdav.ts` (config, url/auth helpers, isConnected, read, testConnection; write stubbed)**

Create `src/sync/providers/webdav.ts`:

```ts
import type { HttpClient, SyncRemote, WritePrecondition } from './types';
import { ConflictError } from './types';

export type WebDavConfig = {
  baseUrl: string;        // e.g. https://dav.jianguoyun.com/dav/
  username: string;
  appPassword: string;
  filePath?: string;      // default: cicada/cicada-sync.json
};

const DEFAULT_FILE_PATH = 'cicada/cicada-sync.json';

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

// Credentials are expected to be ASCII (email + app password); btoa is present
// on every target (Node 20, RN Hermes, browser, Tauri webview).
function basicAuth(username: string, appPassword: string): string {
  return 'Basic ' + btoa(`${username}:${appPassword}`);
}

function ok(status: number): boolean {
  return status >= 200 && status < 300;
}

export function createWebDavRemote(config: WebDavConfig, http: HttpClient): SyncRemote {
  const filePath = config.filePath ?? DEFAULT_FILE_PATH;
  const fileUrl = joinUrl(config.baseUrl, filePath);
  const authHeaders = (): Record<string, string> => ({
    Authorization: basicAuth(config.username, config.appPassword),
  });

  return {
    isConnected(): boolean {
      return Boolean(config.baseUrl && config.username && config.appPassword);
    },

    async testConnection(): Promise<void> {
      const res = await http(config.baseUrl, {
        method: 'PROPFIND',
        headers: { ...authHeaders(), Depth: '0' },
      });
      if (res.status === 401) {
        throw new Error('WebDAV authentication failed (401) — check the account and app password');
      }
      if (!ok(res.status) && res.status !== 207) {
        throw new Error(`WebDAV test connection failed (HTTP ${res.status})`);
      }
    },

    async read(): Promise<{ content: string; etag: string | null } | null> {
      const res = await http(fileUrl, { method: 'GET', headers: authHeaders() });
      if (res.status === 404) return null;
      if (!ok(res.status)) {
        throw new Error(`WebDAV read failed (HTTP ${res.status})`);
      }
      return { content: await res.text(), etag: res.headers.get('ETag') };
    },

    async write(_content: string, _pre: WritePrecondition): Promise<{ etag: string | null }> {
      // Implemented in Task 2.
      throw new ConflictError('write() not implemented yet');
    },
  };
}
```

> The `write` body is a deliberate stub for Task 2 (it throws so an accidental call is loud). `ConflictError` is imported now so the import is in place; Task 2 uses it for the real 412 path.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — all 8 `webdav.test.ts` tests plus earlier suites.

- [ ] **Step 7: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors (only pre-existing lint issues).

- [ ] **Step 8: Commit**

```bash
git add package.json src/sync/providers/types.ts src/sync/providers/webdav.ts src/sync/providers/webdav.test.ts
git commit -m "feat(sync): SyncRemote types + WebDAV read/testConnection (injected HttpClient)"
```

---

### Task 2: WebDAV write — MKCOL, preconditions, 412

**Files:**
- Modify: `src/sync/providers/webdav.ts` (implement `write`, add a private `ensureFolder`)
- Modify: `src/sync/providers/webdav.test.ts` (append write tests)

**Interfaces:**
- Consumes: everything from Task 1 (`HttpClient`, `WritePrecondition`, `ConflictError`, the `createWebDavRemote` closure helpers).
- Produces: completes `SyncRemote.write`.

- [ ] **Step 1: Write the failing tests (append to `webdav.test.ts`)**

Append to `src/sync/providers/webdav.test.ts`:

```ts
test('write(none) PUTs the file with no precondition header', async () => {
  const { client, calls } = makeMock(() => ({ status: 200, headers: { ETag: '"v2"' } }));
  const remote = createWebDavRemote(config, client);
  const res = await remote.write('{"k":2}', { kind: 'none' });

  const put = calls.find((c) => c.method === 'PUT')!;
  assert.equal(put.url, 'https://dav.jianguoyun.com/dav/cicada/cicada-sync.json');
  assert.equal(put.body, '{"k":2}');
  assert.equal(put.headers['Content-Type'], 'application/json');
  assert.equal(put.headers['If-Match'], undefined);
  assert.equal(put.headers['If-None-Match'], undefined);
  assert.deepEqual(res, { etag: '"v2"' });
});

test('write(ifMatch) sends If-Match with the etag', async () => {
  const { client, calls } = makeMock(() => ({ status: 204, headers: { ETag: '"v3"' } }));
  const remote = createWebDavRemote(config, client);
  const res = await remote.write('{}', { kind: 'ifMatch', etag: '"v2"' });
  const put = calls.find((c) => c.method === 'PUT')!;
  assert.equal(put.headers['If-Match'], '"v2"');
  assert.deepEqual(res, { etag: '"v3"' });
});

test('write(ifNoneMatch) MKCOLs the folder first, then PUTs with If-None-Match: *', async () => {
  const { client, calls } = makeMock((r) => {
    if (r.method === 'MKCOL') return { status: 201 };
    return { status: 201, headers: { ETag: '"v1"' } };
  });
  const remote = createWebDavRemote(config, client);
  const res = await remote.write('{}', { kind: 'ifNoneMatch' });

  assert.equal(calls[0].method, 'MKCOL');
  assert.equal(calls[0].url, 'https://dav.jianguoyun.com/dav/cicada/'); // parent folder of the file
  const put = calls.find((c) => c.method === 'PUT')!;
  assert.equal(put.headers['If-None-Match'], '*');
  assert.deepEqual(res, { etag: '"v1"' });
});

test('write(ifNoneMatch) tolerates MKCOL 405 (folder already exists)', async () => {
  const { client } = makeMock((r) => {
    if (r.method === 'MKCOL') return { status: 405 };
    return { status: 201, headers: { ETag: '"v1"' } };
  });
  const remote = createWebDavRemote(config, client);
  const res = await remote.write('{}', { kind: 'ifNoneMatch' });
  assert.deepEqual(res, { etag: '"v1"' });
});

test('write throws ConflictError on HTTP 412', async () => {
  const { client } = makeMock(() => ({ status: 412 }));
  const remote = createWebDavRemote(config, client);
  await assert.rejects(() => remote.write('{}', { kind: 'ifMatch', etag: '"old"' }), ConflictError);
});

test('write returns etag:null when the PUT response has no ETag', async () => {
  const { client } = makeMock(() => ({ status: 200 }));
  const remote = createWebDavRemote(config, client);
  assert.deepEqual(await remote.write('{}', { kind: 'none' }), { etag: null });
});

test('write throws on 401', async () => {
  const { client } = makeMock(() => ({ status: 401 }));
  const remote = createWebDavRemote(config, client);
  await assert.rejects(() => remote.write('{}', { kind: 'none' }), /401|authentication/i);
});
```

Add the `ConflictError` import to the test file's top import line:

```ts
import { ConflictError } from './types';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — the write tests fail (the stub throws `ConflictError('write() not implemented yet')` or wrong behavior).

- [ ] **Step 3: Implement `write` + `ensureFolder` in `webdav.ts`**

In `src/sync/providers/webdav.ts`, add a folder-path helper near `joinUrl` (top-level):

```ts
// The parent collection URL of the sync file (with a trailing slash), e.g.
// ".../dav/cicada/cicada-sync.json" -> ".../dav/cicada/".
function folderUrl(fileUrl: string): string {
  const i = fileUrl.lastIndexOf('/');
  return fileUrl.slice(0, i + 1);
}
```

Then replace the stub `write` in the returned object with:

```ts
    async write(content: string, pre: WritePrecondition): Promise<{ etag: string | null }> {
      if (pre.kind === 'ifNoneMatch') {
        // Create-only: make sure the parent folder exists first. MKCOL is
        // idempotent for us — 201 (created) and 405 (already exists) both pass;
        // other failures surface on the PUT below.
        await http(folderUrl(fileUrl), { method: 'MKCOL', headers: authHeaders() });
      }

      const headers: Record<string, string> = {
        ...authHeaders(),
        'Content-Type': 'application/json',
      };
      if (pre.kind === 'ifMatch') headers['If-Match'] = pre.etag;
      else if (pre.kind === 'ifNoneMatch') headers['If-None-Match'] = '*';

      const res = await http(fileUrl, { method: 'PUT', headers, body: content });
      if (res.status === 412) {
        throw new ConflictError();
      }
      if (res.status === 401) {
        throw new Error('WebDAV authentication failed (401) — check the account and app password');
      }
      if (!ok(res.status)) {
        throw new Error(`WebDAV write failed (HTTP ${res.status})`);
      }
      return { etag: res.headers.get('ETag') };
    },
```

(Remove the old stub `write` body and its `not implemented yet` message.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all write tests plus earlier suites.

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors (only pre-existing lint issues).

- [ ] **Step 6: Commit**

```bash
git add src/sync/providers/webdav.ts src/sync/providers/webdav.test.ts
git commit -m "feat(sync): WebDAV write with MKCOL + If-Match/If-None-Match + 412 ConflictError"
```

---

### Task 3: `isSyncAvailable()` platform gate

**Files:**
- Create: `src/sync/available.ts`

**Interfaces:**
- Consumes: `Platform` from `react-native`.
- Produces: `isSyncAvailable(): boolean`.

This is the one platform shim in this plan: it imports `react-native`, so it is **not** node-tested (RN can't load under `node:test`); it is verified by `tsc` + `lint`. Sync is available on native (iOS/Android) and on Tauri desktop, but NOT in a plain browser/PWA (where WebDAV is blocked by CORS — see spec §1).

- [ ] **Step 1: Create `available.ts`**

Create `src/sync/available.ts`:

```ts
import { Platform } from 'react-native';

// Cloud sync targets native (iOS/Android) and Tauri desktop. A plain browser /
// PWA cannot reach a WebDAV server (CORS), so sync is hidden there and the app
// stays local-only. Tauri is detected the same way database.web.ts does it.
export function isSyncAvailable(): boolean {
  if (Platform.OS !== 'web') return true;
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors (only pre-existing lint issues). `npm test` is unchanged (this file is not node-tested) — run it to confirm the suite still passes:

Run: `npm test`
Expected: PASS — same suite as after Task 2 (no new tests; this confirms nothing regressed).

- [ ] **Step 3: Commit**

```bash
git add src/sync/available.ts
git commit -m "feat(sync): isSyncAvailable() — native + Tauri desktop only"
```

---

## What this plan does NOT cover (Phase 3 Part 2 + Phase 4)

- **`http.ts` / `http.web.ts`** — the real platform `HttpClient`: native `fetch`; web build branches on `__TAURI_INTERNALS__` to `@tauri-apps/plugin-http` (Tauri desktop, bypasses webview CORS) vs unavailable (plain browser). Needs the Tauri plugin + a `src-tauri/capabilities` HTTP grant (`https://**/*` + `http://**/*`).
- **`credentials.ts` / `credentials.web.ts`** — secure storage of `{ baseUrl, username, appPassword }`: native `expo-secure-store`; Tauri secure-store plugin.
- **New dependencies** — `expo-secure-store`, `@tauri-apps/plugin-http`, a Tauri secure-storage plugin, plus the Rust-side plugin init and capability grants. (Native deps; verified by dev build, not node tests.)
- **`sync.ts` orchestrator, `hlc.receive()`, `SyncContext`, Settings "Cloud Sync" UI, triggers** — Phase 4.
- **Carried-over Phase-2 Minor cleanups** (reconcile unused `updated_at` SELECT field, etc.) — fold into a Phase 4 polish pass.

## Self-review notes

- **Spec coverage (WebDAV design §4):** `SyncRemote`/`WritePrecondition`/`ConflictError`/`HttpClient` → Task 1 (`types.ts`); `createWebDavRemote` read + testConnection (GET 404→null, ETag capture, PROPFIND Depth:0, 401) → Task 1; write (MKCOL idempotent, If-Match/If-None-Match, 412→ConflictError, etag:null when absent) → Task 2; `isSyncAvailable` (§3 platform gate) → Task 3. The real HttpClient/credentials/deps (§3, §9) are explicitly Part 2.
- **Type consistency:** `createWebDavRemote(config, http)` returns `SyncRemote`; `read`/`write`/`testConnection`/`isConnected` signatures match `types.ts` exactly. `HttpResponse.headers.get` is the only header API used (case-insensitive in both real clients; the mock lowercases keys to match). `WritePrecondition` kinds (`ifMatch`/`ifNoneMatch`/`none`) are handled exhaustively in `write`.
- **Purity:** `types.ts` + `webdav.ts` import nothing platform-specific (only the injected `HttpClient` + global `btoa`), so they are node-unit-tested. `available.ts` is the sole RN-importing file and is tsc/lint-verified only.
- **No placeholders; every code step carries complete code.** The Task-1 `write` stub is explicitly replaced in Task 2.
</content>
