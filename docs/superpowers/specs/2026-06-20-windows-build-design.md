# Windows Desktop Build — Design

**Date:** 2026-06-20
**Status:** Approved (pending spec review)

## Goal

Produce a Windows installer (`.msi` + `.exe`) for the Tauri desktop target of
CicadaFinScape, driven entirely from the developer's WSL2 session with a single
command. Day-to-day development continues to happen in the WSL Linux tree; only
the Windows *build* runs on the Windows host.

## Context & constraints

- Primary dev tree lives on the **Linux filesystem**: `/home/zhijial/cicada-mobile`.
- Host is **Windows 11 64-bit**; WSL→Windows interop is enabled (we can invoke
  `powershell.exe` / `winget.exe` from WSL).
- Tauri config is already Windows-ready: `bundle.targets: "all"`,
  `productName: "CicadaFinScape"`, `identifier: "com.daxmu.cicada"`, icons include
  `icon.ico`. **No `tauri.conf.json` changes are required.**
- Already present on Windows: **WebView2 runtime v149** ✓.
- Missing on Windows: MSVC C++ build tools, Rust, Node, Tauri CLI.

### Why a separate Windows checkout (Approach A)

Compiling Rust + installing `node_modules` over the `\\wsl.localhost\` 9p network
path is slow and intermittently flaky. So the Windows build uses a **native NTFS
checkout** at `C:\projects\cicada-mobile`. The WSL tree stays the source of truth;
the Windows checkout is a build-only mirror synced via git.

### Sync model

The Windows checkout adds the WSL working tree as a git remote over its UNC path:

```
git remote add wsl \\wsl.localhost\Ubuntu\home\zhijial\cicada-mobile
```

Each build does `git fetch wsl` and hard-resets the Windows checkout to the WSL
tree's **current branch HEAD**. Consequence: a build reflects the latest *commit*
in WSL. **Uncommitted WSL edits are excluded by design** — builds are reproducible
from committed state. (The script warns if the WSL tree is dirty.)

## Components

### 1. One-time setup script — `scripts/setup-windows-build.sh`

Run once from WSL. Idempotent (skips anything already installed). Steps:

1. Install via `winget` (using `powershell.exe`), each guarded by a presence check:
   - `Microsoft.VisualStudio.2022.BuildTools` with the **Desktop development with
     C++** workload (provides the MSVC linker). Installed with
     `--override "--add Microsoft.VisualStudio.Workload.VCTools ..."`.
   - `Rustlang.Rustup` (yields `cargo`/`rustc`, MSVC target by default).
   - `OpenJS.NodeJS.LTS` (Node 20+).
2. `cargo install tauri-cli --locked` (skip if `cargo tauri` already resolves). The
   repo also has `@tauri-apps/cli` as a dev dep, so `npm run tauri` works too; we
   prefer the npm-local CLI to keep versions aligned and only fall back to the
   global one.
3. Clone the repo to `C:\projects\cicada-mobile` if absent (clone from the WSL UNC
   path) and wire up the `wsl` remote.
4. Print a clear "next step: `npm run build:windows`" message.

> Note: the VS Build Tools install is large (several GB) and may need a terminal
> restart for PATH changes to take effect. The script detects a missing toolchain
> on the next run and tells the user to re-run rather than failing cryptically.

### 2. One-line build — `scripts/build-windows.sh`, exposed as `npm run build:windows`

Run from WSL. Steps:

1. Verify the Windows checkout exists; if not, instruct the user to run the setup
   script.
2. Warn if the WSL tree has uncommitted changes (build uses committed state only).
3. On the Windows side (via `powershell.exe`), in `C:\projects\cicada-mobile`:
   `git fetch wsl` → `git checkout <current-branch>` → `git reset --hard wsl/<branch>`.
4. `npm ci` — only when `node_modules` is missing or `package-lock.json` changed
   since the last install (tracked by a hash marker file) to keep rebuilds fast.
5. `npm run tauri:build` (runs `expo export` then the Tauri bundle).
6. Copy the produced installers to a predictable WSL location
   (`~/cicada-builds/`) and print both the Windows and WSL paths.

`package.json` gains one script entry:

```json
"build:windows": "bash scripts/build-windows.sh"
```

### 3. Docs

A short `docs/windows-build.md` (or a README section) covering prerequisites,
the two scripts, and where artifacts land.

## Artifacts

`C:\projects\cicada-mobile\src-tauri\target\release\bundle\`:
- `msi\CicadaFinScape_0.1.0_x64_en-US.msi`
- `nsis\CicadaFinScape_0.1.0_x64-setup.exe`

Copied to `~/cicada-builds/` in WSL for convenience.

## Out of scope (YAGNI)

- **Code signing** of the installer (no cert available; can add later).
- **GitHub Actions CI** for Windows (chose local-host build for now).
- **Auto-update** (`tauri-plugin-updater`).
- Cross-compiling from Linux.

## Error handling

- Each install step is presence-checked → re-running setup is safe.
- Missing toolchain at build time → actionable message pointing to the setup script.
- Dirty WSL tree → warning, build proceeds from last commit.
- WSL UNC path unreachable from Windows → fail early with the exact path tried.

## Testing / verification

No automated test suite in this repo. Verify by:
1. Running `scripts/setup-windows-build.sh` on a clean Windows toolchain.
2. Running `npm run build:windows` and confirming the `.msi`/`.exe` are produced.
3. Installing and launching the app on Windows; confirming SQLite (native via
   `tauri-plugin-sql`) works and data persists.
