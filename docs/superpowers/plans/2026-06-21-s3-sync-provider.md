# S3-Compatible Sync Provider — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a generic S3-compatible `SyncRemote` provider (Cloudflare R2 / AWS S3 / Backblaze B2 / MinIO) as a second backend alongside WebDAV — native + Tauri desktop only — with a pure-JS SigV4 signer, wired through credentials/remote/Settings.

**Architecture:** A pure `sigv4.ts` signer (`@noble/hashes`, no `crypto.subtle` → Hermes/web/Tauri/node) and a `s3.ts` provider implement the existing `SyncRemote` interface; the orchestrator/merge/apply are untouched. A tagged-union config (`StoredRemoteConfig`) + a `buildRemote` dispatcher let credentials/remote/Settings carry which provider. WebDAV is retained.

**Tech Stack:** Expo SDK 54 / RN 0.81, `@noble/hashes` v2 (new runtime dep, pure-JS), node:test + tsx (+ better-sqlite3 already present, unused here).

## Global Constraints

- **Targets: iOS, Android, Tauri desktop only** (mirror WebDAV). Plain browser/PWA stays local — do NOT touch `isSyncAvailable()` or add web sync.
- **Auth: AWS SigV4**, pure-JS via `@noble/hashes` — **never** `crypto.subtle` (RN Hermes lacks it).
- **Generic S3-compatible, path-style** addressing: URL = `{endpoint}/{bucket}/{objectKey}`.
- **No encryption** — the `enc` envelope stays reserved; do not touch `document.ts`/`sync.ts` encryption gate.
- **Orchestrator unchanged** — S3 is invisible to `sync.ts`/`merge.ts`/`apply.ts`/`document.ts`. The existing **78 tests stay green**; new tests add to that count.
- **`@noble/hashes` v2.2.0 import paths require the `.js` suffix**: `@noble/hashes/sha2.js` (sha256), `@noble/hashes/hmac.js` (hmac), `@noble/hashes/utils.js` (bytesToHex, utf8ToBytes). Verified in this worktree.
- **Lint baseline: 1 problem** (0 errors, 1 warning — the pre-existing `snapshot-repo` `Array<T>`). Introduce NO new errors/warnings. **tsc: 0 errors.**
- **Secrets (accessKeyId/secretAccessKey/appPassword) live ONLY in secure storage** — never in `sync_state`, the synced document, or logs.
- **Back-compat:** an existing stored credential blob with no `provider` field is a legacy WebDAV config.

---

### Task 1: SigV4 signer (`providers/sigv4.ts`)

**Files:**
- Create: `src/sync/providers/sigv4.ts`
- Test: `src/sync/providers/sigv4.test.ts`
- Modify: `package.json` (add `@noble/hashes`)

**Interfaces:**
- Produces: `type SignInput`, `function signRequestV4(input: SignInput): Record<string, string>` (returns `Authorization`, `x-amz-date`, `x-amz-content-sha256` to merge into the request).

- [ ] **Step 1: Install the dependency**

```bash
npm install @noble/hashes@^2
```
(Already present in this worktree from plan prep — confirm `package.json` lists it under `dependencies`; if not, run the install.)

- [ ] **Step 2: Write the failing test**

Create `src/sync/providers/sigv4.test.ts`. The expected `Authorization`/hash are a **known-answer computed independently with Node's built-in `crypto`** for these exact inputs — the `@noble`-based signer must reproduce them.

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signRequestV4 } from './sigv4';

test('signRequestV4 reproduces the node-crypto reference (PUT with If-Match)', () => {
  const out = signRequestV4({
    method: 'PUT',
    url: 'https://s3.us-east-1.amazonaws.com/my-bucket/cicada/cicada-sync.json',
    headers: { 'If-Match': '"v1"' },
    body: '{"hello":"world"}',
    region: 'us-east-1',
    service: 's3',
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    amzDate: '20250101T000000Z',
  });
  assert.equal(
    out['x-amz-content-sha256'],
    '93a23971a914e5eacbf0a8d25154cda309c3c1c72fbb9914d47c60f3cb681588'
  );
  assert.equal(out['x-amz-date'], '20250101T000000Z');
  assert.equal(
    out.Authorization,
    'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20250101/us-east-1/s3/aws4_request, ' +
      'SignedHeaders=host;if-match;x-amz-content-sha256;x-amz-date, ' +
      'Signature=6f10faf5523787d0d46a108c2e37bae313896ba4a7a249740c117c2561173769'
  );
});

