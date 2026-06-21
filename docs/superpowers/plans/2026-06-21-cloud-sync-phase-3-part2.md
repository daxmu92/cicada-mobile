# Cloud Sync — Phase 3 (Part 2): Platform Wiring (HTTP + Credentials) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the tested WebDAV provider (Phase 3 Part 1) to real platforms: a platform-selected `HttpClient` (native `fetch` / Tauri `@tauri-apps/plugin-http`), secure credential storage (`expo-secure-store` / Tauri `@tauri-apps/plugin-store`), the Tauri Rust plugins + capability grants, and a `remote.ts` factory that builds a `SyncRemote` from stored credentials.

**Architecture:** Two Metro `.web.ts` splits (mirroring `database.ts`/`database.web.ts`): `http.ts`/`http.web.ts` and `credentials.ts`/`credentials.web.ts`. Native uses global `fetch` + `expo-secure-store`; the web build branches on `window.__TAURI_INTERNALS__` to lazy-import the Tauri HTTP/store plugins (desktop) or no-op (plain browser, where sync is disabled). `remote.ts` ties config + the platform `HttpClient` into `createWebDavRemote`. The orchestrator and UI remain Phase 4.

**Tech Stack:** Expo SDK 54 / RN 0.81, Tauri 2.11. New deps: `expo-secure-store`, `@tauri-apps/plugin-http`, `@tauri-apps/plugin-store` (JS) + `tauri-plugin-http`, `tauri-plugin-store` (Rust).

## ⚠️ Execution note — this plan is native-integration, not unit-testable

Unlike Phases 1–3.1, **these files are platform shims that cannot run under `node:test`** (they import `react-native` / `expo-secure-store` / Tauri plugins). Per-task automated verification is **`npx tsc --noEmit` + `npm run lint` only**. The real proof is a **dev build + a live 坚果云 round-trip**, which a developer runs on a device/desktop (the sandbox has no Rust toolchain or device). Each task lists those manual steps explicitly. **Recommended execution: inline (not subagent-driven)**, so the developer can run the `cargo` / `tauri:dev` / EAS build verification interactively.

## Global Constraints

