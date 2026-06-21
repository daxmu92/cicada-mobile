# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

CicadaFinScape Mobile — a local-first personal finance tracker (net worth, assets,
income/expenses) built on Expo / React Native. One TypeScript codebase ships to
**five targets**: iOS, Android, browser, installable PWA, and a Tauri desktop app.
All data is on-device in SQLite; there is no backend or network dependency.

Requires **Node 20+** (`.nvmrc`). Use `npm ci` for reproducible installs.

## Commands

```bash
npx expo start          # Metro + dev server (scan QR with Expo Go)
npm run android         # / ios / web — launch a specific platform
npm run lint            # expo lint (eslint-config-expo, flat config)
npx tsc --noEmit        # type-check (strict mode; there is no test suite)

# Web / PWA
npm run export:web      # static export to dist/
npm run serve:web       # serve dist/ with the COOP/COEP headers SQLite needs

# Tauri desktop (needs Rust toolchain)
npm run tauri:dev       # exports web + runs desktop shell
npm run tauri:build

# EAS (cloud builds / OTA — credentials live in EAS, not the repo)
eas build --profile preview --platform android
eas update --branch preview --message "..."

# One-off: convert a backup ZIP from the original Streamlit app
node scripts/migrate-streamlit.js <backup.zip> cicada-backup.json
```

There is **no configured test runner**; don't look for one. Verify changes with
`npx tsc --noEmit` + `npm run lint`, and by running the relevant platform.

## Architecture

### The database abstraction is the crux

Every persistence path goes through the **`CicadaDB` interface** defined in
`src/db/migrations.ts` (a minimal subset of expo-sqlite's API). The shared schema
and migrations are written against that interface so the same logic runs on all
backends. Three backends are wired up, selected two ways:

- **`src/db/database.ts`** — native (iOS/Android), plain expo-sqlite.
- **`src/db/database.web.ts`** — chosen by Metro's `.web.ts` resolution for the
  web target. At runtime it checks `window.__TAURI_INTERNALS__`:
  - **Tauri desktop** → lazy-imports `src/db/tauri-sqlite.ts` (native SQLite via
    `@tauri-apps/plugin-sql`). Desktop webviews don't reliably expose OPFS.
  - **Plain browser/PWA** → expo-sqlite's WASM (wa-sqlite, persisted via OPFS).

`tauri-sqlite.ts` adapts tauri-plugin-sql to `CicadaDB` and carries the tricky bits:
it rewrites `?` placeholders to `$1, $2, …`, splits multi-statement DDL on `;`, and
makes `withTransactionAsync` a no-op (the plugin's connection pool can't guarantee a
JS-issued BEGIN/COMMIT lands on one connection — fine for this single-user app, but
restores are **not** atomic on desktop).

**Cross-origin isolation (COOP/COEP headers) is mandatory** for wa-sqlite's OPFS and
must be set everywhere the web build is served: `metro.config.js` (dev),
`scripts/serve-web.js` (static export), and `src-tauri/tauri.conf.json` (desktop).
`metro.config.js` also registers `.wasm` as a bundleable asset. A LAN IP over plain
http is not a secure context, so SQLite/PWA only work over `localhost` or https.

### Data model & repos

Tables (`migrations.ts`): `account` → `asset` (FK, cascade) → `asset_snapshot`,
plus `tran` (transactions) and `setting` (key/value). Schema is versioned via
`PRAGMA user_version`; bump `SCHEMA_VERSION` and add a block in `migrate()` for changes.

- **Snapshots are monthly**, keyed by `(asset_id, date)` where `date` is a
  `"YYYY-MM"` string (see `src/utils/date.ts`). Transactions use full `"YYYY-MM-DD"`.
- Each `src/db/*-repo.ts` exposes plain async functions that call `getDatabase()`
  themselves (no db argument is passed in). Repos own the mapping between snake_case
  SQL columns and the camelCase TS types in `src/utils/types.ts`.
- Two domain concepts to preserve: **profit auto-fill** (`profit = Δnet-worth − inflow`)
  and **forward-fill** (carry an asset's last-known net worth into months it has no
  snapshot). Forward-fill is an opt-in setting honored by `snapshot-repo` query helpers
  via a `{ forwardFill }` option — keep that flag threaded through.
- **Archiving** (`archived` column on account/asset) hides records without deleting
  history; most aggregate queries filter `a.archived = 0`.

### App shell & screens

- **Expo Router** (file-based, typed routes). `app/(tabs)/` = Home/Assets/
  Transactions/Settings; `app/asset/[id].tsx` = detail; `app/modals/*` = modal
  presentations registered in `app/_layout.tsx`.
- Screens hold their own state and **reload data on focus** via `useFocusEffect`
  (often alongside a `useEffect`). There is no global store/cache — re-query the DB.
- **Settings** live in `src/hooks/SettingsContext.tsx`, persisted to the `setting`
  table: currency symbol, forward-fill toggle, and gain/loss color convention
  (green-up vs red-up for Asian markets). Use the provided hooks — `useFormat()` for
  money formatting and `useSemanticColors()` for gain/loss colors — rather than
  formatting or coloring inline.

### Platform-conditional helpers

react-native-web stubs out some RN APIs, so two utilities branch on `Platform.OS`:

- **`src/utils/dialog.ts`** — RN `Alert` is a no-op on web; use `confirmAsync`/`notify`
  here, which fall back to `window.confirm`/`alert`. On web, `confirmAsync` is
  intentionally synchronous so a following file-picker call stays inside the user gesture.
- **`src/services/backup.ts`** — versioned JSON export/import. Web uses a Blob download
  and a hidden `<input type=file>`; native uses `expo-file-system` + `expo-sharing` /
  `expo-document-picker`. Import calls `resetDatabase()` first (replaces all data).

## Conventions

- App code lives in **`src/`**. The root `components/` and `hooks/` directories are
  largely leftover Expo-template boilerplate (themed views, color-scheme hooks); the
  real charts/components are under `src/components/`.
- Path alias **`@/*` → repo root** (tsconfig) is used by the template files; `src/`
  modules are imported with relative paths.
- Shared styling tokens are in `src/utils/theme.ts` (`colors`, `spacing`, `shared`
  StyleSheet). Charts are isolated in `src/components/charts/` (react-native-gifted-charts)
  so the chart layer stays swappable.
- Native `android/`/`ios/` dirs are intentionally gitignored — EAS regenerates them
  from `app.json` (Continuous Native Generation).