test('signRequestV4 hashes an empty GET body to the well-known empty-SHA256', () => {
  const out = signRequestV4({
    method: 'GET',
    url: 'https://s3.us-east-1.amazonaws.com/my-bucket/cicada/cicada-sync.json',
    headers: {},
    body: '',
    region: 'us-east-1',
    service: 's3',
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    amzDate: '20250101T000000Z',
  });
  assert.equal(
    out['x-amz-content-sha256'],
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  );
  // GET signs only host;x-amz-content-sha256;x-amz-date
  assert.match(out.Authorization, /SignedHeaders=host;x-amz-content-sha256;x-amz-date,/);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `./sigv4` does not exist.

- [ ] **Step 4: Implement `src/sync/providers/sigv4.ts`**

```ts
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

const sha256hex = (s: string): string => bytesToHex(sha256(utf8ToBytes(s)));
const hmacBytes = (key: Uint8Array, s: string): Uint8Array => hmac(sha256, key, utf8ToBytes(s));

export type SignInput = {
  method: string;                    // GET | PUT
  url: string;                       // full path-style object URL
  headers: Record<string, string>;  // caller headers (e.g. If-Match); host/x-amz-* are added here
  body: string;                      // "" for GET
  region: string;
  service: string;                   // "s3"
  accessKeyId: string;
  secretAccessKey: string;
  amzDate: string;                   // "YYYYMMDDTHHMMSSZ" (caller supplies → deterministic/testable)
};

// AWS rules: encode each path segment, keep "/". encodeURIComponent leaves
// !*'() — AWS wants those encoded too.
function encodeS3Path(pathname: string): string {
  return pathname
    .split('/')
    .map((seg) =>
      encodeURIComponent(seg).replace(
        /[!*'()]/g,
        (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
      )
    )
    .join('/');
}

/** Compute the SigV4 headers to MERGE into a request. */
export function signRequestV4(input: SignInput): Record<string, string> {
  const { method, url, headers, body, region, service, accessKeyId, secretAccessKey, amzDate } = input;
  const u = new URL(url);
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256hex(body);

  // Headers to sign: caller headers (lower-cased) + host + x-amz-content-sha256 + x-amz-date.
  const signing: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) signing[k.toLowerCase()] = v;
  signing['host'] = u.host;
  signing['x-amz-content-sha256'] = payloadHash;
  signing['x-amz-date'] = amzDate;

  const names = Object.keys(signing).sort();
  const canonicalHeaders = names.map((n) => `${n}:${signing[n].trim()}\n`).join('');
  const signedHeaders = names.join(';');

  const canonicalRequest = [
    method,
    encodeS3Path(u.pathname),
    '', // no query params
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256hex(canonicalRequest),
  ].join('\n');

  let key = hmacBytes(utf8ToBytes('AWS4' + secretAccessKey), date);
  key = hmacBytes(key, region);
  key = hmacBytes(key, service);
  key = hmacBytes(key, 'aws4_request');
  const signature = bytesToHex(hmacBytes(key, stringToSign));

  return {
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
  };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc 0 errors; lint baseline (1 warning); both new tests pass (80 total: 78 + 2).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/sync/providers/sigv4.ts src/sync/providers/sigv4.test.ts
git commit -m "feat(sync): pure-JS AWS SigV4 signer (@noble/hashes, Hermes-safe)"
```

---

### Task 2: S3 provider (`providers/s3.ts`)

**Files:**
- Create: `src/sync/providers/s3.ts`
- Test: `src/sync/providers/s3.test.ts`

**Interfaces:**
- Consumes: `signRequestV4` (sigv4.ts); `SyncRemote`/`WritePrecondition`/`ConflictError`/`AuthError`/`HttpClient` (types.ts).
- Produces: `type S3Config`, `function createS3Remote(config: S3Config, http: HttpClient): SyncRemote`.

- [ ] **Step 1: Write the failing test**

Create `src/sync/providers/s3.test.ts` (reuse the mock-HttpClient style from `webdav.test.ts`):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createS3Remote } from './s3';
import type { HttpClient, HttpResponse } from './types';
import { ConflictError, AuthError } from './types';

type Recorded = { url: string; method: string; headers: Record<string, string>; body?: string };

function makeMock(
  responder: (r: Recorded) => { status: number; headers?: Record<string, string>; body?: string }
): { client: HttpClient; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const client: HttpClient = async (url, init) => {
    const rec: Recorded = { url, method: init.method, headers: init.headers, body: init.body };
    calls.push(rec);
    const res = responder(rec);
    const lower: Record<string, string> = {};
    for (const k of Object.keys(res.headers ?? {})) lower[k.toLowerCase()] = (res.headers as any)[k];
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
  endpoint: 'https://s3.us-east-1.amazonaws.com',
  region: 'us-east-1',
  bucket: 'my-bucket',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
};

test('read() GETs the path-style object URL with a signed Authorization header', async () => {
  const { client, calls } = makeMock(() => ({ status: 200, headers: { ETag: '"v1"' }, body: '{"k":1}' }));
  const result = await createS3Remote(config, client).read();
  assert.deepEqual(result, { content: '{"k":1}', etag: '"v1"' });
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].url, 'https://s3.us-east-1.amazonaws.com/my-bucket/cicada/cicada-sync.json');
  assert.match(calls[0].headers.Authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//);
  assert.ok(calls[0].headers['x-amz-date']);
});

test('read() returns null on 404', async () => {
  const { client } = makeMock(() => ({ status: 404 }));
  assert.equal(await createS3Remote(config, client).read(), null);
});

test('read() throws AuthError on 403', async () => {
  const { client } = makeMock(() => ({ status: 403 }));
  await assert.rejects(() => createS3Remote(config, client).read(), (e) => e instanceof AuthError);
});

test('write(ifMatch) PUTs with If-Match and returns the new etag', async () => {
  const { client, calls } = makeMock(() => ({ status: 200, headers: { ETag: '"v2"' } }));
  const out = await createS3Remote(config, client).write('{"k":2}', { kind: 'ifMatch', etag: '"v1"' });
  assert.deepEqual(out, { etag: '"v2"' });
  assert.equal(calls[0].method, 'PUT');
  assert.equal(calls[0].body, '{"k":2}');
  assert.equal(calls[0].headers['If-Match'], '"v1"');
});

test('write(ifNoneMatch) sends If-None-Match: *', async () => {
  const { client, calls } = makeMock(() => ({ status: 200 }));
  await createS3Remote(config, client).write('{}', { kind: 'ifNoneMatch' });
  assert.equal(calls[0].headers['If-None-Match'], '*');
});

test('write throws ConflictError on 412', async () => {
  const { client } = makeMock(() => ({ status: 412 }));
  await assert.rejects(
    () => createS3Remote(config, client).write('{}', { kind: 'ifMatch', etag: '"stale"' }),
    (e) => e instanceof ConflictError
  );
});

test('testConnection treats 404 as success (connected, not seeded)', async () => {
  const { client } = makeMock(() => ({ status: 404 }));
  await createS3Remote(config, client).testConnection(); // resolves
});

test('testConnection throws AuthError on 403', async () => {
  const { client } = makeMock(() => ({ status: 403 }));
  await assert.rejects(() => createS3Remote(config, client).testConnection(), (e) => e instanceof AuthError);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `./s3` does not exist.

- [ ] **Step 3: Implement `src/sync/providers/s3.ts`**

```ts
import { signRequestV4 } from './sigv4';
import {
  ConflictError,
  AuthError,
  type HttpClient,
  type SyncRemote,
  type WritePrecondition,
} from './types';

export type S3Config = {
  endpoint: string;        // e.g. https://<acct>.r2.cloudflarestorage.com  or  https://s3.<region>.amazonaws.com
  region: string;          // R2: "auto"
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  objectKey?: string;      // default "cicada/cicada-sync.json"
};

const DEFAULT_KEY = 'cicada/cicada-sync.json';

function objectUrl(config: S3Config): string {
  const base = config.endpoint.replace(/\/+$/, '');
  const key = (config.objectKey ?? DEFAULT_KEY).replace(/^\/+/, '');
  return `${base}/${config.bucket}/${key}`;
}

// "YYYYMMDDTHHMMSSZ"
function amzNow(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

const ok = (status: number): boolean => status >= 200 && status < 300;

export function createS3Remote(config: S3Config, http: HttpClient): SyncRemote {
  const url = objectUrl(config);

  async function send(method: string, extraHeaders: Record<string, string>, body: string) {
    const signed = signRequestV4({
      method,
      url,
      headers: extraHeaders,
      body,
      region: config.region,
      service: 's3',
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      amzDate: amzNow(),
    });
    return http(url, {
      method,
      headers: { ...extraHeaders, ...signed },
      body: method === 'GET' ? undefined : body,
    });
  }

  return {
    isConnected(): boolean {
      return Boolean(
        config.endpoint && config.bucket && config.accessKeyId && config.secretAccessKey
      );
    },

    async testConnection(): Promise<void> {
      const res = await send('GET', {}, '');
      if (res.status === 401 || res.status === 403) throw new AuthError();
      if (res.status !== 404 && !ok(res.status)) {
        throw new Error(`S3 test connection failed (HTTP ${res.status})`);
      }
    },

    async read(): Promise<{ content: string; etag: string | null } | null> {
      const res = await send('GET', {}, '');
      if (res.status === 404) return null;
      if (res.status === 401 || res.status === 403) throw new AuthError();
      if (!ok(res.status)) throw new Error(`S3 read failed (HTTP ${res.status})`);
      return { content: await res.text(), etag: res.headers.get('ETag') };
    },

    async write(content: string, pre: WritePrecondition): Promise<{ etag: string | null }> {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (pre.kind === 'ifMatch') headers['If-Match'] = pre.etag;
      else if (pre.kind === 'ifNoneMatch') headers['If-None-Match'] = '*';

      const res = await send('PUT', headers, content);
      if (res.status === 412) throw new ConflictError();
      if (res.status === 401 || res.status === 403) throw new AuthError();
      if (!ok(res.status)) throw new Error(`S3 write failed (HTTP ${res.status})`);
      return { etag: res.headers.get('ETag') };
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc 0 errors; lint baseline; 8 new tests pass (88 total: 80 + 8).

- [ ] **Step 5: Commit**

```bash
git add src/sync/providers/s3.ts src/sync/providers/s3.test.ts
git commit -m "feat(sync): S3-compatible SyncRemote provider (read/write/testConnection over SigV4)"
```

---

### Task 3: Provider config union + dispatcher, wire credentials/remote

**Files:**
- Create: `src/sync/remote-config.ts`
- Test: `src/sync/remote-config.test.ts`
- Modify: `src/sync/credentials.ts`, `src/sync/credentials.web.ts`, `src/sync/remote.ts`

**Interfaces:**
- Consumes: `WebDavConfig` (webdav.ts), `S3Config` (s3.ts), `createWebDavRemote`/`createS3Remote`, `SyncRemote`/`HttpClient` (types.ts).
- Produces:
  - `type StoredRemoteConfig = ({ provider: 'webdav' } & WebDavConfig) | ({ provider: 's3' } & S3Config)`
  - `function normalizeStoredConfig(raw: unknown): StoredRemoteConfig | null` (back-compat: no `provider` + has `baseUrl` → webdav)
  - `function buildRemote(config: StoredRemoteConfig, http: HttpClient): SyncRemote`

- [ ] **Step 1: Write the failing test**

Create `src/sync/remote-config.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStoredConfig, buildRemote } from './remote-config';
import type { HttpClient, HttpResponse } from './providers/types';

function mock(): { client: HttpClient; calls: { url: string; method: string }[] } {
  const calls: { url: string; method: string }[] = [];
  const client: HttpClient = async (url, init) => {
    calls.push({ url, method: init.method });
    const r: HttpResponse = { status: 404, headers: { get: () => null }, text: async () => '' };
    return r;
  };
  return { client, calls };
}

test('normalize: s3-tagged config passes through', () => {
  const c = { provider: 's3', endpoint: 'https://e', region: 'auto', bucket: 'b', accessKeyId: 'k', secretAccessKey: 's' };
  assert.deepEqual(normalizeStoredConfig(c), c);
});

test('normalize: webdav-tagged config passes through', () => {
  const c = { provider: 'webdav', baseUrl: 'https://d/', username: 'u', appPassword: 'p' };
  assert.deepEqual(normalizeStoredConfig(c), c);
});

test('normalize: legacy config (no provider, has baseUrl) becomes webdav', () => {
  const legacy = { baseUrl: 'https://d/', username: 'u', appPassword: 'p' };
  assert.deepEqual(normalizeStoredConfig(legacy), { provider: 'webdav', ...legacy });
});

test('normalize: null / garbage -> null', () => {
  assert.equal(normalizeStoredConfig(null), null);
  assert.equal(normalizeStoredConfig({ junk: 1 }), null);
});

test('buildRemote dispatches s3 config to the S3 provider (path-style URL)', async () => {
  const { client, calls } = mock();
  const remote = buildRemote(
    { provider: 's3', endpoint: 'https://s3.us-east-1.amazonaws.com', region: 'us-east-1', bucket: 'b', accessKeyId: 'k', secretAccessKey: 's' },
    client
  );
  await remote.read();
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].url, 'https://s3.us-east-1.amazonaws.com/b/cicada/cicada-sync.json');
});

