# CicadaFinScape Mobile

A cross-platform personal finance tracker built with Expo (React Native + TypeScript). Local-first: all data lives in an on-device SQLite database. Tracks accounts, assets, monthly net-worth snapshots, and income/expense transactions, with charts and JSON backup/restore.

Ported from the original [Streamlit app](https://github.com/daxmu92/CicadaFinScape).

## Requirements

- **Node.js 20+** (see `.nvmrc` — use `nvm use`)
- **npm** (lockfile committed; use `npm ci` for reproducible installs)
- For device testing: the **Expo Go** app, or an EAS build (see below)

## Quick start

```bash
nvm use            # or ensure Node 20+
npm ci             # reproducible install from package-lock.json
npx expo start     # starts Metro bundler + dev server
```

Scan the QR code with **Expo Go** (Android) or the Camera app (iOS).

### WSL2 networking note

On WSL2, Expo may advertise the WSL virtual IP, which phones can't reach. Two options:

- Enable **mirrored networking** in `%USERPROFILE%\.wslconfig`:
  ```ini
  [wsl2]
  networkingMode=mirrored
  ```
  then `wsl --shutdown` and reopen. Allow port 8081 through Windows Firewall.
- Or pin the LAN IP explicitly:
  ```bash
  REACT_NATIVE_PACKAGER_HOSTNAME=<your-LAN-IP> npx expo start
  ```

## Project structure

```
app/                      Expo Router screens
  (tabs)/                 Home, Assets, Transactions, Settings
  asset/[id].tsx          Asset detail (history + chart)
  modals/                 add-record, add-transaction, manage-accounts, edit-asset
src/
  db/                     SQLite: database, account/asset/snapshot/tran/setting repos
  components/charts/      Sparkline, AllocationBarList, AssetLineChart, CategoryBars
  components/YearCalendar.tsx
  hooks/SettingsContext.tsx   currency, forward-fill, gain/loss color
  services/               backup (JSON export/import), sample-data
  utils/                  date, format, theme, types
scripts/migrate-streamlit.js   one-off converter (see below)
```

## Type-checking

```bash
npx tsc --noEmit
```

## Building a standalone app (EAS)

The app uses [EAS Build](https://docs.expo.dev/build/introduction/) for installable binaries and [EAS Update](https://docs.expo.dev/eas-update/introduction/) for over-the-air JS updates.

```bash
npm install -g eas-cli
eas login

# Build an installable Android APK (cloud build, ~15 min)
eas build --profile preview --platform android

# Push JS-only changes to installed builds without rebuilding
eas update --branch preview --message "describe the change"
```

Build profiles live in `eas.json` (`development`, `preview`, `production`). Signing
credentials (Android keystore) are managed by EAS and are **not** stored in this repo.
The native `android/` and `ios/` folders are intentionally gitignored — EAS regenerates
them from `app.json` via Continuous Native Generation.

## Migrating data from the Streamlit app

Export a backup ZIP from the original CicadaFinScape (Cicada Tools page), then convert it:

```bash
node scripts/migrate-streamlit.js <path-to-backup.zip> cicada-backup.json
```

Transfer `cicada-backup.json` to your phone and import via **Settings → Import Data**.

## Data & backup

- All data is stored locally in SQLite (`cicada.db`).
- **Settings → Export Data** writes a versioned JSON backup and opens the share sheet.
- **Settings → Import Data** restores from a JSON backup (replaces existing data).
