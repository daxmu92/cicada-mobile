# Windows Desktop Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows `.msi`/`.exe` installer for the Tauri desktop target from a single WSL command (`npm run build:windows`).

**Architecture:** Day-to-day dev stays in the WSL Linux tree. A build-only git checkout on the Windows NTFS filesystem (`C:\projects\cicada-mobile`) is synced from the WSL tree over a `\\wsl.localhost\` UNC remote, then compiled with the Windows toolchain. A bash script (run from WSL) drives a PowerShell script (run on Windows) via WSL→Windows interop.

**Tech Stack:** Bash, PowerShell, winget, WSL2 interop, Tauri 2 (`@tauri-apps/cli` local dev dep), Rust/MSVC, Node 20 LTS, expo-router web export.

## Global Constraints

- Windows checkout path is exactly `C:\projects\cicada-mobile` (WSL view: `/mnt/c/projects/cicada-mobile`).
- WSL distro is `Ubuntu`; the WSL repo's UNC path is derived at runtime via `wslpath -w` (do not hardcode it).
- The build uses the **committed** state of the WSL tree's current branch; uncommitted edits are excluded by design.
- **No** global `cargo install tauri-cli` — builds use the repo-local `@tauri-apps/cli` via `npm run tauri:build`.
- WebView2 runtime is assumed already installed (verified v149 on this host).
- `tauri.conf.json` is **not** modified — it is already Windows-ready (`bundle.targets: "all"`).
- Match existing `scripts/` convention: a top-of-file comment block explaining *why* the script exists and a `Usage:` line.
- There is no test runner in this repo; verify scripts with `bash -n` (syntax) and a real run.

---

### Task 1: Setup script (`scripts/setup-windows-build.sh`)

**Files:**
- Create: `scripts/setup-windows-build.sh`

**Interfaces:**
- Consumes: nothing (entry point).
- Produces: the Windows toolchain (MSVC C++ build tools, Rust via rustup, Node LTS) and a checkout at `C:\projects\cicada-mobile` with a git remote named `wsl` pointing at the WSL tree's UNC path. Task 2's `build-windows.ps1` relies on that checkout and the `wsl` remote existing.

- [ ] **Step 1: Create the setup script**

Create `scripts/setup-windows-build.sh` with exactly this content:

```bash
#!/usr/bin/env bash
# setup-windows-build.sh — one-time Windows build environment setup, run from WSL.
#
# Installs the Windows toolchain (MSVC C++ build tools, Rust, Node LTS) via winget
# and creates the build-only checkout at C:\projects\cicada-mobile. Idempotent:
# re-running skips anything already present. WebView2 is assumed preinstalled on
# Windows 11. The Tauri CLI is NOT installed globally — the build uses the repo's
# local @tauri-apps/cli via `npm run tauri:build`.
#
# Usage:  bash scripts/setup-windows-build.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WIN_REPO='C:\projects\cicada-mobile'
WIN_REPO_MNT='/mnt/c/projects/cicada-mobile'
WSL_UNC="$(wslpath -w "$REPO_ROOT")"

# Run a PowerShell command with PATH rebuilt from the registry, so tools installed
# earlier in this same run become visible without a terminal restart.
ps() {
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "
    \$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path','User');
    $1"
}

echo "==> Checking MSVC C++ build tools..."
if ps "& \"\${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe\" -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath" | grep -qi "Visual Studio"; then
  echo "    already installed."
else
  echo "    installing Microsoft.VisualStudio.2022.BuildTools (several GB, be patient)..."
  ps "winget install --id Microsoft.VisualStudio.2022.BuildTools -e --silent --accept-package-agreements --accept-source-agreements --override '--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended'"
fi

echo "==> Checking Rust (rustup/cargo)..."
if ps "Get-Command cargo -ErrorAction SilentlyContinue" | grep -qi cargo; then
  echo "    already installed."
else
  echo "    installing Rustlang.Rustup..."
  ps "winget install --id Rustlang.Rustup -e --silent --accept-package-agreements --accept-source-agreements"
fi

echo "==> Checking Node.js..."
if ps "Get-Command node -ErrorAction SilentlyContinue" | grep -qi node; then
  echo "    already installed."
else
  echo "    installing OpenJS.NodeJS.LTS..."
  ps "winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements"
fi

echo "==> Setting up Windows checkout at $WIN_REPO..."
if [ -d "$WIN_REPO_MNT/.git" ]; then
  echo "    already exists."
else
  ps "New-Item -ItemType Directory -Force -Path 'C:\projects' | Out-Null; git clone '$WSL_UNC' '$WIN_REPO'"