test('buildRemote dispatches webdav config to the WebDAV provider', async () => {
  const { client, calls } = mock();
  const remote = buildRemote(
    { provider: 'webdav', baseUrl: 'https://dav.example.com/', username: 'u', appPassword: 'p' },
    client
  );
  await remote.read();
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].url, 'https://dav.example.com/cicada/cicada-sync.json');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `./remote-config` does not exist.

- [ ] **Step 3: Implement `src/sync/remote-config.ts`**

```ts
import { createWebDavRemote, type WebDavConfig } from './providers/webdav';
import { createS3Remote, type S3Config } from './providers/s3';
import type { SyncRemote, HttpClient } from './providers/types';

export type StoredRemoteConfig =
  | ({ provider: 'webdav' } & WebDavConfig)
  | ({ provider: 's3' } & S3Config);

/** Parse a stored credential blob. Back-compat: a value with no `provider`
 *  field but a `baseUrl` is a legacy (pre-S3) WebDAV config. */
export function normalizeStoredConfig(raw: unknown): StoredRemoteConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.provider === 's3' || o.provider === 'webdav') return o as StoredRemoteConfig;
  if (typeof o.baseUrl === 'string') {
    return { provider: 'webdav', ...(o as unknown as WebDavConfig) };
  }
  return null;
}

/** Build a SyncRemote from a tagged config + an injected HttpClient. */
export function buildRemote(config: StoredRemoteConfig, http: HttpClient): SyncRemote {
  return config.provider === 's3'
    ? createS3Remote(config, http)
    : createWebDavRemote(config, http);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsc --noEmit && npm test`
