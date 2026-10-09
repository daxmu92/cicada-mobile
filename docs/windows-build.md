# Building the Windows desktop installer

The Windows build runs on the Windows host but is driven from WSL. Your WSL tree
stays the source of truth; a build-only checkout at `C:\projects\cicada-mobile` is
synced from it over a `\\wsl.localhost\` git remote, then compiled with the Windows
toolchain. Builds use the latest **commit** on your current branch — commit before
building, as uncommitted edits are excluded.

## Prerequisites

Install **PowerShell 7** (`Microsoft.PowerShell`) on Windows first. The WSL scripts
use `pwsh.exe`, with the default `C:\Program Files\PowerShell\7\pwsh.exe` path as a
fallback when WSL has not picked up the updated PATH.

### Build dependencies (installed automatically)

`scripts/setup-windows-build.sh` installs these via `winget` (idempotent):

- Git for Windows (used to sync the build checkout)
- Microsoft Visual Studio 2022 Build Tools — "Desktop development with C++" (MSVC linker)
- Rust (via rustup; MSVC target by default)
- Node.js 20+ and Rust 1.90+

WebView2 ships with Windows 11. The Tauri CLI is **not** installed globally — the
build uses the repo-local `@tauri-apps/cli` through `npm run tauri:build`.

## One-time setup

```bash
bash scripts/setup-windows-build.sh
```

If this run installs Rust or Node for the first time, open a new terminal (or
re-run the script) so PATH refreshes before building.

The setup also runs `git config --global --add safe.directory '*'` on the Windows
side. Git for Windows otherwise refuses to read the WSL repo over the
`\\wsl.localhost\` path because its owner (a Linux uid) differs from the Windows
user ("dubious ownership"). This is expected on a single-user dev machine.

## Building

```bash
npm run build:windows
```

This syncs the Windows checkout to your current branch's latest commit, installs
dependencies when the lockfile changed, runs `expo export` + the Tauri bundle, and
copies installers and checksums to `../cicada-builds/<commit>/`.
Each commit uses an independent `C:\projects\cicada-build-tools\target-<commit>`
so a running EXE from an earlier build is not overwritten. The script discovers
the protected local update key if available; without it, installers build without
update signatures.

## Artifacts

- `C:\projects\cicada-build-tools\target-<commit>\release\bundle\msi\CicadaFinScape_<version>_x64_en-US.msi`
- `C:\projects\cicada-build-tools\target-<commit>\release\bundle\nsis\CicadaFinScape_<version>_x64-setup.exe`
- Copies of both in `../cicada-builds/<commit>/` (WSL).

## Publishing

GitHub CI builds Windows installers; package-signature based updates are configured.
See [Release preparation](release-preparation.md) for signing, manifests and the
remaining Authenticode/cloud acceptance prerequisites.