fi
ps "Set-Location '$WIN_REPO'; if (git remote | Select-String -Quiet '^wsl\$') { git remote set-url wsl '$WSL_UNC' } else { git remote add wsl '$WSL_UNC' }"

echo ""
echo "==> Setup complete."
echo "    If this run just installed Rust or Node, open a NEW terminal (or re-run"
echo "    this script) so PATH refreshes before building."
echo "    Next: npm run build:windows"
```

- [ ] **Step 2: Verify the script parses**

Run: `bash -n scripts/setup-windows-build.sh && chmod +x scripts/setup-windows-build.sh && echo OK`
Expected: prints `OK` with no syntax errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/setup-windows-build.sh
git commit -m "Add one-time Windows build environment setup script"
```

---

### Task 2: Build pipeline (`build-windows.ps1` + `build-windows.sh` + npm script)

**Files:**
- Create: `scripts/build-windows.ps1`
- Create: `scripts/build-windows.sh`
- Modify: `package.json` (add one entry to `scripts`)

**Interfaces:**
- Consumes: the `C:\projects\cicada-mobile` checkout and `wsl` remote produced by Task 1.
- Produces: `npm run build:windows`, which leaves installers at
  `C:\projects\cicada-mobile\src-tauri\target\release\bundle\{msi,nsis}\` and copies
  them to `~/cicada-builds/` in WSL.

- [ ] **Step 1: Create the Windows-side build script**

Create `scripts/build-windows.ps1` with exactly this content:

```powershell
# build-windows.ps1 — runs on the Windows host, invoked from WSL by build-windows.sh.
# Syncs the build-only checkout to a WSL commit, installs deps only when the lockfile
# changed, then produces the Tauri installer. Windows-only; do not run from WSL bash.
param(
  [Parameter(Mandatory=$true)][string]$Branch,
  [Parameter(Mandatory=$true)][string]$WslRemote,
  [string]$RepoDir = "C:\projects\cicada-mobile"
)
$ErrorActionPreference = "Stop"

# This process inherited a stale environment from WSL. Rebuild PATH from the registry
# so tools installed by setup (cargo, node) are visible without a terminal restart.
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
            [System.Environment]::GetEnvironmentVariable('Path','User')

if (-not (Test-Path "$RepoDir\.git")) {
  throw "No checkout at $RepoDir. Run scripts/setup-windows-build.sh from WSL first."
}
Set-Location $RepoDir

# Point the 'wsl' remote at the WSL working tree (UNC path) and sync to its commit.
if (git remote | Select-String -Quiet '^wsl$') {
  git remote set-url wsl $WslRemote
} else {
  git remote add wsl $WslRemote
}
Write-Host "==> Fetching '$Branch' from WSL tree..."
git fetch wsl
git checkout -B $Branch "wsl/$Branch"
git reset --hard "wsl/$Branch"

# npm ci is slow; only run it when the lockfile changed or deps are missing.
$lockHash = (Get-FileHash package-lock.json -Algorithm SHA256).Hash
$marker = "node_modules\.lockhash"
if (-not (Test-Path "node_modules") -or -not (Test-Path $marker) -or
    (Get-Content $marker -ErrorAction SilentlyContinue) -ne $lockHash) {
  Write-Host "==> Installing dependencies (npm ci)..."
  npm ci
  $lockHash | Set-Content $marker
} else {
  Write-Host "==> Dependencies up to date, skipping npm ci."
}

Write-Host "==> Building Windows bundle (npm run tauri:build)..."
npm run tauri:build

Write-Host "==> Build complete. Artifacts in:"
Write-Host "    $RepoDir\src-tauri\target\release\bundle\"
```

- [ ] **Step 2: Create the WSL-side driver script**

Create `scripts/build-windows.sh` with exactly this content:

```bash
#!/usr/bin/env bash
# build-windows.sh — one-line Windows build, driven from WSL.
#
# Builds the Tauri desktop installer on the Windows host using the build-only
# checkout at C:\projects\cicada-mobile (see docs/windows-build.md). The WSL tree
# stays the source of truth; the build uses its latest *commit* on the current
# branch — uncommitted edits are NOT included.
#
# Usage:  npm run build:windows   (or: bash scripts/build-windows.sh)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
WIN_REPO='C:\projects\cicada-mobile'
WIN_REPO_MNT='/mnt/c/projects/cicada-mobile'
WSL_UNC="$(wslpath -w "$REPO_ROOT")"
PS1_WIN="$(wslpath -w "$REPO_ROOT/scripts/build-windows.ps1")"
BUILDS_DIR="$HOME/cicada-builds"

# A clean build needs the Windows checkout in place.
if [ ! -d "$WIN_REPO_MNT/.git" ]; then
  echo "ERROR: no Windows checkout at $WIN_REPO" >&2
  echo "Run: bash scripts/setup-windows-build.sh" >&2
  exit 1