Expected: tsc 0 errors; 6 new tests pass (94 total: 88 + 6).

- [ ] **Step 5: Wire `credentials.ts` (native)**

Replace the `WebDavConfig` type usage with `StoredRemoteConfig` and normalize on load:

```ts
import * as SecureStore from 'expo-secure-store';
import { normalizeStoredConfig, type StoredRemoteConfig } from './remote-config';

const KEY = 'cicada_webdav_credentials';

export async function loadCredentials(): Promise<StoredRemoteConfig | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    return normalizeStoredConfig(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function saveCredentials(config: StoredRemoteConfig): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(config));
}

export async function clearCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
```

- [ ] **Step 6: Wire `credentials.web.ts` (Tauri)**

Same generalization — store/load `StoredRemoteConfig`, normalize on load:

```ts
import { normalizeStoredConfig, type StoredRemoteConfig } from './remote-config';

const STORE_FILE = 'cicada-credentials.json';
const KEY = 'webdav';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function openStore() {
  const { load } = await import('@tauri-apps/plugin-store');
  return load(STORE_FILE, { defaults: {}, autoSave: true });
}

export async function loadCredentials(): Promise<StoredRemoteConfig | null> {
  if (!isTauri()) return null;
  const store = await openStore();
  const val = await store.get<unknown>(KEY);
  return normalizeStoredConfig(val ?? null);
}

export async function saveCredentials(config: StoredRemoteConfig): Promise<void> {
  if (!isTauri()) return;
  const store = await openStore();
  await store.set(KEY, config);
  await store.save();
}

export async function clearCredentials(): Promise<void> {
  if (!isTauri()) return;
  const store = await openStore();
  await store.delete(KEY);
  await store.save();
}
```