- **Node 20+** (`.nvmrc`); install expo packages with `npx expo install` (it pins the SDK-54-correct version), Tauri JS plugins with `npm install`, Rust plugins by editing `Cargo.toml`.
- **Platform split via Metro `.web.ts` resolution** (mirror `src/db/database.ts` / `database.web.ts`). Tauri is detected with `typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window` — the exact probe `database.web.ts` and `available.ts` already use.
- **The `.web.ts` files must lazy-`import()` the Tauri plugins**, so a plain browser/PWA bundle never loads them (consistent with `database.web.ts` lazy-loading `tauri-sqlite`).
- **The Tauri HTTP capability scope must allow user-configured WebDAV hosts:** `https://**` and `http://**` (the server URL is entered by the user at runtime, so the grant can't be a fixed host).
- **Credentials (incl. the app password) live ONLY in secure storage** (`expo-secure-store` on native; Tauri store on desktop) — never in the synced `sync_state` table, never in git, never logged.
- **`HttpClient`/`SyncRemote`/`WebDavConfig` are the Part-1 contracts** — this plan only supplies real implementations; it does not change `providers/types.ts` or `providers/webdav.ts`.
- **Automated verification per task:** `npx tsc --noEmit` + `npm run lint` green (repo has 2 pre-existing ESLint errors in `app/asset/[id].tsx` + 3 pre-existing warnings — confirm no NEW issues). **Native verification is manual** (listed per task).

---

### Task 1: HTTP client layer (native fetch / Tauri plugin-http)

**Files:**
- Create: `src/sync/http.ts` (native)
- Create: `src/sync/http.web.ts` (web build)
- Modify: `package.json` (add `@tauri-apps/plugin-http`)
- Modify: `src-tauri/Cargo.toml` (add `tauri-plugin-http`)
- Modify: `src-tauri/src/lib.rs` (register the plugin)
- Modify: `src-tauri/capabilities/default.json` (HTTP scope grant)

**Interfaces:**
- Consumes: `HttpClient` from `./providers/types`.
- Produces: `httpClient: HttpClient` (the default export shape differs per platform but the type is identical).

- [ ] **Step 1: Install the JS dependency**

```bash
npm install @tauri-apps/plugin-http@^2
```

- [ ] **Step 2: Create the native HTTP client**

Create `src/sync/http.ts`:

```ts
import type { HttpClient } from './providers/types';

// Native (iOS / Android): the global fetch. React Native's networking passes
// arbitrary methods (PUT / PROPFIND / MKCOL) through to NSURLSession / OkHttp,
// and there is no browser CORS layer. A fetch Response satisfies HttpResponse
// (status / headers.get / text) structurally.
export const httpClient: HttpClient = (url, init) => fetch(url, init);
```

- [ ] **Step 3: Create the web/desktop HTTP client**

Create `src/sync/http.web.ts`:

```ts
import type { HttpClient } from './providers/types';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

// Web build: only the Tauri desktop webview can reach a WebDAV server. A plain
// browser / PWA is blocked by CORS (sync is hidden there via isSyncAvailable()).
// Tauri's plugin-http fetch runs in the Rust process and bypasses webview CORS.
// Lazy-imported so a plain browser bundle never loads the plugin.
export const httpClient: HttpClient = async (url, init) => {
  if (!isTauri()) {
    throw new Error('cloud sync is unavailable in a plain browser — use the desktop or mobile app');
  }
  const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
  return tauriFetch(url, init);
};
```

- [ ] **Step 4: Add the Rust plugin dependency**

In `src-tauri/Cargo.toml`, under `[dependencies]`, add after the `tauri-plugin-sql` line:

```toml
tauri-plugin-http = "2"
```

- [ ] **Step 5: Register the plugin in `lib.rs`**

In `src-tauri/src/lib.rs`, add the `.plugin(...)` line after the existing `tauri_plugin_sql` registration:

```rust
    .plugin(tauri_plugin_sql::Builder::default().build())
    .plugin(tauri_plugin_http::init())
```

- [ ] **Step 6: Grant the HTTP capability scope**

In `src-tauri/capabilities/default.json`, extend the `permissions` array (the WebDAV host is user-configured, so the scope must be broad):

```json
  "permissions": [
    "core:default",
    "sql:default",
    "sql:allow-execute",
    {
      "identifier": "http:default",
      "allow": [{ "url": "https://**" }, { "url": "http://**" }]
    }
  ]
```

- [ ] **Step 7: Automated verification (JS)**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc clean; lint only the pre-existing issues; the test suite still 55/55 (these files are not node-tested but must not break compilation of the rest).

- [ ] **Step 8: Manual verification (desktop — requires Rust toolchain)**

```bash
npm run tauri:dev
```
Expected: the desktop app launches with no Rust/plugin build error (confirms `Cargo.toml` + `lib.rs` + capability are valid). A real WebDAV GET is exercised end-to-end in Task 3's manual step. If the build environment lacks Rust, record this step as "deferred to the developer's machine."

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json src/sync/http.ts src/sync/http.web.ts src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/capabilities/default.json
git commit -m "feat(sync): platform HTTP client (native fetch / Tauri plugin-http) + capability"
```

---

### Task 2: Credential storage (expo-secure-store / Tauri store)

**Files:**
- Create: `src/sync/credentials.ts` (native)
- Create: `src/sync/credentials.web.ts` (web build)
- Modify: `package.json` (add `expo-secure-store`, `@tauri-apps/plugin-store`)
- Modify: `app.json` (add the `expo-secure-store` config plugin)
- Modify: `src-tauri/Cargo.toml` (add `tauri-plugin-store`)
- Modify: `src-tauri/src/lib.rs` (register the plugin)
- Modify: `src-tauri/capabilities/default.json` (`store:default`)

**Interfaces:**
- Consumes: `WebDavConfig` from `./providers/webdav`.
- Produces (identical signatures in both platform files):
  - `loadCredentials(): Promise<WebDavConfig | null>`
  - `saveCredentials(config: WebDavConfig): Promise<void>`
  - `clearCredentials(): Promise<void>`

- [ ] **Step 1: Install the dependencies**

```bash
npx expo install expo-secure-store
npm install @tauri-apps/plugin-store@^2
```

- [ ] **Step 2: Add the expo-secure-store config plugin**

In `app.json`, add `"expo-secure-store"` to the `expo.plugins` array (after `"expo-sqlite"`):

```json
    "expo-sqlite",
    "expo-secure-store",
```

- [ ] **Step 3: Create the native credential store**

Create `src/sync/credentials.ts`:

```ts
import * as SecureStore from 'expo-secure-store';
import type { WebDavConfig } from './providers/webdav';

// Credentials (incl. the app password) live ONLY here — never in the synced
// sync_state table, never logged. One JSON blob under a single key.
const KEY = 'cicada_webdav_credentials';

export async function loadCredentials(): Promise<WebDavConfig | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  return raw ? (JSON.parse(raw) as WebDavConfig) : null;
}

