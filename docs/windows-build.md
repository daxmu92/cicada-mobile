# Building the Windows desktop installer

The Windows build runs on the Windows host but is driven from WSL. Your WSL tree
stays the source of truth; a build-only checkout at `C:\projects\cicada-mobile` is
synced from it over a `\\wsl.localhost\` git remote, then compiled with the Windows
toolchain. Builds use the latest **commit** on your current branch — commit before
building, as uncommitted edits are excluded.

## Prerequisites (installed automatically)

`scripts/setup-windows-build.sh` installs these via `winget` (idempotent):

- Git for Windows (used to sync the build checkout)
- Microsoft Visual Studio 2022 Build Tools — "Desktop development with C++" (MSVC linker)
- Rust (via rustup; MSVC target by default)
- Node.js 20 LTS

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
copies the installers to `~/cicada-builds/`.

## Artifacts

- `C:\projects\cicada-mobile\src-tauri\target\release\bundle\msi\CicadaFinScape_<version>_x64_en-US.msi`
- `C:\projects\cicada-mobile\src-tauri\target\release\bundle\nsis\CicadaFinScape_<version>_x64-setup.exe`
- Copies of both in `~/cicada-builds/` (WSL).

## Out of scope

Code signing, auto-update, and CI builds are not configured. See
`docs/superpowers/specs/2026-06-20-windows-build-design.md`.
