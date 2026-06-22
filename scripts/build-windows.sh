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
# Clone/sync source must be the MAIN working tree: a linked worktree's .git is a
# file (a gitdir pointer), which is not clonable/fetchable over a UNC path.
GIT_COMMON_DIR="$(cd "$(git rev-parse --git-common-dir)" && pwd -P)"
MAIN_ROOT="$(dirname "$GIT_COMMON_DIR")"
WSL_UNC="$(wslpath -w "$MAIN_ROOT")"
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
build_status=$?
if [ "$build_status" -ne 0 ]; then
  echo "ERROR: Windows build failed (exit $build_status). No artifacts produced." >&2
  exit "$build_status"
fi

# Surface the installers on the Linux side for convenience.
RELEASE="$WIN_REPO_MNT/src-tauri/target/release"
BUNDLE="$RELEASE/bundle"
mkdir -p "$BUILDS_DIR"
# Clear prior installers/portable so this dir always reflects ONLY the current
# build — otherwise older-version artifacts (e.g. a past 0.1.0) linger here
# forever after a version bump. rm -f ignores the no-match case.
rm -f "$BUILDS_DIR"/*.msi "$BUILDS_DIR"/*.exe
shopt -s nullglob
copied=0
for f in "$BUNDLE"/msi/*.msi "$BUNDLE"/nsis/*.exe; do
  cp -f "$f" "$BUILDS_DIR/"
  echo "    copied $(basename "$f")"
  copied=1
done
shopt -u nullglob

# Portable (no-install) build: the standalone main binary. Runs without an
# installer; relies on the WebView2 runtime that ships with Windows 10/11.
if [ -f "$RELEASE/CicadaFinScape.exe" ]; then
  cp -f "$RELEASE/CicadaFinScape.exe" "$BUILDS_DIR/CicadaFinScape-portable.exe"
  echo "    copied CicadaFinScape-portable.exe"
  copied=1
fi

if [ "$copied" -eq 1 ]; then
  echo "==> Installers copied to $BUILDS_DIR"
else
  echo "WARNING: no installers found under $BUNDLE" >&2
fi
echo "==> Done. Windows artifacts under $WIN_REPO\\src-tauri\\target\\release\\bundle\\"
