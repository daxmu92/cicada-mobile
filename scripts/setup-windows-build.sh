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
