# Desktop release preparation

Desktop 0.2.2 includes Tauri's updater. Startup checks the latest public GitHub
release; Settings provides a manual check. An available version is shown as a
banner. Download/install requires confirmation and no dirty or saving draft;
installation waits for synchronization and local writes. The updater validates
its package signature before installation. Windows exits to run the installer.

Endpoint: `https://github.com/daxmu92/cicada-mobile/releases/latest/download/latest.json`.
A draft/prerelease is not a public latest release. Until a stable release is
published, startup failure is quiet and a manual check reports unavailable.

The public verification key is in `src-tauri/tauri.conf.json`. The private key
is stored outside the repository in the owner's protected configuration directory
and in repository Secret `TAURI_SIGNING_PRIVATE_KEY`. Preserve an encrypted backup
of this key: existing clients trust its paired public key. Do not rotate it
casually or put it in Git, release assets or logs. No private key is in this repo.

CI signs update artifacts for authorized repository builds when the Secret is
present. Fork pull requests build ordinary unsigned installers by overriding
`createUpdaterArtifacts:false`; they do not receive the private key. Repository
access and workflow changes therefore control access to update signing.

`scripts/release-artifacts.mjs <bundle-directory> [output-directory]` generates
`build-manifest.json` and `SHA256SUMS`, and `latest.json` only when an x64 NSIS
installer has its matching `.sig`. Release assets must include that exact
installer, signature and manifest under tag `v<desktop-version>`. Renaming an
installer requires regenerating the manifest URL. Never publish a manifest before
its installer exists. Keep previous releases available for manual recovery.

The update package signature proves integrity for this application. Windows
Authenticode (trusted publisher/SmartScreen) uses a different certificate and is
not configured: no valid local code-signing certificate was available. Real
cloud WebDAV acceptance also requires a dedicated cloud account/configuration;
the actual local HTTPS server acceptance covers protocol behavior only.

References: [Tauri updater](https://v2.tauri.app/plugin/updater/) and
[Windows code signing](https://v2.tauri.app/distribute/sign/windows/).