(Keep the `KEY = 'webdav'` storage key unchanged so existing desktop credentials still load — `normalizeStoredConfig` upgrades the legacy shape.)

- [ ] **Step 7: Wire `remote.ts`**

```ts
import { httpClient } from './http';
import { buildRemote, type StoredRemoteConfig } from './remote-config';
import type { SyncRemote } from './providers/types';
import { loadCredentials } from './credentials';

export function createConfiguredRemote(config: StoredRemoteConfig): SyncRemote {
  return buildRemote(config, httpClient);
}

export async function loadRemote(): Promise<SyncRemote | null> {
  const config = await loadCredentials();
  if (!config) return null;
  return createConfiguredRemote(config);
}
```

- [ ] **Step 8: Verify the wiring (tsc + lint + tests)**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc 0 errors (the union now flows through credentials/remote — if `SyncContext`/`CloudSyncSection` still type `WebDavConfig` this will surface there; Task 4 fixes those, but tsc must be clean BEFORE moving on — if Task 4's files error here, that's expected and Task 4 resolves it. **If tsc errors only in `SyncContext.tsx`/`CloudSyncSection.tsx`, note it and proceed to Task 4; otherwise fix here.**); lint baseline; 94 tests green.

> The `credentials.*`/`remote.ts` files are RN/Tauri-bound (not node-tested); their correctness is tsc + the Task-4 manual round-trip. The tested logic (normalize + dispatch) lives in `remote-config.ts`.

- [ ] **Step 9: Commit**

```bash
git add src/sync/remote-config.ts src/sync/remote-config.test.ts src/sync/credentials.ts src/sync/credentials.web.ts src/sync/remote.ts
git commit -m "feat(sync): provider config union + buildRemote dispatcher; credentials/remote carry provider"
```

---

### Task 4: Settings provider selector + SyncContext widening + i18n

**Files:**
- Modify: `src/hooks/SyncContext.tsx` (widen `WebDavConfig` → `StoredRemoteConfig`)
- Modify: `src/components/CloudSyncSection.tsx` (provider selector + S3 fields)
- Modify: `src/i18n/locales/en.json`, `src/i18n/locales/zh.json` (S3 field strings)

**Interfaces:**
- Consumes: `StoredRemoteConfig` (remote-config.ts), `S3Config` (s3.ts), `useSync` (SyncContext), `confirmAsync`/`notify`, theme tokens, `useTranslation`.

This task is RN UI — **not node-testable**. Gate: `npx tsc --noEmit` + `npm run lint` + `npm test` still 94 (no new tests), plus the manual round-trip below.

- [ ] **Step 1: Add i18n keys**

In `src/i18n/locales/en.json`, inside the `settings` object, add:

```json
    "cloudProvider": "Provider",
    "cloudProviderWebdav": "WebDAV",
    "cloudProviderS3": "S3 / R2",
    "cloudEndpoint": "Endpoint URL",
    "cloudEndpointHelp": "e.g. https://<account>.r2.cloudflarestorage.com (R2) or https://s3.<region>.amazonaws.com",
    "cloudRegion": "Region",
    "cloudRegionHelp": "Cloudflare R2: use \"auto\". AWS: the bucket's region.",
    "cloudBucket": "Bucket",
    "cloudAccessKeyId": "Access key ID",
    "cloudSecretAccessKey": "Secret access key"
```

In `src/i18n/locales/zh.json`, inside `settings`, add the same keys translated:

