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

## Desktop 0.2.2 follow-up acceptance

Application binaries were built from `f0fb20b` on 2026-10-09, using PowerShell 7
and an independent `target-f0fb20b` directory. The running 0.2.1 process was not
closed. Built outputs: portable EXE, x64 MSI, x64 NSIS installer and matching
update signatures. Production frontend export, 142 TypeScript tests, type check,
Lint and Expo compatibility check passed. Two Windows native tests passed
(transaction commit/rollback and an isolated credential-store round trip).

The 12 browser groups passed in Edge: Demo generation/export; matching-ID ledger
switch isolation; delayed month write/delete gates; amount/date input; combined
transaction search/type/tag filtering; unsaved cancel/discard; reviewed profit
recalculation/recovery; deletion return after delayed preview; invalid import
atomicity; settings/recovery export; offline cached reload; and exact preservation
of the main ledger/settings after Demo use. The real HTTPS WebDAV check above
was rerun successfully with all eight groups.

0.2.1 → 0.2.2 upgrade, 0.2.2 reinstall and uninstall passed using isolated NSIS
identifiers with the original compiled EXEs. Installed binary hashes and registry
versions matched, and synthetic profile data survived. All isolated installation
and profile state was cleaned. The production-namespace limitations above apply.

Independent Minisign verification accepted both MSI and NSIS update signatures;
changing one byte in either installer caused verification to fail. The release
manifest refers to the matching NSIS signature and download name, and the flat
artifact directory passes `sha256sum -c SHA256SUMS`. A real published-version
updater download/install is still a release-channel acceptance step; the cryptographic
and mocked consent/draft/installation-lock checks do not replace that end-to-end test.

GitHub checks and review are available from
[the draft pull request](https://github.com/daxmu92/cicada-mobile/pull/2).

## 0.2.3: native desktop regression correction

The earlier browser checks and native SQL unit tests did not validate the bundled
WebView2 application. A user reported loading placeholders, ineffective Settings
controls and a window that would not close. Native diagnosis exposed blocked
`style-src-attr` and `style-src-elem` inline styles and font-loader timeouts:
Tauri's injected style nonces made the fallback `unsafe-inline` ineffective.
This broke runtime styling and visibility of cached navigation screens.

The correction explicitly permits inline style attributes and trusted runtime
style elements; script nonces and the other CSP restrictions remain enabled.
The close listener also needed `core:window:allow-destroy`: Tauri's JavaScript
`onCloseRequested` implementation calls `destroy()` when closing is approved.

Use `npm run test:desktop` on Windows with PowerShell 7 and WebView2 installed.
The test builds a separate app identity and a unique credential-store namespace,
then checks the actual bundled CSP, native SQLite settings saves, navigation,
Demo/main switching, Chinese display, font loading and WM_CLOSE. It does not
read personal credentials or launch against the production database. The Windows
CI runs this check before accepting its build artifacts. Browser checks alone
are not desktop runtime acceptance.

## 0.2.4: cached navigation and no-op synchronization

Home previously fetched the current month's valuation twice, while Assets made
its own reads on every focus. Display settings also bumped the financial
revision and redundantly changed the current language. Query results now share
pending and settled reads by ledger epoch, financial revision and query options;
Home warms the current Assets overview after displaying its own results. Failed
reads are retriable, and financial writes, imports, ledger switches and remote
changes invalidate the cache. Settings have a separate revision; valuation
options remain part of the query key.

A full sync previously applied the entire merged ledger even when it matched
local data. On native SQLite this issued many serialized row writes and delayed
Settings saves and screen reads. The engine now skips identical applications,
canonicalizes record property order across native/browser SQL results, and
still re-reads before upload to retain concurrent local edits. Committed remote
changes notify the UI even when upload fails. Conditional 304 responses also
observe local data, so another desktop process's writes invalidate cached views.

The isolated native smoke additionally asserts that revisiting warm Home and
Assets performs zero financial queries, display-color changes do not reload
financial tables, and synchronizing over 3,000 synthetic snapshots against an
in-memory remote performs zero ledger rewrites while a color save stays under
two seconds. This is a native SQLite/UI contention test, not a test against the
user's cloud account. The separate HTTPS/WebDAV suite exercises real transport,
authentication, ETags, outages, conflicts and convergence. The desktop title
includes its version to identify concurrently open executables.

## 0.2.5: settings failures under another process's write lock

A user reported every preference save failing in 0.2.4. A read-only inspection
found an intact production database and an unresponsive older application still
running. A separate `BEGIN IMMEDIATE`/rollback probe returned `SQLITE_BUSY`;
the production ledger was not changed by this probe. Closing that older process
requires confirmation about unsaved input; a newer executable cannot release
another process's transaction.

Settings now distinguish a busy/locked database from a generic save error and
explain that other Cicada windows, including older versions, must be closed
before retrying. The isolated native test holds a real write lock with a second
SQLite connection, verifies the useful error and unchanged preference, releases
the lock, and verifies that saving succeeds without restarting the application.
This extends the earlier single-process acceptance coverage. It does not forcibly
terminate other applications or change the production ledger.

## 0.2.6: observation, process lifecycle and draft durability

A desktop single-instance plugin is registered before other plugins, as required
by the [official Tauri guide](https://v2.tauri.app/plugin/single-instance/). A
second launch, including a renamed copy with the same application identifier,
restores and focuses the existing window. Versions predating this mechanism do
not participate and must be closed before running the new build. Main-window
destruction exits the application. Native transactions with no query activity
for 60 seconds are periodically dropped and rolled back; active operations keep
refreshing their activity timestamp. Long imports are not limited to 60 seconds
as long as they continue issuing queries.

Native Rust tests cover transaction rollback/commit, abandoned transaction
rollback while retaining active transactions, and isolated credential storage.
The native desktop acceptance additionally minimizes the original window,
launches a renamed copy, checks that the copy exits and the original is restored,
then verifies normal close exits. In its separate ledger namespace it reloads
an unsaved draft, injects a SQLite DELETE-trigger failure, verifies that neither
a financial row nor consumed draft is committed partially, and retries to create
exactly one transaction. It also retains the earlier CSP, settings/lock, cached
navigation, large-ledger sync, language and font checks.

`npm run test:observation` uses a synthetic browser profile to verify coverage,
comparable change and unexplained residual, historical archived totals, shared
months, search/category filtering, shortening a selected chart range safely,
and transaction/snapshot/batch draft recovery across reloads. The legacy browser
and real HTTPS/WebDAV suites remain separate regression checks. Personal-ledger
cloud convergence, mobile device acceptance and published updater installation
remain outside these isolated checks.

## Desktop 0.2.7 navigation and layout

`npm run test:desktop-layout` imports a synthetic ledger, checks sidebar placement,
a single month toolbar, asset inspector/edit routing without losing the list,
batch month ownership, transaction columns and shared month, inline preference
feedback, compact side navigation and narrow-browser bottom tabs. Optional
`CICADA_SCREENSHOTS` stores screenshots of these layouts with synthetic data.
The isolated Windows acceptance checks the actual desktop navigation and useful
inline SQLITE_BUSY feedback, alongside the existing sync/cache/draft/lifecycle
checks. Native mobile device acceptance is still pending.
