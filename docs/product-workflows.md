# Desktop 0.2.2 workflows

## Demo ledger

Settings → Open Demo Ledger switches to independent `cicada-demo.db`. Main data,
settings, recovery copies and cloud configuration remain in `cicada.db`. The
banner identifies Demo; cloud synchronization is disabled there. Display
preferences are copied when entering Demo, then edits are confined to Demo.
Reset Demo replaces only Demo data. Returning restores the main ledger.

Demo selection is tab/session scoped on web and desktop and defaults to main on
native mobile startup. Existing Demo data is retained; clearing it does not
silently regenerate samples. Sample history uses the same cents-based profit
calculation as the application. Search, IDs and draft baselines invalidate when
switching ledgers, including assets sharing the same numeric ID.

## Profit reconciliation

Open an asset → Preview Profit Recalculation. The preview shows changed months,
previous recorded month and old/new profit. The initial snapshot is retained;
later profit is current net worth minus the previous recorded net worth minus
current inflow. Gaps use the preceding recorded snapshot rather than inventing
monthly values. It is a reviewable correction, not an automatic rewrite.

Apply verifies the complete preview source has not changed, saves a local
recovery copy and updates the profit values in one transaction. An edit/import
between preview and application rejects the stale preview. Partial failure rolls
back both the corrections and recovery copy. Snapshot changes offer a preview
when later recorded profits disagree with the updated history.

## Transactions and drafts

Transaction search applies to the selected month and combines notes, tags,
dates and amounts with income/outlay and exact tag filters. Totals and breakdowns
reflect the visible filtered rows. Filters reset when switching ledgers.

Transaction/snapshot forms and asset batch entry warn before leaving unsaved
changes. Saving disables edits. Web refresh/close uses the browser's standard
warning; desktop close confirms before discarding. Month changes invalidate
pending entry work. OS termination cannot be prevented; supported transaction,
snapshot and batch forms offer local draft recovery as described below.

## Concurrency and restore

Local repository writes hold the ledger write lock. Maintenance, ledger switches
and update installation acquire the scheduler lock first, then the write lock;
local writes never wait for network sync. Each operation checks its initiating
ledger identity and uses its bound database. Write clocks bind to that same
database. Restore observes imported future clocks before stamping replacement
and deletion records, preventing restored rows from losing to older tombstones.

## Desktop 0.2.6 observation and recovery

Home, Assets and Insights share a month within each ledger session. A batch-entry
form retains its own month while it is open; changing its month or leaving dirty
input still requires the existing discard confirmation. The overview shows the
latest snapshot and transaction dates, exact-month coverage of currently active
assets, and an explicit action to inspect the latest recorded month. Current
archive status does not reconstruct historical ownership. A missing entry stays
missing unless the existing forward-fill preference is enabled; inferred values
are labeled and do not count as fresh records.

Home compares only assets with actual records in both adjacent months. Net worth,
net inflow and recorded profit reconcile in integer cents, with an unexplained
difference shown separately. This is a comparison of recorded assets, not an
investment-return calculation. The SVG trend retains calendar positions for
missing months and breaks the line. Partial active-asset coverage is marked on
trend points. The month calendar uses the same comparable-asset changes as Home;
months with no actual records show no profit even when old net worth is carried
forward. Assets supports name/account search,
classification filters and name/value sorting; wide windows add column labels
and the most recent recorded month for each asset.

Transactions, individual snapshots and batch entry persist local drafts after
500ms of inactivity. Reopening the same form offers Restore, Inspect or Discard.
Keys are bound to the owning ledger and stable record UUIDs; changed baselines
prevent automatic restoration. Drafts are local SQLite records, excluded from
cloud documents and exports. Erasing or replacing a ledger clears its drafts.
The latest input may not survive an OS termination before its asynchronous save
finishes. Saved financial changes consume their drafts in the same transaction;
failed consumption rolls back the financial change, and partial batch saves
consume only successful items. Timers pause during submission to prevent late
writes from resurrecting consumed drafts.

The sync section shows the actual read/compare/apply/upload/retry stage, the last
attempt and elapsed duration, and actionable error guidance without displaying
raw credentials or server response content.