```json
    "cloudProvider": "服务类型",
    "cloudProviderWebdav": "WebDAV",
    "cloudProviderS3": "S3 / R2",
    "cloudEndpoint": "Endpoint 地址",
    "cloudEndpointHelp": "如 https://<账户>.r2.cloudflarestorage.com(R2)或 https://s3.<区域>.amazonaws.com",
    "cloudRegion": "区域(Region)",
    "cloudRegionHelp": "Cloudflare R2 填 \"auto\";AWS 填 bucket 所在区域。",
    "cloudBucket": "存储桶(Bucket)",
    "cloudAccessKeyId": "Access Key ID",
    "cloudSecretAccessKey": "Secret Access Key"
```

Validate: `node -e "require('./src/i18n/locales/en.json'); require('./src/i18n/locales/zh.json'); console.log('ok')"`.

- [ ] **Step 2: Widen `SyncContext.tsx`**

Change the credential type from `WebDavConfig` to `StoredRemoteConfig` everywhere in `src/hooks/SyncContext.tsx`:
- Replace `import { type WebDavConfig } from '../sync/providers/webdav';` with `import { type StoredRemoteConfig } from '../sync/remote-config';`
- Change the `testConnection`/`connect` signatures in the `SyncContextValue` type and the implementations from `(config: WebDavConfig)` to `(config: StoredRemoteConfig)`.

No logic changes — `createConfiguredRemote` already accepts `StoredRemoteConfig` after Task 3.

- [ ] **Step 3: Rewrite `CloudSyncSection.tsx` with a provider selector**

The section keeps its WebDAV form and adds an S3 form, switched by a provider chip pair. Build the right `StoredRemoteConfig` on connect/test. Replace the field-state + form body; keep the status row, buttons, and overwrite card. Key shape:

