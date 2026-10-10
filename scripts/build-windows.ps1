# build-windows.ps1 - runs on the Windows host, invoked from WSL by build-windows.sh.
# Syncs the build-only checkout to a WSL commit, installs deps only when the lockfile
# changed, then produces the Tauri installer. Windows-only; do not run from WSL bash.
param(
  [Parameter(Mandatory=$true)][string]$Branch,
  [Parameter(Mandatory=$true)][string]$WslRemote,
  [string]$RepoDir = "C:\projects\cicada-mobile",
  [string]$TargetDir = ""
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
if ($LASTEXITCODE -ne 0) { throw 'Could not fetch the WSL checkout.' }
git rev-parse --verify --quiet "wsl/$Branch" *> $null
if ($LASTEXITCODE -ne 0) {
  throw "Branch '$Branch' not found on the WSL tree after fetch - commit it on the WSL side first."
}
if ((git status --porcelain)) { throw 'The Windows build checkout has local changes. Preserve them before syncing.' }
git checkout -B $Branch "wsl/$Branch"
if ($LASTEXITCODE -ne 0) { throw 'Could not check out the build branch.' }
git reset --hard "wsl/$Branch"
if ($LASTEXITCODE -ne 0) { throw 'Could not reset the dedicated build checkout.' }

# npm ci is slow; only run it when the lockfile changed or deps are missing.
$lockHash = (Get-FileHash package-lock.json -Algorithm SHA256).Hash
$marker = "node_modules\.lockhash"
if (-not (Test-Path "node_modules") -or -not (Test-Path $marker) -or
    (Get-Content $marker -ErrorAction SilentlyContinue) -ne $lockHash) {
  Write-Host "==> Installing dependencies (npm ci)..."
  npm ci
  if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
  $lockHash | Set-Content $marker
} else {
  Write-Host "==> Dependencies up to date, skipping npm ci."
}

if ($TargetDir) { $env:CARGO_TARGET_DIR = $TargetDir }
if (-not $env:CARGO_TARGET_DIR) {
  $commit = (git rev-parse --short=7 HEAD).Trim()
  $env:CARGO_TARGET_DIR = "C:\projects\cicada-build-tools\target-$commit"
}
# Clear generated installers/signatures so unsigned rebuilds cannot reuse old signatures.
$bundleDir = Join-Path $env:CARGO_TARGET_DIR 'release\bundle'
if (Test-Path $bundleDir) { Remove-Item $bundleDir -Recurse -Force }
Write-Host "==> Building Windows bundle (npm run tauri:build)..."
$override = $null
try {
  if ($env:TAURI_SIGNING_PRIVATE_KEY) {
    npm run tauri:build -- --ci
  } else {
    $override = Join-Path ([System.IO.Path]::GetTempPath()) ("cicada-unsigned-" + [guid]::NewGuid() + ".json")
    '{"bundle":{"createUpdaterArtifacts":false}}' | Set-Content -Encoding utf8NoBOM $override
    npm run tauri:build -- --ci --config $override
  }
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  node scripts/release-artifacts.mjs "$env:CARGO_TARGET_DIR\release\bundle"
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally { if ($override) { Remove-Item $override -ErrorAction SilentlyContinue } }

Write-Host "==> Build complete. Artifacts in:"
Write-Host "    $env:CARGO_TARGET_DIR\release\bundle\"
