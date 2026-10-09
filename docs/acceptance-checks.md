# Acceptance checks

## Actual HTTPS WebDAV

The local integration check runs WsgiDAV/Cheroot over a loopback HTTPS socket,
not a scripted HTTP response. It uses the shipped WebDAV provider, sync engine,
scheduler, migrations and serialized SQLite adapter with two synthetic in-memory
ledgers. The transport adapter is Node HTTPS; this does not validate the Tauri
HTTP plugin, mobile networking or a commercial cloud provider.

Run on Linux with Node, Python 3 and OpenSSL available:

```sh
python3 -m venv .venv-webdav
.venv-webdav/bin/pip install -r scripts/fixtures/requirements-webdav.txt
CICADA_DAV_PYTHON=.venv-webdav/bin/python npm run test:webdav:local
```

The test generates a one-day certificate and a random password in a temporary
directory. Only the test HTTPS agent trusts that certificate; TLS verification
stays enabled and OS trust settings stay unchanged. It stops the server and
removes test storage on completion. No app credentials or personal database are
read. GitHub's Linux check also runs this integration test.

Covered scenarios:

- HTTPS certificate validation and rejected invalid authentication.
- First-device creation and second-device download/convergence.
- Conditional 304 reads, create-only 412 and stale ETag 412.
- Actual server shutdown, retained dirty state, independently edited ledgers
  and recovery after restarting the server with persisted remote storage.
- Another device uploads between read and write: an actual 412 triggers an
  engine retry, preserving both devices' edits.
- A local edit during upload stays dirty and reaches the second device on retry.
- Deleted transactions propagate and remain deleted across repeated syncs.
- A corrupt remote document fails without modifying the local ledger.

## Windows installer acceptance performed on 2026-10-09

Production output was built from commit `c772191`. The production app was running,
so installation tests used copies of the generated NSIS template with isolated
product, executable, manufacturer and bundle identifiers. The original compiled
0.2.0 and 0.2.1 EXEs were embedded unchanged. These tests exercise the generated
installer logic without closing the running application or touching its registry
and data directory. They do not prove installation over an existing production
installation or a production ledger migration.

Results: first install 0.2.0, upgrade to 0.2.1, reinstall 0.2.1 and uninstall passed.
Installed EXEs matched their source hashes; registry versions were correct; the
synthetic profile sentinel survived all operations. Test installation, profile
and registry entries were removed afterwards. No test application was launched.

Generated NSIS silent installation automatically closes a running same-name
process. Before automating a production upgrade, save open edits and close the
app deliberately. Production profile migration and a real cloud provider remain
separate acceptance steps, using a dedicated test environment.

Fixture configuration follows the [official WsgiDAV configuration reference](https://wsgidav.readthedocs.io/en/stable/user_guide_configure.html).
