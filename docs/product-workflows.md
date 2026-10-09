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
pending entry work. OS termination cannot be prevented, and drafts are not
persisted automatically.

## Concurrency and restore

Local repository writes hold the ledger write lock. Maintenance, ledger switches
and update installation acquire the scheduler lock first, then the write lock;
local writes never wait for network sync. Each operation checks its initiating
ledger identity and uses its bound database. Write clocks bind to that same
database. Restore observes imported future clocks before stamping replacement
and deletion records, preventing restored rows from losing to older tombstones.
