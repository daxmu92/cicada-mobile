# Analysis / 分析 Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 5th bottom tab「分析 / Insights」consolidating a net-worth trend (1Y/3Y/All), a composition donut (by account or category), and the year calendar into one dashboard, absorbing the standalone `/trends` route.

**Architecture:** A new screen `app/(tabs)/analysis.tsx` owns state (`selectedMonth`, `trendRange`, `donutDimension`) and loads data on focus, reusing existing repos. Grouping logic lives in a pure, node-tested helper `src/utils/composition.ts` (no DB/RN/i18n imports — colors assigned by the screen). Two existing components gain small optional props (`MonthSelector.disablePicker`, `AllocationBarList.highlightKey`); one new presentational component `CompositionDonut` wraps gifted-charts `PieChart`. The trend and calendar reuse existing components unchanged.

**Tech Stack:** Expo Router (typed file routes), React Native, TypeScript (strict), react-i18next, react-native-gifted-charts (`LineChart`, `PieChart`), `node:test` + `tsx` for pure-unit tests.

## Global Constraints

- TypeScript strict; verify every task with `npx tsc --noEmit` and `npm run lint` (there is NO UI test runner — only pure modules under `src/**/*.test.ts` get `node --test`).
- `src/utils/composition.ts` MUST NOT import from `react-native`, `./theme`, or i18n — it must load under plain `node --import tsx --test`. Pass display strings and colors in from the caller.
- Money formatting via `useFormat().fmt`; categorical colors via `categoryPalette` from `src/utils/theme.ts`; never inline-format or inline-color.
- Month strings are `"YYYY-MM"`; compare/sort lexically. Use helpers in `src/utils/date.ts`.
- Screens reload data on focus (`useFocusEffect`) — no global store.
- `MonthSelector` is shared by Home/Assets; do NOT change its default behavior (center-tap opens the year picker). Only add an opt-in prop.
- i18n: add keys to BOTH `src/i18n/locales/en.json` and `zh.json`; the `→` arrow is appended in JSX, never baked into a string.

---

## File Structure

- `src/utils/date.ts` — add `minusMonths(ym, n)`.
- `src/utils/date.test.ts` — **new**, node test for `minusMonths`.
- `src/utils/composition.ts` — **new**, pure grouping logic.
- `src/utils/composition.test.ts` — **new**, node test.
- `package.json` — add the two test files to the `test` script.
- `src/i18n/locales/{en,zh}.json` — add `analysis.*`, `nav.analysis`, `home.viewAnalysis`; remove `nav.trends`, `trends.*`, `home.viewTrends` (Task 8, after the link repoint).
- `src/components/MonthSelector.tsx` — add `disablePicker?: boolean`.
- `src/components/charts/AllocationBarList.tsx` — add `key?` to `AllocationItem`, `highlightKey?` prop + active-row style.
- `src/components/charts/CompositionDonut.tsx` — **new**.
- `app/(tabs)/analysis.tsx` — **new** screen.
- `app/(tabs)/_layout.tsx` — register the `analysis` tab between `assets` and `transactions`.
- `app/(tabs)/index.tsx` — repoint trends link to `/analysis`.
- `app/trends.tsx` — **delete**.

---

## Task 1: `minusMonths` date helper

**Files:**
- Modify: `src/utils/date.ts` (append after `prevYearMonth`/`nextYearMonth`)
- Test: `src/utils/date.test.ts` (new)

**Interfaces:**
- Produces: `minusMonths(ym: string, n: number): string` — subtracts `n` months from a `"YYYY-MM"` string (n=0 → identity), handling year rollover.

- [ ] **Step 1: Write the failing test**

Create `src/utils/date.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert';
import { minusMonths } from './date';

test('minusMonths subtracts within a year', () => {
  assert.equal(minusMonths('2026-06', 3), '2026-03');
});
test('minusMonths rolls over the year boundary', () => {
  assert.equal(minusMonths('2026-02', 3), '2025-11');
});
test('minusMonths with n=0 is identity', () => {
  assert.equal(minusMonths('2026-06', 0), '2026-06');
});
test('minusMonths 1Y window (11) and 3Y window (35)', () => {
  assert.equal(minusMonths('2026-06', 11), '2025-07');
  assert.equal(minusMonths('2026-06', 35), '2023-07');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- src/utils/date.test.ts` (or `node --import tsx --test src/utils/date.test.ts`)
