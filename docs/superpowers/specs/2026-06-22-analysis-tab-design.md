# Analysis / 分析 Tab — Design

**Date:** 2026-06-22
**Status:** Approved (brainstorming) — ready for implementation plan
**Context:** Chunk ③ of the Warm Slate UI redesign. Chunks ① (design system + hero home + trends) and ② (chart tooltips + stock/flow asset detail) are shipped on `master`.

## Goal

Add a new bottom tab「分析 / Insights」(making five tabs total) that consolidates the net-worth trend, asset composition, and the year calendar into one analytical dashboard. This absorbs the standalone `/trends` route (which currently only hosts the year calendar), so neither idea is sparse.

## Non-goals

- No new persistence: read-only over existing snapshots/assets/accounts. No schema change, no new tables.
- No new chart library: reuse `react-native-gifted-charts` (its `PieChart` for the donut).
- No year-over-year comparison, forecasting, or export in this chunk (possible later).

## Navigation & routing

- New screen `app/(tabs)/analysis.tsx`. Tab order becomes: **Home · Assets · 分析 · Transactions · Settings** (3rd position, grouped with the financial-overview tabs).
- Tab icon: Ionicons `analytics`. Label via i18n `nav.analysis` (分析 / Insights).
- **Delete** `app/trends.tsx`; its `YearCalendar` usage moves into the new tab.
- Home's trends entry link repoints from `/trends` to `/analysis` and is relabeled `home.viewAnalysis` ("查看分析 →").

## Page structure

Single `ScrollView`, top → bottom:

1. **MonthSelector** — the shared component already used by Home/Assets. Drives the page's `selectedMonth`. Its center-tap year-picker behavior is kept (shared component; not forked). It is slightly redundant with the calendar below but harmless; can be suppressed later via a prop if it feels off.
2. **Net-worth trend card** — `NetWorthTrendChart` with a `1Y / 3Y / All` chip toggle. **Anchored to the latest data**, independent of `selectedMonth`: 1Y = last 12 months, 3Y = last 36, All = full history. The `selectedMonth` is marked on the line.
3. **Composition card** — a dimension chip row `[按账户] Risk Type …` (auto-discovered), then a donut with the period total in its center, then a ranked legend list (label, value, %) reusing `AllocationBarList`. Computed **at `selectedMonth`**. Tapping a slice highlights its legend row.
4. **Year calendar card** — `YearCalendar` for `selectedMonth`'s year. Tapping a month **sets the page's `selectedMonth`** (stays on the tab; no navigation away).

## Composition dimensions

Assets carry `categories: Record<string, string>` (free-form key/value, e.g. `{ Risk: "中", Type: "股票" }`) plus an owning account.

- Dimension list is **data-driven**: always offer "By Account", then one dimension per distinct category key present across the (non-archived) assets.
- For a chosen category dimension, assets missing that key are grouped into an "未分类 / Uncategorized" slice.
- Values are the asset net worths at `selectedMonth`, honoring the user's `forwardFill` setting (via the snapshot query helper's `{ forwardFill }` option).

## Code units

**New**

- `app/(tabs)/analysis.tsx` — screen. Owns state: `selectedMonth`, `trendRange` (`'1Y' | '3Y' | 'All'`), `donutDimension` (string). Loads data on focus (`useFocusEffect`), per the codebase convention (no global store).
- `src/components/charts/CompositionDonut.tsx` — gifted-charts `PieChart` donut: center total, slice-press → emits the pressed item so the screen can highlight the matching legend row. Slice colors from `categoryPalette` in `theme.ts`.
- `src/utils/composition.ts` — pure helper. Input: assets + the month's snapshots (+ `forwardFill`). Output: `{ dimensions: string[]; itemsFor(dimension): AllocationItem[] }`, including the 未分类 bucket. Unit-testable in isolation (no DB import; takes data in).

**Reused as-is**

- `NetWorthTrendChart` (already takes `TrendPoint[]` + axes + tooltip) — the screen just feeds it the range's points.
- `AllocationBarList` — the donut's ranked legend.
- `YearCalendar`, `MonthSelector`.

**Changed**

- `app/(tabs)/_layout.tsx` — register the new tab in 3rd position.
- `app/(tabs)/index.tsx` — repoint + relabel the trends entry link.
- `app/trends.tsx` — deleted.
- `src/i18n/locales/{en,zh}.json` — add `nav.analysis`, `analysis.*` (`composition`, `byAccount`, `uncategorized`, `trendTitle`, range labels `1Y`/`3Y`/`All`), `home.viewAnalysis`. Remove now-unused `nav.trends` / `trends.*`.

## Data flow

- **Trend:** `getMonthlyTotals(range)` (backed by `getDateRange` for "All") → `TrendPoint[]` → `NetWorthTrendChart`.
- **Composition:** `listSnapshotsByDate(selectedMonth, { forwardFill })` joined with asset (account + categories) → `composition.ts` groups by the chosen dimension → donut + legend.
- All queries are read-only and already exist in `snapshot-repo` / `asset-repo`.

## Error / empty states

- No snapshots at all → each card shows the existing `charts.noDataToDisplay` empty text (consistent with current charts).
- A dimension with a single bucket (e.g. all assets uncategorized) → a single full-circle slice; legend shows one row. Acceptable.
- Negative/liability assets in composition: net worth can be negative, and a donut cannot render negative shares. Rule: **slices are built only from assets/buckets with positive net worth at `selectedMonth`**; the center total still shows true net worth (sum of all, including negatives). Excluded negative contributors are not drawn as slices; if any exist, the legend appends a muted footnote (e.g. "未含 N 项负债"). This guarantees a well-formed donut whose slices always sum to the positive total.

## Testing / verification

- No UI test runner in the repo. Verify with `npx tsc --noEmit` + `npm run lint`.
- `src/utils/composition.ts` is pure and **gets a Node test** (`node --test`, the repo's existing pattern under `src/**/*.test.ts`) covering: account grouping, category grouping, missing-key → 未分类, and the negative-value rule.
- Visual verification via the `npm run screenshot` headless-Chromium harness with sample data (24 months, 6 assets), across the three donut dimensions and the three trend ranges.

## Open / defaulted points (low risk)

- Tab position (3rd) and icon (`analytics`) are defaults; trivial to change.
- MonthSelector center-tap redundancy (see Page structure §1) — kept for now.
