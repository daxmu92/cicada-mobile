# Reliability changes

The repair keeps the SQLite domain schema and sync format compatible with existing v1/v2/v3 backups and sync-format v1 clients. Local automatic backups are stored in a separate, unsynced table.

- Imports validate rows, dates, finite amounts, identities and references before touching the ledger. A local recovery copy is saved, and the replacement and its tombstones commit in one transaction. The five latest recovery copies can be exported from Settings. Explicit data erasure also removes them.
- Desktop transactions hold one SQLite connection through native commands. Every transaction callback receives a scoped `CicadaDB`; it must use that argument for database access. Calling the global database from inside a transaction would wait for the transaction and deadlock. A webview reload drops abandoned transactions.
- Background synchronization acknowledges a captured modification revision. Failed uploads and edits made during an upload remain pending. Maintenance and cloud overwrites use the same queue; queued requests resolve after their actual execution.
- Same-name first-connect reconciliation preserves the newer HLC when two identities map onto the same account, asset or snapshot. Remote rows are validated before application, and stale merge records cannot overwrite newer local writes.
- Month summaries, trends and calendars share one valuation policy. Recorded history includes archived assets. Forward-fill applies only to active assets, carries net worth rather than profit/inflow, and is explicitly marked in the overview. Missing months and missing comparisons display a dash rather than a fabricated zero or growth from zero.
- The asset list uses two batched queries instead of queries per asset. Date-indexed transaction queries use month boundaries. Allocation percentages use positive assets, show debt separately and retain omitted assets in an Others bucket.
- New amount inputs accept complete numbers with at most two decimals and properly grouped commas. Computations use integer minor units. Historical signed transaction amounts and stored financial values are preserved on import; they are not silently normalized.
- Desktop credentials use the OS credential store, migrating legacy plaintext config only after secure storage succeeds. WebDAV endpoints require HTTPS; HTTP configurations must reconnect using HTTPS. Requests include body-reading timeouts and a document-size limit.
- The desktop interface uses a two-column overview on wide screens, with stronger text contrast and an explicit account-management entry point. Navigation follows the selected app palette.
- Static serving defaults to loopback. Set `CICADA_WEB_HOST=0.0.0.0` explicitly for LAN development. Malformed URLs return 400, and paths outside `dist/` cannot be served.

## Validation

Independent agent review additionally caught and resolved stale merge resurrection, legacy-setting stamps, month-loading write gates, batch-entry session races, calendar invalidation and allocation-bar scaling. The regression suite now has 132 passing tests, with an Edge check that pauses database requests while changing months.

Run `npm ci`, `npm test`, `npx tsc --noEmit`, `npm run lint` and `npm run export:web`.
For browser regression checks, start `node scripts/serve-web.js 8085`, install Chromium with `node node_modules/playwright-core/cli.js install chromium`, then run `npm run test:web`. On Windows, the check uses the installed Edge browser. `CICADA_WEB_URL` and `CICADA_E2E_BROWSER` can override the URL and executable.

Windows production builds use PowerShell 7 and the dedicated Windows checkout. The build script refuses to reset a checkout with local changes and checks native-command exit codes. CI validates the app and produces Windows bundles; it is only exercised on GitHub after these changes are pushed.

## Release versions

The npm package and desktop/Cargo use 0.2.1 for this patch. The Expo mobile app remains at 1.0.0 to retain the existing EAS `appVersion` runtime policy; desktop and mobile versions are independent. Do not change the mobile runtime version without planning compatible EAS builds and updates.

## Follow-up product work

The existing ledger model uses one common monetary unit. Multi-currency conversion, budgets, linked transfers and end-to-end cloud encryption need separate product and migration work. The previously tracked financial backup is preserved because its source is unconfirmed; new local exports and tool worktrees are ignored.
