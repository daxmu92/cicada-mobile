# Analysis / 分析 Tab — Design

**Date:** 2026-06-22
**Status:** Approved (brainstorming) — ready for implementation plan
**Context:** Chunk ③ of the Warm Slate UI redesign. Chunks ① (design system + hero home + trends) and ② (chart tooltips + stock/flow asset detail) are shipped on `master`.
**Revision:** v2 — incorporates a 4-agent review (feasibility / design / consistency / UX+bugs). Notable changes from v1: trend now anchors to the selected month (was "latest"); donut center shows the positive charted subtotal (was true net worth); color/sort/cap centralized in `composition.ts`; `MonthSelector` gains a `disablePicker` prop; several API signatures corrected.

## Goal

Add a new bottom tab「分析 / Insights」(making five tabs total) that consolidates the net-worth trend, asset composition, and the year calendar into one analytical dashboard. This absorbs the standalone `/trends` route (which currently only hosts the year calendar), so neither idea is sparse.

## Non-goals

- No new persistence: read-only over existing snapshots/assets/accounts. No schema change, no new tables.
- No new chart library: reuse `react-native-gifted-charts` (its `PieChart` for the donut).
- No year-over-year comparison, forecasting, or export in this chunk (possible later).

## Navigation & routing

- New screen `app/(tabs)/analysis.tsx`. Tab order becomes: **Home · Assets · 分析 · Transactions · Settings** (inserted between `assets` and `transactions`).
- Tab icon: Ionicons `analytics` (verified valid; no collision — Assets uses `pie-chart`). Label via i18n `nav.analysis` (分析 / Insights).
- **Delete** `app/trends.tsx`; its `YearCalendar` usage moves into the new tab.
- Home's trends entry link (`app/(tabs)/index.tsx:135-136`) repoints from `/trends` to `/analysis` using **`router.navigate`** (not `push`, to avoid stacking a tab route), relabeled `home.viewAnalysis`. The `→` arrow stays appended in JSX (existing convention), not baked into the string.

## Page structure

Single `ScrollView`, top → bottom:

1. **MonthSelector** — the shared component used by Home/Assets, driving the page's `selectedMonth`. **On this page its center-tap year-picker modal is suppressed** via a new optional `disablePicker` prop (default off elsewhere — the component is NOT forked; Home/Assets keep their center-tap-opens-calendar behavior per the deliberate design). Rationale: this page already renders a `YearCalendar` inline (card 4), so the modal would be the same widget twice.
2. **Net-worth trend card** — `NetWorthTrendChart` with a `1Y / 3Y / All` chip toggle, **anchored to `selectedMonth`** (matches Home): 1Y = the 12 months ending at `selectedMonth`, 3Y = 36 months, All = full history. The rightmost point is always the selected month, so no special marker is needed (no `NetWorthTrendChart` change required). Scrubbing the MonthSelector pans the chart.
3. **Composition card** — a horizontally-scrollable dimension chip row `[按账户] Risk Type …` (auto-discovered; "By Account" always first), then a donut, then a ranked legend list (`AllocationBarList`). Computed **at `selectedMonth`**. Tapping a slice highlights its legend row (matched by stable bucket key).
4. **Year calendar card** — `YearCalendar` for `selectedMonth`'s year (it self-fetches monthly net-growth, unchanged). Tapping a month **sets the page's `selectedMonth`** (stays on the tab). It re-renders to the new year automatically when `selectedMonth` jumps years (existing effect).

## Composition dimensions

Assets carry `categories: Record<string, string>` (free-form key/value, e.g. `{ Risk: "中", Type: "股票" }`) plus an owning account name.

- Dimension list is **data-driven**: always offer "By Account" (first), then one dimension per distinct category key present across the non-archived assets, in deterministic order (keys sorted alphabetically).
- For a chosen category dimension, assets missing that key are grouped into an "未分类 / Uncategorized" bucket.
- Values are the asset net worths at `selectedMonth` (see Data flow for forward-fill).

## Code units

**New**