fi

# Builds use committed state only — warn so a forgotten commit isn't a surprise.
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "WARNING: WSL tree has uncommitted changes; the build uses the last commit on '$BRANCH'." >&2
fi

echo "==> Building branch '$BRANCH' on Windows ($WIN_REPO)..."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PS1_WIN" \
  -Branch "$BRANCH" -WslRemote "$WSL_UNC"

# Surface the installers on the Linux side for convenience.
BUNDLE="$WIN_REPO_MNT/src-tauri/target/release/bundle"
mkdir -p "$BUILDS_DIR"
shopt -s nullglob
copied=0
for f in "$BUNDLE"/msi/*.msi "$BUNDLE"/nsis/*.exe; do
  cp -f "$f" "$BUILDS_DIR/"
  echo "    copied $(basename "$f")"
  copied=1
done
shopt -u nullglob

if [ "$copied" -eq 1 ]; then
  echo "==> Installers copied to $BUILDS_DIR"
else
  echo "WARNING: no installers found under $BUNDLE" >&2
fi
echo "==> Done. Windows artifacts under $WIN_REPO\\src-tauri\\target\\release\\bundle\\"
```

- [ ] **Step 3: Add the npm script**

In `package.json`, inside the `"scripts"` object, add the `build:windows` entry right after the `"tauri:build"` line so it reads:

```json
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build",
    "build:windows": "bash scripts/build-windows.sh",
    "lint": "expo lint"
```

- [ ] **Step 4: Verify scripts parse and the npm entry is valid**

Run:
```bash
bash -n scripts/build-windows.sh && chmod +x scripts/build-windows.sh && \
node -e "require('./package.json').scripts['build:windows'] || process.exit(1)" && \
echo OK
```
Expected: prints `OK` (bash syntax valid and the npm script entry is present).

- [ ] **Step 5: Commit**

```bash
git add scripts/build-windows.ps1 scripts/build-windows.sh package.json
git commit -m "Add one-line Windows build pipeline (npm run build:windows)"
```

---

### Task 3: Documentation (`docs/windows-build.md`)

**Files:**
- Create: `docs/windows-build.md`

**Interfaces:**
- Consumes: the two scripts and npm entry from Tasks 1–2.
- Produces: developer-facing docs (no code depends on this).

- [ ] **Step 1: Create the docs page**

Create `docs/windows-build.md` with exactly this content:

```markdown
# Building the Windows desktop installer

The Windows build runs on the Windows host but is driven from WSL. Your WSL tree
stays the source of truth; a build-only checkout at `C:\projects\cicada-mobile` is
synced from it over a `\\wsl.localhost\` git remote, then compiled with the Windows
toolchain. Builds use the latest **commit** on your current branch — commit before
building, as uncommitted edits are excluded.

## Prerequisites (installed automatically)

`scripts/setup-windows-build.sh` installs these via `winget` (idempotent):

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
```

- [ ] **Step 2: Commit**

```bash
git add docs/windows-build.md
git commit -m "Document the Windows desktop build"
```

---

### Task 4: End-to-end verification (real build)

**Files:** none (verification only).

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: a confirmed working installer.

> This task performs the actual install + build. The VS Build Tools download is
> several GB and the first Rust compile takes many minutes — expect a long run.

- [ ] **Step 1: Run setup**

Run: `bash scripts/setup-windows-build.sh`
Expected: ends with `==> Setup complete.` If it reports Rust/Node were freshly installed, open a new terminal before the next step.

- [ ] **Step 2: Confirm the Windows toolchain is visible**

Run:
```bash
powershell.exe -NoProfile -Command "\$env:Path=[System.Environment]::GetEnvironmentVariable('Path','Machine')+';'+[System.Environment]::GetEnvironmentVariable('Path','User'); node --version; cargo --version" 2>&1
```
Expected: prints a Node version (v20.x or newer) and a cargo version. If either is missing, re-run setup in a fresh terminal.

- [ ] **Step 3: Commit current work, then build**

```bash
git add -A && git commit -m "wip: windows build verification" || true
npm run build:windows
```
Expected: ends with `==> Done.` and `==> Installers copied to ~/cicada-builds`.

- [ ] **Step 4: Confirm artifacts exist**

Run: `ls -la ~/cicada-builds/`
Expected: a `.msi` and a `-setup.exe` are listed.

- [ ] **Step 5: Manual smoke test (human)**

Install via the `.exe` on Windows, launch CicadaFinScape, add an account/asset, restart the app, and confirm the data persisted (validates native SQLite via `tauri-plugin-sql`). No commit — this is a manual confirmation.
```