Expected: FAIL — `minusMonths` is not exported.

- [ ] **Step 3: Implement the helper**

In `src/utils/date.ts`, after `nextYearMonth`:
```ts
export function minusMonths(ym: string, n: number): string {
  let cur = ym;
  for (let i = 0; i < n; i++) cur = prevYearMonth(cur);
  return cur;
}
```

- [ ] **Step 4: Wire the test into the `test` script**

In `package.json`, append ` src/utils/date.test.ts` to the end of the `"test"` command's file list.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --import tsx --test src/utils/date.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/utils/date.ts src/utils/date.test.ts package.json
git commit -m "feat(date): add minusMonths helper for trend range windows"
```

---

## Task 2: `composition.ts` pure grouping helper

**Files:**
- Create: `src/utils/composition.ts`
- Create: `src/utils/composition.test.ts`
- Modify: `package.json` (test script)

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `ACCOUNT_DIMENSION: string` (the sentinel for "By Account").
  - `type CompositionInput = { assetId: number; accountName: string; categories: Record<string,string>; netWorth: number }`
  - `type CompositionSlice = { key: string; label: string; value: number }`
  - `type CompositionResult = { slices: CompositionSlice[]; chartedTotal: number; trueTotal: number; excludedCount: number }`
  - `compositionDimensions(items: CompositionInput[]): string[]`
  - `compositionSlices(items: CompositionInput[], dimension: string, labels: { uncategorized: string; others: string }): CompositionResult`
- Rules: dimensions = `[ACCOUNT_DIMENSION, ...sorted category keys present]`. Buckets aggregate `netWorth`. Only buckets with `value > 0` are charted, sorted desc, capped to 8 (top 7 + an "others" bucket). `chartedTotal` = sum of slices; `trueTotal` = sum of ALL inputs (incl. negatives); `excludedCount` = number of net ≤0 buckets dropped. The screen assigns colors by slice index.

- [ ] **Step 1: Write the failing test**

Create `src/utils/composition.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert';
import {
  ACCOUNT_DIMENSION,
  compositionDimensions,
  compositionSlices,
  type CompositionInput,
} from './composition';

const LBL = { uncategorized: 'Uncat', others: 'Others' };

const sample: CompositionInput[] = [
  { assetId: 1, accountName: 'Bank', categories: { Risk: 'Low', Type: 'Cash' }, netWorth: 100 },
  { assetId: 2, accountName: 'Bank', categories: { Risk: 'Low', Type: 'Bond' }, netWorth: 50 },
  { assetId: 3, accountName: 'Broker', categories: { Risk: 'High' }, netWorth: 200 },
  { assetId: 4, accountName: 'Broker', categories: {}, netWorth: 30 },
];

test('dimensions: account first, then sorted category keys present', () => {
  assert.deepEqual(compositionDimensions(sample), [ACCOUNT_DIMENSION, 'Risk', 'Type']);
});

test('group by account sums net worth and sorts desc', () => {
  const r = compositionSlices(sample, ACCOUNT_DIMENSION, LBL);
  assert.deepEqual(r.slices.map((s) => [s.label, s.value]), [['Broker', 230], ['Bank', 150]]);
  assert.equal(r.chartedTotal, 380);
  assert.equal(r.trueTotal, 380);
  assert.equal(r.excludedCount, 0);
});

test('group by category with missing key falls into uncategorized', () => {
  const r = compositionSlices(sample, 'Type', LBL);
  const byLabel = Object.fromEntries(r.slices.map((s) => [s.label, s.value]));
  assert.equal(byLabel['Cash'], 100);
  assert.equal(byLabel['Bond'], 50);
  assert.equal(byLabel['Uncat'], 230); // assets 3 and 4 lack "Type"
});

test('net-negative buckets are excluded; trueTotal keeps them', () => {
  const items: CompositionInput[] = [
    { assetId: 1, accountName: 'Bank', categories: {}, netWorth: 100 },
    { assetId: 2, accountName: 'Loan', categories: {}, netWorth: -40 },
  ];
  const r = compositionSlices(items, ACCOUNT_DIMENSION, LBL);
  assert.deepEqual(r.slices.map((s) => s.label), ['Bank']);
  assert.equal(r.chartedTotal, 100);
  assert.equal(r.trueTotal, 60);
  assert.equal(r.excludedCount, 1);
});