```tsx
import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useSync, type SyncStatus } from '../hooks/SyncContext';
import { loadCredentials } from '../sync/credentials';
import { type StoredRemoteConfig } from '../sync/remote-config';
import { confirmAsync, notify } from '../utils/dialog';
import { colors, shared, spacing } from '../utils/theme';

const DEFAULT_WEBDAV_URL = 'https://dav.jianguoyun.com/dav/';

type Provider = 'webdav' | 's3';

const STATUS_KEY: Record<SyncStatus, string> = {
  idle: '', syncing: 'settings.cloudStatusSyncing', ok: 'settings.cloudStatusOk',
  offline: 'settings.cloudStatusOffline', authError: 'settings.cloudStatusAuthError', error: 'settings.cloudStatusError',
};

export default function CloudSyncSection() {
  const { t } = useTranslation();
  const sync = useSync();
  const [provider, setProvider] = useState<Provider>('webdav');
  // webdav fields
  const [baseUrl, setBaseUrl] = useState(DEFAULT_WEBDAV_URL);
  const [username, setUsername] = useState('');
  const [appPassword, setAppPassword] = useState('');
  // s3 fields
  const [endpoint, setEndpoint] = useState('');
  const [region, setRegion] = useState('auto');
  const [bucket, setBucket] = useState('');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!sync.available) return;
    (async () => {
      const c = await loadCredentials();
      if (!c) return;
      setProvider(c.provider);
      if (c.provider === 'webdav') {
        setBaseUrl(c.baseUrl); setUsername(c.username); setAppPassword(c.appPassword);
      } else {
        setEndpoint(c.endpoint); setRegion(c.region); setBucket(c.bucket);
        setAccessKeyId(c.accessKeyId); setSecretAccessKey(c.secretAccessKey);
      }
    })();
  }, [sync.available, sync.connected]);

  if (!sync.available) return null;

  const buildConfig = (): StoredRemoteConfig =>
    provider === 'webdav'
      ? { provider: 'webdav', baseUrl: baseUrl.trim(), username: username.trim(), appPassword }
      : { provider: 's3', endpoint: endpoint.trim(), region: region.trim(), bucket: bucket.trim(), accessKeyId: accessKeyId.trim(), secretAccessKey };

  const hasFields =
    provider === 'webdav'
      ? Boolean(baseUrl.trim() && username.trim() && appPassword)
      : Boolean(endpoint.trim() && region.trim() && bucket.trim() && accessKeyId.trim() && secretAccessKey);

  const guard = async (fn: () => Promise<void>) => {
    if (!hasFields) { notify(t('common.error'), t('settings.cloudMissingFields')); return; }
    setBusy(true);
    try { await fn(); } catch (e: any) { notify(t('common.error'), e?.message ?? t('settings.cloudStatusError')); } finally { setBusy(false); }
  };
  const onTest = () => guard(async () => { await sync.testConnection(buildConfig()); notify(t('settings.doneTitle'), t('settings.cloudTestOk')); });
  const onConnect = () => guard(async () => { await sync.connect(buildConfig()); });
  const onDisconnect = async () => {
    const okc = await confirmAsync(t('settings.cloudDisconnect'), '', t('settings.cloudDisconnect'), true);
    if (!okc) return; setBusy(true); try { await sync.disconnect(); } finally { setBusy(false); }
  };
  const onOverwrite = async () => {
    const okc = await confirmAsync(t('settings.cloudOverwrite'), t('settings.cloudOverwriteConfirm'), t('settings.cloudOverwrite'), true);
    if (!okc) return; setBusy(true); try { await sync.overwriteCloud(); } finally { setBusy(false); }
  };

  const lastSynced = sync.lastSyncedAt
    ? t('settings.cloudLastSynced', { when: new Date(sync.lastSyncedAt).toLocaleString() })
    : t('settings.cloudNeverSynced');
  const statusKey = STATUS_KEY[sync.status];

  return (
    <>
      <Text style={[shared.sectionTitle, { marginTop: spacing.xl }]}>{t('settings.cloudSync')}</Text>
      <View style={shared.card}>
        <Text style={shared.muted}>{t('settings.cloudSyncHelp')}</Text>

        <Text style={styles.label}>{t('settings.cloudProvider')}</Text>
        <View style={styles.row}>
          {(['webdav', 's3'] as Provider[]).map((p) => (
            <TouchableOpacity key={p} disabled={sync.connected}
              onPress={() => setProvider(p)}
              style={[styles.chip, provider === p && styles.chipActive, sync.connected && { opacity: 0.5 }]}>
              <Text style={[styles.chipText, provider === p && { color: 'white' }]}>
                {t(p === 'webdav' ? 'settings.cloudProviderWebdav' : 'settings.cloudProviderS3')}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {provider === 'webdav' ? (
          <>
            <Field label={t('settings.cloudServerUrl')} value={baseUrl} onChangeText={setBaseUrl} editable={!sync.connected} />
            <Field label={t('settings.cloudAccount')} value={username} onChangeText={setUsername} editable={!sync.connected} keyboardType="email-address" />
            <Field label={t('settings.cloudAppPassword')} value={appPassword} onChangeText={setAppPassword} editable={!sync.connected} secure />
            <Text style={shared.muted}>{t('settings.cloudAppPasswordHelp')}</Text>
          </>
        ) : (
          <>
            <Field label={t('settings.cloudEndpoint')} value={endpoint} onChangeText={setEndpoint} editable={!sync.connected} />
            <Text style={shared.muted}>{t('settings.cloudEndpointHelp')}</Text>
            <Field label={t('settings.cloudRegion')} value={region} onChangeText={setRegion} editable={!sync.connected} />
            <Text style={shared.muted}>{t('settings.cloudRegionHelp')}</Text>
            <Field label={t('settings.cloudBucket')} value={bucket} onChangeText={setBucket} editable={!sync.connected} />
            <Field label={t('settings.cloudAccessKeyId')} value={accessKeyId} onChangeText={setAccessKeyId} editable={!sync.connected} />
            <Field label={t('settings.cloudSecretAccessKey')} value={secretAccessKey} onChangeText={setSecretAccessKey} editable={!sync.connected} secure />
          </>
        )}

        <View style={styles.statusRow}>
          <Text style={[styles.statusText, (sync.status === 'authError' || sync.status === 'error') ? { color: colors.negative } : null]}>
            {sync.connected ? t('settings.cloudConnected') : t('settings.cloudNotConnected')}{statusKey ? ` · ${t(statusKey)}` : ''}
          </Text>
          <Text style={shared.muted}>{lastSynced}</Text>
        </View>

        <View style={styles.buttonRow}>
          {!sync.connected ? (
            <>
              <Btn label={t('settings.cloudTest')} onPress={onTest} disabled={busy} />
              <Btn label={t('settings.cloudConnect')} onPress={onConnect} disabled={busy} primary />
            </>
          ) : (
            <>
              <Btn label={t('settings.cloudSyncNow')} onPress={() => sync.syncNow()} disabled={busy} primary />
              <Btn label={t('settings.cloudDisconnect')} onPress={onDisconnect} disabled={busy} />
            </>
          )}
        </View>
      </View>

      {sync.connected && (
        <TouchableOpacity onPress={onOverwrite} disabled={busy} style={[shared.card, busy && { opacity: 0.5 }]}>
          <Text style={[styles.label, { color: colors.negative, marginTop: 0 }]}>{t('settings.cloudOverwrite')}</Text>
          <Text style={shared.muted}>{t('settings.cloudOverwriteSub')}</Text>
        </TouchableOpacity>
      )}
    </>
  );
}

function Field(props: { label: string; value: string; onChangeText: (s: string) => void; editable?: boolean; secure?: boolean; keyboardType?: 'email-address' }) {
  return (
    <>
      <Text style={styles.label}>{props.label}</Text>
      <TextInput
        style={styles.input}
        value={props.value}
        onChangeText={props.onChangeText}
        editable={props.editable}
        secureTextEntry={props.secure}
        keyboardType={props.keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
      />
    </>
  );
}

function Btn({ label, onPress, disabled, primary }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled} style={[styles.btn, primary && styles.btnPrimary, disabled && { opacity: 0.5 }]}>
      <Text style={[styles.btnText, primary && { color: 'white' }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 14, fontWeight: '600', marginTop: spacing.md, marginBottom: spacing.xs },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: 'white', fontSize: 15 },
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  chip: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: 'white' },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 15, fontWeight: '600', color: colors.muted },
  statusRow: { marginTop: spacing.md },
  statusText: { fontSize: 14, fontWeight: '600' },
  buttonRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  btn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: 'white' },
  btnPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
  btnText: { fontSize: 15, fontWeight: '600', color: colors.muted },
});
```

