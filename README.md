# 🐝 CicadaFinScape Mobile

> A local-first, cross-platform personal finance tracker — track your net worth across accounts and assets, log income and expenses, and visualize trends over time. All data stays on your device.

![Platform](https://img.shields.io/badge/platform-iOS%20%7C%20Android%20%7C%20Web-blue)
![Expo SDK](https://img.shields.io/badge/Expo-SDK%2054-000020?logo=expo)
![React Native](https://img.shields.io/badge/React%20Native-0.81-61DAFB?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript)
![Storage](https://img.shields.io/badge/storage-SQLite%20(local--first)-003B57?logo=sqlite)

Ported from the original [Streamlit app](https://github.com/daxmu92/CicadaFinScape).

## Features

- 📊 **Dashboard** — total net worth, a year-at-a-glance calendar of monthly net growth, and asset allocation
- 💰 **Assets** — group by account, drill into per-asset history with line charts and time-range filters (3M/6M/1Y/3Y/All)
- 🔄 **Transactions** — income/expense tracking grouped by date, with category breakdown and tag suggestions
- 📈 **Charts** — sparklines, allocation bars, line charts, and category breakdowns (swappable chart layer)
- 🗂️ **Snapshots** — monthly net-worth entries with smart auto-fill (profit = Δnet-worth − inflow) and optional forward-fill for skipped months
- 🗄️ **Archive** — hide closed accounts/assets without losing history
- ⚙️ **Preferences** — configurable currency symbol and gain/loss color convention (green-up or red-up for Asian markets)
- 💾 **Backup** — versioned JSON export/import; one-off migration from the Streamlit app
- 📴 **Offline-first** — everything runs on-device, no account or network required

## Tech stack

| Layer | Choice |
|-------|--------|
| Framework | Expo SDK 54 (React Native 0.81) |
| Language | TypeScript |
| Navigation | Expo Router (file-based) |
| Storage | expo-sqlite (local, with schema migrations) |
| State | React Context (settings) + local component state |
| Charts | react-native-gifted-charts |
| Build / OTA | EAS Build + EAS Update |

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