- `app/(tabs)/analysis.tsx` — screen. Owns state: `selectedMonth`, `trendRange` (`'1Y' | '3Y' | 'All'`), `donutDimension` (string). Loads data on focus (`useFocusEffect`), per the codebase convention. Responsible for: deriving the trend window, joining snapshots↔assets for composition, and feeding already-colored/sorted items to both donut and legend.
- `src/components/charts/CompositionDonut.tsx` — gifted-charts `PieChart` (`donut`, `innerRadius`, `centerLabelComponent` rendering own `<Text>`, `onPress`/`focusOnPress`/`focusedPieIndex`). Props: `items: AllocationItem[]` (pre-sorted, each with explicit `color`), `centerPrimary` (charted subtotal), `centerSecondary?` (e.g. true net-worth line + excluded-liabilities caption), `onSlicePress(key)`. Replicates the empty guard (`total <= 0` → `charts.noDataToDisplay`) and the distinct "no positive holdings" state (see Error states). Dumb/swappable: only renders `{value, color}` pairs.
- `src/utils/composition.ts` — **pure** (no DB import). Input: `items: Array<{ assetId: number; accountName: string; categories: Record<string,string>; netWorth: number }>` (the screen builds this by joining the month's forward-filled snapshots with `listAssets()`). Exposes `dimensions(items): string[]` and `itemsFor(items, dimension): { slices: AllocationItem[]; chartedTotal: number; trueTotal: number; excludedLiabilities: number }`. Within `itemsFor`: group by dimension, sum net worth per bucket, drop ≤0 buckets from `slices`, sort descending, cap to top **7** with the remainder folded into an "其他 / Others" bucket (so donut and legend show an identical ≤8 set), assign `color` from `categoryPalette` by final index, and stamp a stable `key` per slice (the bucket identity, distinct from display label). `forwardFill` is NOT a parameter (purity).
- `src/utils/date.ts` — add `minusMonths(ym: string, n: number): string` (the spec's 1Y/3Y anchoring; no existing helper does this). Used to derive the trend window start by subtracting N-1 months from `selectedMonth`.

**Changed**

- `app/(tabs)/_layout.tsx` — register `<Tabs.Screen name="analysis">` between `assets` and `transactions`.
- `app/(tabs)/index.tsx` — repoint + relabel the trends entry link (see Navigation).
- `src/components/MonthSelector.tsx` — add optional `disablePicker?: boolean` that makes the center label non-interactive (no modal). Default false; Home/Assets unaffected.
- `src/components/charts/AllocationBarList.tsx` — add optional `highlightKey?` (and a `keyOf?`/stable-key path) plus a highlighted-row style; respect each item's explicit `color` (it already does: `item.color ?? PALETTE[index]`) and the caller's order. Confirm Home renders identically (no `highlightKey` passed). Note: it currently re-sorts and caps at `maxItems=8` — the screen passes items already sorted and pre-capped to the same set the donut uses, so the two views agree.
- `src/i18n/locales/{en,zh}.json` — see i18n section.
- `app/trends.tsx` — deleted.

**Reused as-is**

- `NetWorthTrendChart` (props `{ points, color?, height? }`; takes any point count; `<2` points renders blank — the screen guards with an empty state).
- `YearCalendar` (`{ selected, onChange }`; month tap emits `YYYY-MM`).

## Data flow

- **Trend:** derive `[start, end]` from `trendRange` and `selectedMonth` — 1Y → `minusMonths(selectedMonth, 11)`..`selectedMonth`; 3Y → `minusMonths(selectedMonth, 35)`; All → `getDateRange()` (`{start,end}|null`). Then `getMonthlyTotals(start, end)` → `TrendPoint[]` → `NetWorthTrendChart`. Missing months are **gaps** (the GROUP BY only returns months with data; the line connects across them). If `<2` points, show `charts.noDataToDisplay` instead of the chart.
- **Composition:** `listSnapshotsByDate(selectedMonth, { forwardFill })` returns `SnapshotWithAsset` (carries `accountName` but **not** `categories`). The screen also calls `listAssets({ includeArchived: false })` and joins on `assetId` to attach `categories`, producing `composition.ts`'s input array. forward-fill (when the setting is on) carries an asset's last-known value into months with no snapshot and skips assets with no prior history — consistent with Home (`index.tsx:54`). The composition helper does not re-fill.
- All queries are read-only and already exist in `snapshot-repo` / `asset-repo`.

## Error / empty states

- **No snapshots at all** → each card shows `charts.noDataToDisplay`.
- **Donut center:** the donut charts only **positive** buckets; the center shows the **positive charted subtotal** (what the slices sum to), so legend percentages (% of that subtotal) are internally consistent. Below it, a muted secondary line shows the **true net worth** (sum incl. liabilities) and, if any negative buckets were excluded, an `analysis.excludedLiabilities` footnote with `{{count}}`. This avoids the v1 mismatch (percentages of one total shown next to a different center number).
- **All buckets ≤ 0 (pure liabilities / no positive holdings)** → the donut is empty but this is NOT the "no data" state: show the center true-net-worth number with an `analysis.noPositiveHoldings` caption, distinct from the genuine no-snapshot empty.
- **Single bucket** → one full-circle slice + one legend row. Fine.
- **`selectedMonth` before the first snapshot** → forward-fill finds no prior history, so composition is empty → show the no-positive/empty caption; trend/calendar may still show data for other months (acceptable, documented).
- **Future `selectedMonth`** → forward-fill synthesizes each asset's latest value (plausible but synthetic; acceptable/intended).

## Testing / verification

- No UI test runner in the repo. Verify with `npx tsc --noEmit` + `npm run lint`.
- `src/utils/composition.ts` is pure and **gets a Node test** (`node --test`, the repo's `src/**/*.test.ts` pattern) covering: account grouping; category grouping; missing-key → 未分类; negative-bucket exclusion + `excludedLiabilities` count; top-7 + 其他 capping; deterministic dimension/slice ordering; stable keys; charted vs true total.
- `src/utils/date.ts` `minusMonths` gets a small test (year rollover, n=0, large n).
- Visual verification via the `npm run screenshot` headless-Chromium harness with sample data (24 months, 6 assets), across the three donut dimensions and the three trend ranges, plus a liability-bearing dataset for the negative-bucket/center states.

## i18n keys

**Add** (`en.json` + `zh.json`):
- `nav.analysis` — `"Insights"` / `"分析"`
- `home.viewAnalysis` — `"View full analysis"` / `"查看分析"` (no trailing `→`; appended in JSX)
- `analysis.composition`, `analysis.byAccount`, `analysis.uncategorized`, `analysis.others`, `analysis.trendTitle`, `analysis.netWorthTrue` (label for the true-net-worth secondary line), `analysis.excludedLiabilities` (with `{{count}}`), `analysis.noPositiveHoldings`, `analysis.calendarIntro` (replaces the deleted `trends.yearIntro`, if intro text is kept).
- Range labels `1Y / 3Y / All` are hardcoded (language-neutral); no i18n keys.

**Remove** (after the Home link is repointed — grep both locales first to avoid dangling refs):
- `nav.trends`, the entire `trends` block (`trends.yearIntro`), and `home.viewTrends`.

## Open / defaulted points (low risk)

- Top-N cap = 7 (+其他) is a default; easy to tune.
- Tab position (3rd) and icon (`analytics`) are defaults; trivial to change.
