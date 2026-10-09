# Build a dedicated namespace; never launch production against a personal ledger.
$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
$stamp=[guid]::NewGuid().ToString('N')
$identifier="com.daxmu.cicada.native-smoke.$stamp"
$fixture=Join-Path ([IO.Path]::GetTempPath()) "cicada-native-smoke-$stamp"
$target=if($env:CARGO_TARGET_DIR){$env:CARGO_TARGET_DIR}else{Join-Path $repo 'src-tauri\target'}
$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
$listener.Start();$port=$listener.LocalEndpoint.Port;$listener.Stop()
$process=$null
try {
 New-Item -ItemType Directory (Join-Path $fixture 'src-tauri') | Out-Null
 foreach($item in @('Cargo.toml','Cargo.lock','build.rs','src','icons','capabilities','tauri.conf.json')){
  Copy-Item (Join-Path $repo "src-tauri\$item") (Join-Path $fixture "src-tauri\$item") -Recurse
 }
 Copy-Item (Join-Path $repo 'dist') (Join-Path $fixture 'dist') -Recurse
 $credentialPath=Join-Path $fixture 'src-tauri\src\credentials.rs'
 $original=Get-Content $credentialPath -Raw
 $needle='Entry::new("com.daxmu.cicada", "webdav")'
 if(-not $original.Contains($needle)){throw 'Credential namespace fixture needs review'}
 $original.Replace($needle,"Entry::new(`"$identifier`", `"webdav`")") | Set-Content -Encoding utf8NoBOM $credentialPath
 $configPath=Join-Path $fixture 'src-tauri\tauri.conf.json'
 $config=Get-Content $configPath -Raw | ConvertFrom-Json
 $config.productName='CicadaNativeSmoke';$config.mainBinaryName='CicadaNativeSmoke';$config.identifier=$identifier
 $config.build.PSObject.Properties.Remove('beforeBuildCommand')
 $config.bundle.createUpdaterArtifacts=$false
 $config.app.windows[0].title='CicadaNativeSmoke'
 $config.app.windows[0] | Add-Member -NotePropertyName additionalBrowserArgs -NotePropertyValue "--remote-debugging-port=$port" -Force
 $config | ConvertTo-Json -Depth 30 | Set-Content -Encoding utf8NoBOM $configPath
 Push-Location $fixture
 try { $env:CARGO_TARGET_DIR=$target; & (Join-Path $repo 'node_modules\.bin\tauri.cmd') build --ci --no-bundle; if($LASTEXITCODE -ne 0){throw 'Native smoke compilation failed'} }
 finally { Pop-Location }
 $process=Start-Process (Join-Path $target 'release\CicadaNativeSmoke.exe') -PassThru
 $env:CICADA_DESKTOP_CDP="http://127.0.0.1:$port"
 node (Join-Path $repo 'scripts\test-desktop.mjs')
 if($LASTEXITCODE -ne 0){throw 'Native desktop acceptance failed'}
 [void]$process.CloseMainWindow()
 if(-not $process.WaitForExit(5000)){throw 'Normal X close did not exit the isolated application'}
 Write-Output 'PASS real native window close via WM_CLOSE'
} finally {
 if($process -and -not $process.HasExited){Stop-Process -Id $process.Id -Force}
 foreach($folder in @($fixture,(Join-Path $env:APPDATA $identifier),(Join-Path $env:LOCALAPPDATA $identifier))){
  if(Test-Path $folder){Remove-Item $folder -Recurse -Force -ErrorAction SilentlyContinue}
 }
}