> This rewrite reuses the existing `settings.cloud*` keys from Phase 4 (`cloudSync`, `cloudSyncHelp`, `cloudServerUrl`, `cloudAccount`, `cloudAppPassword`, `cloudAppPasswordHelp`, `cloudTest`, `cloudConnect`, `cloudDisconnect`, `cloudSyncNow`, `cloudConnected`, `cloudNotConnected`, `cloudLastSynced`, `cloudNeverSynced`, `cloudTestOk`, `cloudStatus*`, `cloudOverwrite*`, `cloudMissingFields`, plus `doneTitle`/`common.error`) — confirm they still exist before relying on them; only the new `cloudProvider`/`cloudEndpoint`/`cloudRegion`/`cloudBucket`/`cloudAccessKeyId`/`cloudSecretAccessKey` keys are added in Step 1.

- [ ] **Step 4: Verify**

Run: `node -e "require('./src/i18n/locales/en.json'); require('./src/i18n/locales/zh.json'); console.log('json ok')" && npx tsc --noEmit && npm run lint && npm test`
Expected: json ok; tsc 0 errors; lint baseline; tests 94 (no new tests this task).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/SyncContext.tsx src/components/CloudSyncSection.tsx src/i18n/locales/en.json src/i18n/locales/zh.json
git commit -m "feat(sync): Settings provider selector (WebDAV | S3) + StoredRemoteConfig wiring"
```

---

## Manual end-to-end verification (developer, after all tasks)

Needs an S3-compatible bucket — Cloudflare R2 (create a bucket + an API token with R2 read/write → access key ID + secret) or a local MinIO.

1. **Desktop (Tauri):** `npm run tauri:dev` → Settings → Cloud Sync → pick **S3 / R2** → fill endpoint/region/bucket/keys → **Test connection** (expect success) → **Connect** (seeds `cicada/cicada-sync.json` in the bucket) → status "up to date".
2. **`If-Match` probe** (records conditional-write behavior for the chosen provider): in the desktop devtools, `read()` to get the etag, then `write(..., { kind:'ifMatch', etag:'"stale"' })` — a provider that honors conditional writes returns **412 → ConflictError**. Note the result (R2/AWS should honor it; the orchestrator self-heals if not).
3. **Convergence:** edit on desktop + a second device both pointing at the same bucket → sync both → confirm identical state, no duplicates.
4. **Back-compat:** an existing WebDAV-connected install still loads + syncs (the stored blob upgrades to `provider:'webdav'`).
5. **Native (dev build):** repeat the S3 connect/round-trip on a phone dev build (SigV4 runs on Hermes via `@noble/hashes`).

## What this plan does NOT cover

- Web/PWA sync (stays local — `isSyncAvailable()` unchanged).
- At-rest encryption (`enc` envelope reserved).
- Virtual-hosted-style addressing, multipart upload, presigned URLs.

## Self-review notes

- **Spec coverage:** SigV4 signer (§3.2) → Task 1; S3 provider operations (§4) → Task 2; config union + dispatch + back-compat (§6.1/6.2) → Task 3; Settings provider selector + SyncContext (§6.3) → Task 4; concurrency unchanged (§5) → no task needed (orchestrator untouched); testing (§8) → KAT signer test (Task 1), mock-http provider tests (Task 2), normalize+dispatch tests (Task 3), manual round-trip (final section).
- **Type consistency:** `SignInput`/`signRequestV4` (Task 1) consumed by `s3.ts` (Task 2); `S3Config`/`createS3Remote` (Task 2) consumed by `remote-config.ts` (Task 3); `StoredRemoteConfig`/`buildRemote`/`normalizeStoredConfig` (Task 3) consumed by `credentials.*`/`remote.ts` (Task 3) and `SyncContext`/`CloudSyncSection` (Task 4). `WebDavConfig` unchanged.
- **Testability honesty:** Tasks 1–3's core (signer, provider, normalize, dispatch) are pure → real node tests with known-answer + mock-http. `credentials.*`/`remote.ts` wiring and the Task-4 UI are RN/Tauri-bound → tsc + lint + the manual round-trip; no fabricated RN unit tests.
- **Known-answer integrity:** the SigV4 expected signature was computed independently with Node's built-in `crypto` (not the `@noble` implementation under test), so the test is a genuine cross-implementation check.
- **No orchestrator/engine change:** S3 is invisible to `sync.ts`/`merge.ts`/`apply.ts`/`document.ts`; the existing 78 tests stay green and rise to 94 with the new ones.
```