export async function saveCredentials(config: WebDavConfig): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(config));
}

export async function clearCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
```

- [ ] **Step 4: Create the web/desktop credential store**

Create `src/sync/credentials.web.ts`:

```ts
import type { WebDavConfig } from './providers/webdav';

const STORE_FILE = 'cicada-credentials.json';
const KEY = 'webdav';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function openStore() {
  const { load } = await import('@tauri-apps/plugin-store');
  return load(STORE_FILE, { autoSave: true });
}

export async function loadCredentials(): Promise<WebDavConfig | null> {
  if (!isTauri()) return null; // plain browser: sync disabled, no credentials
  const store = await openStore();
  const val = await store.get<WebDavConfig>(KEY);
  return val ?? null;
}

export async function saveCredentials(config: WebDavConfig): Promise<void> {
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

- [ ] **Step 5: Add the Rust store plugin**

In `src-tauri/Cargo.toml`, under `[dependencies]`, add:

```toml
tauri-plugin-store = "2"
```

In `src-tauri/src/lib.rs`, register it after the http plugin from Task 1:

```rust
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_store::Builder::default().build())
```

In `src-tauri/capabilities/default.json`, add `"store:default"` to `permissions`:

```json
    "sql:allow-execute",
    "store:default",
    {
      "identifier": "http:default",
      "allow": [{ "url": "https://**" }, { "url": "http://**" }]
    }
```

- [ ] **Step 6: Automated verification (JS)**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc clean; lint only pre-existing; suite still 55/55.

- [ ] **Step 7: Manual verification (desktop)**

```bash
npm run tauri:dev
```
Then in the desktop devtools console, confirm the store round-trips (paste-run):
```js
const { load } = await import('@tauri-apps/plugin-store');
const s = await load('cicada-credentials.json', { autoSave: true });
await s.set('webdav', { baseUrl: 'x', username: 'u', appPassword: 'p' });
await s.save();
console.log(await s.get('webdav')); // -> { baseUrl: 'x', username: 'u', appPassword: 'p' }
await s.delete('webdav'); await s.save();
```
(If the env lacks Rust, defer to the developer's machine.)

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json app.json src/sync/credentials.ts src/sync/credentials.web.ts src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/capabilities/default.json
git commit -m "feat(sync): secure credential storage (expo-secure-store / Tauri store)"
```

---

### Task 3: Remote factory (`remote.ts`)

Ties config + the platform `HttpClient` into a `SyncRemote`, and builds one from stored credentials. This is the single entry point the Phase-4 orchestrator will call.

**Files:**
- Create: `src/sync/remote.ts`

**Interfaces:**
- Consumes: `httpClient` from `./http`; `createWebDavRemote` + `WebDavConfig` from `./providers/webdav`; `SyncRemote` from `./providers/types`; `loadCredentials` from `./credentials`.
- Produces:
  - `createConfiguredRemote(config: WebDavConfig): SyncRemote`
  - `loadRemote(): Promise<SyncRemote | null>` (null when no credentials are stored)

- [ ] **Step 1: Create `remote.ts`**

Create `src/sync/remote.ts`:

```ts
import { httpClient } from './http';
import { createWebDavRemote, type WebDavConfig } from './providers/webdav';
import type { SyncRemote } from './providers/types';
import { loadCredentials } from './credentials';

// Build a remote from an explicit config (used by the Settings "Test connection"
// / Connect flow in Phase 4, before credentials are persisted).
export function createConfiguredRemote(config: WebDavConfig): SyncRemote {
  return createWebDavRemote(config, httpClient);
}

// Build a remote from stored credentials, or null if the user hasn't connected.
export async function loadRemote(): Promise<SyncRemote | null> {
  const config = await loadCredentials();
  if (!config) return null;
  return createConfiguredRemote(config);
}
```

> Metro resolves `./http` to `http.ts` (native) or `http.web.ts` (web), and `./credentials` to the matching platform file — `remote.ts` itself stays platform-agnostic.

- [ ] **Step 2: Automated verification**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: tsc clean (confirms `remote.ts` wires the Part-1 types correctly across the platform splits); lint only pre-existing; suite still 55/55.

- [ ] **Step 3: Commit**

```bash
git add src/sync/remote.ts
git commit -m "feat(sync): remote factory (config/stored-credentials -> SyncRemote)"
```

---

## Manual end-to-end verification (developer, after all tasks)

This is the real proof the wiring works; it needs a device/desktop build and a 坚果云 (or any WebDAV) account with an **app password** (坚果云 → 账户信息 / 安全选项 → 添加应用密码).

1. **Desktop (Tauri):** `npm run tauri:dev`. In the devtools console:
   ```js
   const { createConfiguredRemote } = await import('/src/sync/remote.ts'); // adjust to the bundled path
   const r = createConfiguredRemote({ baseUrl: 'https://dav.jianguoyun.com/dav/', username: '<email>', appPassword: '<app-pw>' });
   await r.testConnection();                 // resolves on success; throws on 401/network
   await r.write('{"hello":"world"}', { kind: 'ifNoneMatch' }); // seed (MKCOL + create)
   console.log(await r.read());              // { content: '{"hello":"world"}', etag: <string|null> }
   ```
2. **Confirm the `If-Match` question empirically** (spec §11 open item): after the seed, `read()` to get the etag, then `write(..., { kind: 'ifMatch', etag: '<stale>' })` with a wrong etag — a server that honors conditional writes returns 412 (→ `ConflictError`). Record whether 坚果云 honors it (drives the Phase-4 fallback decision).
3. **Native (dev build, not Expo Go — `expo-secure-store` + custom config plugin need a dev build):** `eas build --profile development` (or a local prebuild), then repeat the `createConfiguredRemote` round-trip and confirm `saveCredentials`/`loadCredentials` persist across app restarts.
4. **Plain browser (negative check):** `npm run serve:web`, open in a normal browser — `isSyncAvailable()` is false and `httpClient` throws the "unavailable in a plain browser" error if called. The app otherwise works locally.

## What this plan does NOT cover (Phase 4 / Phase 5)

- **`sync.ts` orchestrator** (pull → reconcile → merge → apply → push, 412 retry, no-ETag fallback), **`hlc.receive()`** (advance the clock past merged-in remote stamps), **`SyncContext`**, the Settings "Cloud Sync" UI, and launch/foreground/manual triggers — Phase 4.
- **Backup v3, tombstone GC** — Phase 5.
- **Carried-over Phase-2 Minor cleanups** (reconcile unused `updated_at` SELECT field; etc.) — fold into Phase 4 polish.

## Self-review notes

- **Spec coverage (WebDAV design §3 HTTP layer + §9 deps/credentials):** native fetch / Tauri plugin-http split → Task 1; expo-secure-store / Tauri store split → Task 2; Tauri Rust plugins + capability grants (`http` scope `https://**`+`http://**`, `store:default`) → Tasks 1–2; the `remote.ts` factory consuming Part-1's `createWebDavRemote` → Task 3. Orchestrator/UI (§5/§2 Settings) are explicitly Phase 4.
- **Type consistency:** `createConfiguredRemote`/`loadRemote` consume the exact Part-1 `WebDavConfig`, `createWebDavRemote`, `SyncRemote`, and `HttpClient` types; `loadCredentials`/`saveCredentials`/`clearCredentials` have identical signatures in both platform files (so Metro can pick either). `httpClient` is typed `HttpClient` in both `http.ts` and `http.web.ts`.
- **Platform-split correctness:** mirrors the existing `database.ts`/`database.web.ts` pattern; `.web.ts` files lazy-import Tauri plugins and no-op/throw in a plain browser, keeping the browser bundle clean and CORS-honest.
- **Honesty about verification:** these are native shims; automated gates are tsc+lint only, and the plan states the real verification is a dev build + 坚果云 round-trip (developer-run). No fabricated unit tests for code that needs a device.
</content>