test('caps to 8 slices with an others bucket', () => {
  const items: CompositionInput[] = Array.from({ length: 10 }, (_, i) => ({
    assetId: i,
    accountName: `A${String(i).padStart(2, '0')}`,
    categories: {},
    netWorth: 100 - i, // descending 100..91
  }));
  const r = compositionSlices(items, ACCOUNT_DIMENSION, LBL);
  assert.equal(r.slices.length, 8);
  assert.equal(r.slices[7].label, 'Others');
  // others = sum of the 3 smallest (93+92+91)
  assert.equal(r.slices[7].value, 276);
  assert.equal(r.chartedTotal, items.reduce((s, x) => s + x.netWorth, 0));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test src/utils/composition.test.ts`
Expected: FAIL — module not found / exports undefined.

- [ ] **Step 3: Implement `src/utils/composition.ts`**

```ts
// Pure grouping logic for the Analysis tab's composition donut.
// NO imports from react-native / ./theme / i18n — must run under `node --test`.
// The caller supplies display strings (uncategorized/others) and assigns colors
// by slice index, keeping this module pure and unit-testable.

export const ACCOUNT_DIMENSION = '__account__';

export type CompositionInput = {
  assetId: number;
  accountName: string;
  categories: Record<string, string>;
  netWorth: number;
};

export type CompositionSlice = {
  key: string; // stable bucket identity (NOT the display label)
  label: string; // display text
  value: number;
};

export type CompositionResult = {
  slices: CompositionSlice[]; // positive buckets, sorted desc, capped to 8
  chartedTotal: number; // sum of slice values (the positive subtotal)
  trueTotal: number; // sum of ALL inputs incl. negatives
  excludedCount: number; // net <= 0 buckets not charted
};

const MAX_SLICES = 8;
const UNCAT_KEY = '__uncat__';
const OTHERS_KEY = '__others__';

/** Distinct dimensions: account first, then sorted category keys present. */
export function compositionDimensions(items: CompositionInput[]): string[] {
  const keys = new Set<string>();
  for (const it of items) {
    for (const k of Object.keys(it.categories)) {
      const v = it.categories[k];
      if (v != null && v !== '') keys.add(k);
    }
  }
  return [ACCOUNT_DIMENSION, ...[...keys].sort()];
}

export function compositionSlices(
  items: CompositionInput[],
  dimension: string,
  labels: { uncategorized: string; others: string }
): CompositionResult {
  const buckets = new Map<string, { label: string; value: number }>();
  let trueTotal = 0;

  for (const it of items) {
    trueTotal += it.netWorth;
    let key: string;
    let label: string;
    if (dimension === ACCOUNT_DIMENSION) {
      key = `acc:${it.accountName}`;
      label = it.accountName;
    } else {
      const v = it.categories[dimension];
      if (v == null || v === '') {
        key = UNCAT_KEY;
        label = labels.uncategorized;
      } else {
        key = `cat:${v}`;
        label = v;
      }
    }
    const b = buckets.get(key);
    if (b) b.value += it.netWorth;
    else buckets.set(key, { label, value: it.netWorth });
  }

  const all = [...buckets.entries()].map(([key, b]) => ({ key, label: b.label, value: b.value }));
  const positives = all.filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const excludedCount = all.length - positives.length;

  let slices: CompositionSlice[] = positives;
  if (positives.length > MAX_SLICES) {
    const head = positives.slice(0, MAX_SLICES - 1);
    const tail = positives.slice(MAX_SLICES - 1);
    const othersValue = tail.reduce((sum, s) => sum + s.value, 0);
    slices = [...head, { key: OTHERS_KEY, label: labels.others, value: othersValue }];
  }

  const chartedTotal = slices.reduce((sum, s) => sum + s.value, 0);
  return { slices, chartedTotal, trueTotal, excludedCount };
}
```

- [ ] **Step 4: Wire the test into the `test` script**

In `package.json`, append ` src/utils/composition.test.ts` to the `"test"` command's file list.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --import tsx --test src/utils/composition.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/utils/composition.ts src/utils/composition.test.ts package.json
git commit -m "feat(composition): pure grouping helper for the composition donut"
```

---

## Task 3: i18n keys (add)

**Files:**
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/zh.json`

**Interfaces:**
- Produces: translation keys `nav.analysis`, `home.viewAnalysis`, and an `analysis` block: `composition`, `byAccount`, `uncategorized`, `others`, `trendTitle`, `netWorthTrue`, `excludedLiabilities` (with `{{count}}`), `noPositiveHoldings`, `calendarIntro`.

*(Removal of the now-orphaned `trends.*`/`nav.trends`/`home.viewTrends` keys happens in Task 8, after the Home link is repointed, to avoid a missing-key flash.)*

- [ ] **Step 1: Add keys to `en.json`**

Add to the `nav` object: `"analysis": "Insights"`. Add to the `home` object: `"viewAnalysis": "View full analysis"`. Add a new top-level `analysis` block:
```json
"analysis": {
  "composition": "Composition",
  "byAccount": "By account",
  "uncategorized": "Uncategorized",
  "others": "Others",
  "trendTitle": "Net worth trend",
  "netWorthTrue": "Net worth",
  "excludedLiabilities": "Excludes {{count}} net-negative group(s)",
  "noPositiveHoldings": "No positive holdings to chart",
  "calendarIntro": "Tap a month to view it."
}
```

- [ ] **Step 2: Add the same keys to `zh.json`**

`nav.analysis`: `"分析"`. `home.viewAnalysis`: `"查看分析"`. New `analysis` block:
```json
"analysis": {
  "composition": "构成",
  "byAccount": "按账户",
  "uncategorized": "未分类",
  "others": "其他",
  "trendTitle": "净值趋势",
  "netWorthTrue": "净值",
  "excludedLiabilities": "未含 {{count}} 个负向分组",
  "noPositiveHoldings": "暂无正值持仓可展示",
  "calendarIntro": "点击月份查看。"
}
```

- [ ] **Step 3: Verify JSON validity + typecheck**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/en.json','utf8')); JSON.parse(require('fs').readFileSync('src/i18n/locales/zh.json','utf8')); console.log('ok')"`
Then: `npx tsc --noEmit`
Expected: `ok` and no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/en.json src/i18n/locales/zh.json
git commit -m "i18n: add analysis tab keys"
```

---

## Task 4: `MonthSelector.disablePicker` prop

**Files:**
- Modify: `src/components/MonthSelector.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `MonthSelector` accepts optional `disablePicker?: boolean`. When true, the center label is non-interactive and the year-picker `Modal` is not rendered. Default false (Home/Assets unchanged).

- [ ] **Step 1: Add the prop and gate the label + modal**

In `src/components/MonthSelector.tsx`:
- Extend `Props`:
```ts
type Props = {
  value: string;
  onChange: (ym: string) => void;
  disablePicker?: boolean;
};
```
- Update the signature: `export function MonthSelector({ value, onChange, disablePicker = false }: Props) {`
- Replace the center label `TouchableOpacity` so it does not open the picker when disabled, and skip the `Modal` entirely when disabled:
```tsx
<TouchableOpacity
  style={styles.label}
  disabled={disablePicker}
  onPress={() => setPickerOpen(true)}>
  <Text style={styles.labelText}>{formatMonthYear(value, locale)}</Text>
</TouchableOpacity>
```
And wrap the existing `<Modal>...</Modal>` so it only renders when `!disablePicker`:
```tsx
{!disablePicker && (
  <Modal
    visible={pickerOpen}
    /* ...unchanged... */
  >
    {/* ...unchanged... */}
  </Modal>
)}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/MonthSelector.tsx
git commit -m "feat(month-selector): add disablePicker to suppress the year-picker modal"
```

---

## Task 5: `AllocationBarList` highlight support

**Files:**
- Modify: `src/components/charts/AllocationBarList.tsx`

**Interfaces:**
- Consumes: `AllocationItem` (now `{ label: string; value: number; color?: string; key?: string }`).
- Produces: `AllocationBarList` accepts optional `highlightKey?: string`; the row whose `item.key ?? item.label` equals `highlightKey` renders with an active background. Existing callers (Home) pass neither `key` nor `highlightKey` and look identical.

- [ ] **Step 1: Extend the item type and props**

In `src/components/charts/AllocationBarList.tsx`:
- Add `key?: string;` to the `AllocationItem` type.
- Extend `Props`:
```ts
type Props = {
  items: AllocationItem[];
  maxItems?: number;
  highlightKey?: string;
};
export function AllocationBarList({ items, maxItems = 8, highlightKey }: Props) {
```

- [ ] **Step 2: Apply the active style and stable key**

Replace the `visible.map(...)` row open so it keys by the stable id and tints the active row:
```tsx
{visible.map((item, index) => {
  const pct = (item.value / total) * 100;
  const barWidth = maxValue > 0 ? (item.value / maxValue) * 100 : 0;
  const color = item.color ?? PALETTE[index % PALETTE.length];
  const rowKey = item.key ?? item.label;
  const isActive = highlightKey != null && rowKey === highlightKey;

  return (
    <View key={rowKey} style={[styles.row, isActive && styles.rowActive]}>
```
Add to the `StyleSheet`:
```ts
rowActive: {
  backgroundColor: colors.track,
  borderRadius: 8,
  paddingHorizontal: spacing.sm,
  paddingVertical: spacing.xs,
  marginHorizontal: -spacing.sm,
},
```

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/charts/AllocationBarList.tsx
git commit -m "feat(allocation-list): optional highlightKey + stable row key"
```

---

## Task 6: `CompositionDonut` component

**Files:**
- Create: `src/components/charts/CompositionDonut.tsx`

**Interfaces:**
- Consumes: `CompositionSlice` from `../../utils/composition`; `categoryPalette` from `../../utils/theme`.
- Produces:
```ts
type DonutSlice = { key: string; label: string; value: number; color: string };
type Props = {
  slices: DonutSlice[];   // pre-sorted, pre-colored, <= 8
  centerPrimary: string;  // e.g. formatted positive subtotal
  centerSecondary?: string; // e.g. "Net worth ¥1.2M"
  caption?: string;       // e.g. excluded-liabilities or no-holdings note
  focusedKey?: string;
  onSlicePress?: (key: string) => void;
};
export function CompositionDonut(props: Props): JSX.Element
```
- Behavior: renders a gifted-charts donut; tapping a slice calls `onSlicePress(slice.key)`; the slice whose key === `focusedKey` is visually focused. When `slices` is empty, renders only the center text + caption (no chart) — the screen decides whether that's "no data" or "no positive holdings".

- [ ] **Step 1: Implement the component**

Create `src/components/charts/CompositionDonut.tsx`:
```tsx
import { StyleSheet, Text, View } from 'react-native';
import { PieChart } from 'react-native-gifted-charts';

import { colors, spacing } from '../../utils/theme';

export type DonutSlice = {
  key: string;
  label: string;
  value: number;
  color: string;
};

type Props = {
  slices: DonutSlice[];
  centerPrimary: string;
  centerSecondary?: string;
  caption?: string;
  focusedKey?: string;
  onSlicePress?: (key: string) => void;
};

export function CompositionDonut({
  slices,
  centerPrimary,
  centerSecondary,
  caption,
  focusedKey,
  onSlicePress,
}: Props) {
  const data = slices.map((s) => ({
    value: s.value,
    color: s.color,
    focused: s.key === focusedKey,
  }));

  return (
    <View style={styles.wrap}>
      {slices.length > 0 && (
        <PieChart
          donut
          data={data}
          radius={96}
          innerRadius={64}
          innerCircleColor={colors.card}
          focusOnPress
          sectionAutoFocus
          onPress={(_item: unknown, index: number) => {
            const s = slices[index];
            if (s && onSlicePress) onSlicePress(s.key);
          }}
          centerLabelComponent={() => (
            <View style={styles.center}>
              <Text style={styles.centerPrimary}>{centerPrimary}</Text>
              {centerSecondary ? (
                <Text style={styles.centerSecondary}>{centerSecondary}</Text>
              ) : null}
            </View>
          )}
        />
      )}
      {slices.length === 0 && (
        <View style={styles.center}>
          <Text style={styles.centerPrimary}>{centerPrimary}</Text>
          {centerSecondary ? <Text style={styles.centerSecondary}>{centerSecondary}</Text> : null}
        </View>
      )}
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerPrimary: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  centerSecondary: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  caption: {
    fontSize: 12,
    color: colors.muted,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
});
```

*(Verified tokens: `colors.card` = `#ffffff` (card surface, used for the donut inner circle), `colors.bg` = app background. There is no `colors.surface`.)*

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. (gifted-charts `PieChart` `onPress` is untyped/`Function`; the `(_item, index)` signature is accepted.)

- [ ] **Step 3: Commit**

```bash
git add src/components/charts/CompositionDonut.tsx
git commit -m "feat(charts): CompositionDonut (gifted-charts donut + center + slice press)"
```

---

## Task 7: Analysis screen

**Files:**
- Create: `app/(tabs)/analysis.tsx`

**Interfaces:**
- Consumes: `minusMonths` (Task 1); `compositionDimensions`/`compositionSlices`/`ACCOUNT_DIMENSION` (Task 2); `MonthSelector` w/ `disablePicker` (Task 4); `AllocationBarList` w/ `highlightKey` (Task 5); `CompositionDonut` (Task 6); existing `NetWorthTrendChart`, `YearCalendar`, `SectionCard`, repos `getMonthlyTotals`/`getDateRange`/`listSnapshotsByDate`/`listAssets`, `useFormat`/`useSettings`, `categoryPalette`.
- Produces: the default-exported `AnalysisScreen` route at `/analysis`.

- [ ] **Step 1: Implement the screen**

Create `app/(tabs)/analysis.tsx`:
```tsx
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { getDateRange, getMonthlyTotals, listSnapshotsByDate } from '../../src/db/snapshot-repo';
import { listAssets } from '../../src/db/asset-repo';
import { currentYearMonth, minusMonths } from '../../src/utils/date';
import { useFormat, useSettings } from '../../src/hooks/SettingsContext';
import { categoryPalette, colors, shared, spacing } from '../../src/utils/theme';
import { MonthSelector } from '../../src/components/MonthSelector';
import { SectionCard } from '../../src/components/SectionCard';
import { NetWorthTrendChart, type TrendPoint } from '../../src/components/charts/NetWorthTrendChart';
import { CompositionDonut, type DonutSlice } from '../../src/components/charts/CompositionDonut';
import { AllocationBarList, type AllocationItem } from '../../src/components/charts/AllocationBarList';
import { YearCalendar } from '../../src/components/YearCalendar';
import {
  ACCOUNT_DIMENSION,
  compositionDimensions,
  compositionSlices,
  type CompositionInput,
  type CompositionResult,
} from '../../src/utils/composition';

type Range = '1Y' | '3Y' | 'All';
const RANGES: Range[] = ['1Y', '3Y', 'All'];
const EMPTY_COMP: CompositionResult = { slices: [], chartedTotal: 0, trueTotal: 0, excludedCount: 0 };

export default function AnalysisScreen() {
  const { t } = useTranslation();
  const { fmt } = useFormat();
  const { forwardFill } = useSettings();

  const [selectedMonth, setSelectedMonth] = useState(currentYearMonth());
  const [range, setRange] = useState<Range>('1Y');
  const [dimension, setDimension] = useState<string>(ACCOUNT_DIMENSION);
  const [focusedKey, setFocusedKey] = useState<string | undefined>(undefined);

  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [compInput, setCompInput] = useState<CompositionInput[]>([]);

  const loadData = useCallback(async () => {
    // Trend window: 1Y/3Y end at selectedMonth; All spans full history.
    let start = selectedMonth;
    let end = selectedMonth;
    if (range === '1Y') start = minusMonths(selectedMonth, 11);
    else if (range === '3Y') start = minusMonths(selectedMonth, 35);
    else {
      const dr = await getDateRange();
      if (dr) {
        start = dr.start;
        end = dr.end;
      }
    }
    const months = await getMonthlyTotals(start, end);
    setTrend(months.map((m) => ({ label: m.date, value: m.netWorth })));

    // Composition at selectedMonth: join snapshots with assets for categories.
    const [snaps, assets] = await Promise.all([
      listSnapshotsByDate(selectedMonth, { forwardFill }),
      listAssets({ includeArchived: false }),
    ]);
    const catById = new Map(assets.map((a) => [a.id, a.categories]));
    setCompInput(
      snaps.map((s) => ({
        assetId: s.assetId,
        accountName: s.accountName,
        categories: catById.get(s.assetId) ?? {},
        netWorth: s.netWorth,
      }))
    );
  }, [selectedMonth, range, forwardFill]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  // Derived (render-time, no extra state):
  const dimensions = compositionDimensions(compInput);
  const activeDimension = dimensions.includes(dimension) ? dimension : ACCOUNT_DIMENSION;
  const comp = compInput.length
    ? compositionSlices(compInput, activeDimension, {
        uncategorized: t('analysis.uncategorized'),
        others: t('analysis.others'),
      })
    : EMPTY_COMP;

  const donutSlices: DonutSlice[] = comp.slices.map((s, i) => ({
    ...s,
    color: categoryPalette[i % categoryPalette.length],
  }));
  const legendItems: AllocationItem[] = donutSlices.map((s) => ({
    key: s.key,
    label: s.label,
    value: s.value,
    color: s.color,
  }));

  const caption =
    comp.slices.length === 0 && compInput.length > 0
      ? t('analysis.noPositiveHoldings')
      : comp.excludedCount > 0
        ? t('analysis.excludedLiabilities', { count: comp.excludedCount })
        : undefined;

  const dimLabel = (d: string) => (d === ACCOUNT_DIMENSION ? t('analysis.byAccount') : d);

  return (
    <ScrollView style={shared.screen} contentContainerStyle={styles.content}>
      <View style={styles.selectorRow}>
        <MonthSelector value={selectedMonth} onChange={setSelectedMonth} disablePicker />
      </View>

      <SectionCard title={t('analysis.trendTitle')}>
        <View style={styles.chipRow}>
          {RANGES.map((r) => (
            <TouchableOpacity
              key={r}
              style={[styles.chip, range === r && styles.chipActive]}
              onPress={() => setRange(r)}>
              <Text style={[styles.chipText, range === r && styles.chipTextActive]}>{r}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {trend.length >= 2 ? (
          <NetWorthTrendChart points={trend} />
        ) : (
          <Text style={styles.empty}>{t('charts.noDataToDisplay')}</Text>
        )}
      </SectionCard>

      <SectionCard title={t('analysis.composition')}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}>
          {dimensions.map((d) => (
            <TouchableOpacity
              key={d}
              style={[styles.chip, activeDimension === d && styles.chipActive]}
              onPress={() => {
                setDimension(d);
                setFocusedKey(undefined);
              }}>
              <Text style={[styles.chipText, activeDimension === d && styles.chipTextActive]}>
                {dimLabel(d)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <CompositionDonut
          slices={donutSlices}
          centerPrimary={fmt(comp.chartedTotal)}
          centerSecondary={`${t('analysis.netWorthTrue')} ${fmt(comp.trueTotal)}`}
          caption={caption}
          focusedKey={focusedKey}
          onSlicePress={(key) => setFocusedKey((cur) => (cur === key ? undefined : key))}
        />
        {legendItems.length > 0 && (
          <AllocationBarList items={legendItems} highlightKey={focusedKey} />
        )}
      </SectionCard>

      <SectionCard title={t('nav.analysis')}>
        <Text style={styles.intro}>{t('analysis.calendarIntro')}</Text>
        <YearCalendar selected={selectedMonth} onChange={setSelectedMonth} />
      </SectionCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  selectorRow: { marginBottom: spacing.md },
  chipRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    backgroundColor: colors.track,
  },
  chipActive: { backgroundColor: colors.accent },
  chipText: { fontSize: 13, color: colors.inkSoft, fontWeight: '600' },
  chipTextActive: { color: 'white' },
  empty: { color: colors.muted, paddingVertical: spacing.lg, textAlign: 'center' },
  intro: { fontSize: 13, color: colors.inkSoft, marginBottom: spacing.md, lineHeight: 19 },
});
```

- [ ] **Step 2: Verify token + component names**

All tokens used (`colors.accent`, `inkSoft`, `track`, `muted`, `card`, `bg`, `ink`) and `categoryPalette` are verified to exist in `src/utils/theme.ts`, and `SectionCard` accepts `title` — no change needed. This step is a final sanity grep only: `grep -nE "accent|inkSoft|track|muted|card:|bg:" src/utils/theme.ts`.

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/(tabs)/analysis.tsx
git commit -m "feat(analysis): add Analysis screen (trend + composition donut + calendar)"
```

---

## Task 8: Wire navigation, repoint Home, delete `/trends`, remove orphan i18n

**Files:**
- Modify: `app/(tabs)/_layout.tsx`
- Modify: `app/(tabs)/index.tsx:131-137`
- Delete: `app/trends.tsx`
- Modify: `src/i18n/locales/{en,zh}.json`

**Interfaces:**
- Consumes: `nav.analysis`, `home.viewAnalysis` (Task 3); the `/analysis` route (Task 7).
- Produces: a 5-tab bar with 分析 in 3rd position; Home links to `/analysis`; the `/trends` route no longer exists.

- [ ] **Step 1: Register the tab**

In `app/(tabs)/_layout.tsx`, add this `<Tabs.Screen>` between the `assets` and `transactions` entries:
```tsx
<Tabs.Screen
  name="analysis"
  options={{
    title: t('nav.analysis'),
    tabBarIcon: ({ color, size }) => <Ionicons name="analytics" size={size} color={color} />,
  }}
/>
```

- [ ] **Step 2: Repoint the Home link**

In `app/(tabs)/index.tsx`, change the trends entry (around line 133-136) to navigate to the new tab and use the new key:
```tsx
<TouchableOpacity
  style={styles.trendsLink}
  onPress={() => router.navigate('/analysis' as Href)}>
  <Text style={styles.trendsLinkText}>{t('home.viewAnalysis')} →</Text>
</TouchableOpacity>
```

- [ ] **Step 3: Delete the old route**

Run: `git rm app/trends.tsx`

- [ ] **Step 4: Remove orphaned i18n keys**

Run a grep to confirm nothing else references them: `grep -rn "nav.trends\|trends\.\|home.viewTrends" app src` — expect only matches you are about to delete. Then remove from BOTH `en.json` and `zh.json`: the `nav.trends` key, the entire `trends` block, and `home.viewTrends`.

- [ ] **Step 5: Typecheck + lint + JSON validity**

Run: `npx tsc --noEmit && npm run lint && node -e "JSON.parse(require('fs').readFileSync('src/i18n/locales/en.json','utf8')); JSON.parse(require('fs').readFileSync('src/i18n/locales/zh.json','utf8')); console.log('ok')"`
Expected: no errors, `ok`.

- [ ] **Step 6: Commit**

```bash
git add app/(tabs)/_layout.tsx app/(tabs)/index.tsx src/i18n/locales/en.json src/i18n/locales/zh.json
git commit -m "feat(nav): add Analysis tab; absorb /trends; repoint Home link"
```

---

## Task 9: Visual verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test + typecheck suite**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all pure tests pass; no type/lint errors.

- [ ] **Step 2: Start the web build and screenshot the new tab**

In one terminal: `npm run web`. Then capture with sample data:
```bash
node scripts/dev-screenshot.mjs /analysis analysis-1y.png --seed
```
Then exercise the donut dimensions and trend ranges by driving the page programmatically (see `scripts/dev-screenshot.mjs`'s `launch`/`loadSampleData` exports) — capture `/analysis` with `range=3Y`, `range=All`, and each donut dimension chip. Confirm: trend renders for all three ranges (empty-state when <2 points), donut slice colors match legend row colors, tapping a slice highlights the matching legend row, center shows the positive subtotal with the true net-worth sub-line, and the calendar tap updates the MonthSelector.

- [ ] **Step 3: Verify the liability/negative case**

Temporarily seed a liability asset (negative net worth) via the sample data or the UI, reload `/analysis`, and confirm: the negative bucket is excluded from slices, the `excludedLiabilities` caption shows, and an all-negative dataset shows the `noPositiveHoldings` caption (not a blank "no data").

- [ ] **Step 4: Final commit (if any screenshots/fixtures are kept)**

Only commit code fixes surfaced by verification; do not commit throwaway screenshots. If fixes were needed, commit them with a descriptive message.

---

## Self-Review notes (for the planner)

- **Spec coverage:** trend-anchored-to-month (Task 7), donut positive-subtotal center + true-net-worth line + excluded caption (Tasks 2/6/7), dynamic dimensions + uncategorized + top-N cap (Task 2), `disablePicker` single-picker (Task 4), highlight-by-stable-key (Tasks 2/5/7), `getMonthlyTotals(start,end)` + `minusMonths` + All via `getDateRange` + `<2` points empty state (Tasks 1/7), join with `listAssets` for categories (Task 7), i18n add/remove with JSX arrow (Tasks 3/8), tab via `router.navigate` (Task 8), pure-module node tests (Tasks 1/2), screenshot + liability verification (Task 9). All covered.
- **Type consistency:** `CompositionSlice`/`CompositionResult`/`CompositionInput` used identically in Tasks 2 and 7; `DonutSlice` defined in Task 6 and imported in Task 7; `AllocationItem` gains `key?` in Task 5 and is consumed in Task 7.
- **Tokens verified:** `colors.card`/`bg`/`accent`/`inkSoft`/`track`/`muted`/`ink` and `categoryPalette` all exist in `theme.ts`; the donut inner circle uses `colors.card` (`#ffffff`). There is no `colors.surface`.
