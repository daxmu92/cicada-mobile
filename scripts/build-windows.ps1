# build-windows.ps1 - runs on the Windows host, invoked from WSL by build-windows.sh.
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

# Fail early with the exact path if the WSL tree isn't reachable (9p/UNC can be flaky).
if (-not (Test-Path $WslRemote)) {
  throw "WSL tree not reachable at $WslRemote (is WSL running?)."
}

# Point the 'wsl' remote at the WSL working tree (UNC path) and sync to its commit.
if (git remote | Select-String -Quiet '^wsl$') {
  git remote set-url wsl $WslRemote
} else {
  git remote add wsl $WslRemote
}
Write-Host "==> Fetching '$Branch' from WSL tree..."
git fetch wsl
git rev-parse --verify --quiet "wsl/$Branch" *> $null
if ($LASTEXITCODE -ne 0) {
  throw "Branch '$Branch' not found on the WSL tree after fetch - commit it on the WSL side first."
}
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
