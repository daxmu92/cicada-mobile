# Batch Snapshot Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-place "batch entry mode" to the Assets screen so a user can enter/edit a chosen month's snapshot for many assets in one screen, then submit them together.

**Architecture:** A toggle on the Assets screen swaps the normal list into an entry mode with a morphing top toolbar (cancel / month-selector / submit). Tapping an asset expands a controlled entry card (accordion: one open at a time); the screen owns all draft state in plain Maps and computes which assets are "dirty" by value comparison. Pure auto-calc math is extracted into a shared helper reused by the existing `add-record` modal. Submit is resumable: successful upserts leave the draft set, failures stay for retry.

**Tech Stack:** Expo / React Native, expo-router, react-i18next, expo-sqlite via the repo layer (`src/db/*-repo.ts`), `react-native-gifted-charts` (Sparkline), TypeScript strict.

## Global Constraints

- **No test runner exists.** Verify every task with `npx tsc --noEmit` and `npm run lint`; manual run for UI tasks. Do not add a test framework.
- **App code lives in `src/`**; screens in `app/`. `src/` modules use relative imports (not `@/`).
- **Snapshots are monthly**, keyed `(asset_id, "YYYY-MM")`. Use `currentYearMonth()` / the `src/utils/date.ts` helpers — never hand-format month strings.
- **i18n is mandatory**: every user-facing string needs a key in BOTH `src/i18n/locales/en.json` and `src/i18n/locales/zh.json`. No hardcoded UI text.
- **Cross-platform dialogs**: use `confirmAsync` / `notify` from `src/utils/dialog.ts`, never RN `Alert` (it is a no-op on web).
- **Money/colors**: format with `useFormat().fmt`; never format inline.
- **Do NOT recompute following months' profit** when editing a past month — out of scope, matches existing `add-record` behavior.
- Repo signatures are fixed: `upsertSnapshot(assetId, date, netWorth, inflow, profit)`, `getLastSnapshotBefore(assetId, date)`, `listSnapshotsByDate(date)`.

---

### Task 1: Extract pure auto-calc helper + refactor add-record

**Files:**
- Create: `src/utils/snapshot-calc.ts`
- Modify: `app/modals/add-record.tsx` (handlers `updateNetWorth`/`updateInflow`/`updateProfit`, lines 92-117; add import)

**Interfaces:**
- Produces:
  - `computeProfit(netWorth: number, lastNetWorth: number, inflow: number): number`
  - `computeInflow(netWorth: number, lastNetWorth: number, profit: number): number`

- [ ] **Step 1: Create the pure helper**

`src/utils/snapshot-calc.ts`:

```ts
// Pure arithmetic for the snapshot auto-calculate feature.
// profit = (netWorth - lastNetWorth) - inflow, and its inversion.
// Kept POLICY-FREE: callers decide WHEN to apply these. In particular
// add-record's updateNetWorth intentionally suppresses recompute when
// editing an existing snapshot (its `!hasExisting` guard) — that policy
// stays in the caller and must NOT be baked in here.

export function computeProfit(netWorth: number, lastNetWorth: number, inflow: number): number {
  return netWorth - lastNetWorth - inflow;
}

export function computeInflow(netWorth: number, lastNetWorth: number, profit: number): number {
  return netWorth - lastNetWorth - profit;
}
```

- [ ] **Step 2: Refactor add-record to use it (preserve existing policy)**

In `app/modals/add-record.tsx`, add the import near the other `../../src` imports:

```ts
import { computeInflow, computeProfit } from '../../src/utils/snapshot-calc';
```

Replace the three handlers (currently lines 92-117) with — note the `!hasExisting` guard on `updateNetWorth` is KEPT exactly as before:

```ts
  const updateNetWorth = (v: string) => {
    setNetWorth(v);
    if (autoFill && !hasExisting) {
      const n = parseFloat(v) || 0;
      const i = parseFloat(inflow) || 0;
      setProfit(String(computeProfit(n, lastNetWorth, i)));
    }
  };

  const updateInflow = (v: string) => {
    setInflow(v);
    if (autoFill) {
      const n = parseFloat(netWorth) || 0;
      const i = parseFloat(v) || 0;
      setProfit(String(computeProfit(n, lastNetWorth, i)));
    }
  };

  const updateProfit = (v: string) => {
    setProfit(v);
    if (autoFill) {
      const n = parseFloat(netWorth) || 0;
      const p = parseFloat(v) || 0;
      setInflow(String(computeInflow(n, lastNetWorth, p)));
    }
  };
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/utils/snapshot-calc.ts app/modals/add-record.tsx
git commit -m "refactor(snapshot): extract pure auto-calc helper, reuse in add-record"
```

---

### Task 2: Add i18n keys for batch entry

**Files:**
- Modify: `src/i18n/locales/en.json` (add top-level `batchEntry` object)
- Modify: `src/i18n/locales/zh.json` (add top-level `batchEntry` object)

**Interfaces:**
- Produces translation keys: `batchEntry.enter`, `batchEntry.submit` (`{{count}}`), `batchEntry.lastNetWorth` (`{{value}}`), `batchEntry.recorded`, `batchEntry.edited`, `batchEntry.reset`, `batchEntry.collapse`, `batchEntry.switchTitle`, `batchEntry.switchBody`, `batchEntry.cancelTitle`, `batchEntry.cancelBody`, `batchEntry.skippedTitle`, `batchEntry.skippedBody` (`{{names}}`). The entry card reuses existing `addRecord.netWorth/inflow/profit/autoCalculate/valuePlaceholder` and `common.cancel`.

- [ ] **Step 1: Add the `batchEntry` block to en.json**

Add this as a new top-level key in `src/i18n/locales/en.json` (sibling of `assets`, mind the trailing comma on the preceding key):

```json
  "batchEntry": {
    "enter": "Enter data",
    "submit": "Submit ({{count}})",
    "lastNetWorth": "Last net worth: {{value}}",
    "recorded": "Recorded",
    "edited": "Edited",
    "reset": "Reset",
    "collapse": "Collapse",
    "switchTitle": "Discard changes?",
    "switchBody": "You have unsaved entries. Switch month and discard them?",
    "cancelTitle": "Discard changes?",
    "cancelBody": "Discard all unsaved entries?",
    "skippedTitle": "Some entries not saved",
    "skippedBody": "Invalid numbers, skipped: {{names}}"
  },
```

- [ ] **Step 2: Add the mirrored block to zh.json**

Add to `src/i18n/locales/zh.json` (sibling of `assets`):

```json
  "batchEntry": {
    "enter": "录入",
    "submit": "提交 ({{count}})",
    "lastNetWorth": "上月净值：{{value}}",
    "recorded": "已有",
    "edited": "已改",
    "reset": "重置",
    "collapse": "收起",
    "switchTitle": "放弃改动？",
    "switchBody": "有未提交的录入，切换月份将丢弃它们？",
    "cancelTitle": "放弃改动？",
    "cancelBody": "放弃所有未提交的录入？",
    "skippedTitle": "部分未保存",
    "skippedBody": "数字非法，已跳过：{{names}}"
  },
```

- [ ] **Step 3: Validate JSON + type-check**

Run: `node -e "require('./src/i18n/locales/en.json'); require('./src/i18n/locales/zh.json'); console.log('json ok')" && npx tsc --noEmit`
Expected: prints `json ok`, no TS errors.

- [ ] **Step 4: Commit**

```bash
git add src/i18n/locales/en.json src/i18n/locales/zh.json
git commit -m "i18n(batchEntry): add en/zh strings for batch snapshot entry"
```

---

### Task 3: MonthSelector component

**Files:**
- Create: `src/components/MonthSelector.tsx`

**Interfaces:**
- Consumes: `prevYearMonth`/`nextYearMonth`/`formatMonthYear` from `src/utils/date.ts`; `useLocale` from `src/hooks/SettingsContext`; `YearCalendar` from `src/components/YearCalendar` (controlled `{ selected, onChange }`).
- Produces: `<MonthSelector value={string} onChange={(ym: string) => void} />`

- [ ] **Step 1: Create the component**

`src/components/MonthSelector.tsx`:

```tsx
import { useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { formatMonthYear, nextYearMonth, prevYearMonth } from '../utils/date';
import { useLocale } from '../hooks/SettingsContext';
import { YearCalendar } from './YearCalendar';
import { colors, spacing } from '../utils/theme';

type Props = {
  value: string;
  onChange: (ym: string) => void;
};

export function MonthSelector({ value, onChange }: Props) {
  const locale = useLocale();
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <View style={styles.row}>
      <TouchableOpacity
        style={styles.arrow}
        onPress={() => onChange(prevYearMonth(value))}>
        <Text style={styles.arrowText}>‹</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.label} onPress={() => setPickerOpen(true)}>
        <Text style={styles.labelText}>{formatMonthYear(value, locale)}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.arrow}
        onPress={() => onChange(nextYearMonth(value))}>
        <Text style={styles.arrowText}>›</Text>
      </TouchableOpacity>

      <Modal
        visible={pickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerOpen(false)}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={() => setPickerOpen(false)}>
          <View style={styles.sheet}>
            <YearCalendar
              selected={value}
              onChange={(ym) => {
                setPickerOpen(false);
                onChange(ym);
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  arrow: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  arrowText: {
    fontSize: 22,
    fontWeight: '600',
    color: colors.primary,
  },
  label: {
    minWidth: 120,
    alignItems: 'center',
  },
  labelText: {
    fontSize: 16,
    fontWeight: '700',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  sheet: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: spacing.md,
  },
});
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. (`colors`, `spacing` exist in `src/utils/theme.ts`; if `spacing.lg` is missing, substitute `spacing.md`.)

- [ ] **Step 3: Commit**

```bash
git add src/components/MonthSelector.tsx
git commit -m "feat(components): MonthSelector month stepper with year-calendar jump"
```

---

### Task 4: AssetEntryCard component

**Files:**
- Create: `src/components/AssetEntryCard.tsx`

**Interfaces:**
- Consumes: `computeProfit`/`computeInflow` (Task 1); `useFormat`; `addRecord.*` and `batchEntry.*` i18n keys (Task 2).
- Produces:
  - `export type SnapshotDraft = { netWorth: string; inflow: string; profit: string; autoFill: boolean }`
  - `<AssetEntryCard assetName lastNetWorth draft onChange onReset onCollapse />`

- [ ] **Step 1: Create the controlled card**

`src/components/AssetEntryCard.tsx`:

```tsx
import { StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useFormat } from '../hooks/SettingsContext';
import { computeInflow, computeProfit } from '../utils/snapshot-calc';
import { colors, spacing } from '../utils/theme';

export type SnapshotDraft = {
  netWorth: string;
  inflow: string;
  profit: string;
  autoFill: boolean;
};

type Props = {
  assetName: string;
  lastNetWorth: number;
  draft: SnapshotDraft;
  onChange: (draft: SnapshotDraft) => void;
  onReset: () => void;
  onCollapse: () => void;
};

export function AssetEntryCard({
  assetName,
  lastNetWorth,
  draft,
  onChange,
  onReset,
  onCollapse,
}: Props) {
  const { t } = useTranslation();
  const { fmt } = useFormat();

  const setNetWorth = (v: string) => {
    const next = { ...draft, netWorth: v };
    if (draft.autoFill) {
      next.profit = String(computeProfit(parseFloat(v) || 0, lastNetWorth, parseFloat(draft.inflow) || 0));
    }
    onChange(next);
  };

  const setInflow = (v: string) => {
    const next = { ...draft, inflow: v };
    if (draft.autoFill) {
      next.profit = String(computeProfit(parseFloat(draft.netWorth) || 0, lastNetWorth, parseFloat(v) || 0));
    }
    onChange(next);
  };

  const setProfit = (v: string) => {
    const next = { ...draft, profit: v };
    if (draft.autoFill) {
      next.inflow = String(computeInflow(parseFloat(draft.netWorth) || 0, lastNetWorth, parseFloat(v) || 0));
    }
    onChange(next);
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{assetName}</Text>
      <Text style={styles.muted}>{t('batchEntry.lastNetWorth', { value: fmt(lastNetWorth) })}</Text>

      <View style={styles.autoRow}>
        <Text style={styles.label}>{t('addRecord.autoCalculate')}</Text>
        <Switch value={draft.autoFill} onValueChange={(v) => onChange({ ...draft, autoFill: v })} />
      </View>

      <Text style={styles.label}>{t('addRecord.netWorth')}</Text>
      <TextInput
        style={styles.input}
        value={draft.netWorth}
        onChangeText={setNetWorth}
        placeholder={t('addRecord.valuePlaceholder')}
        keyboardType="decimal-pad"
        returnKeyType="next"
      />

      <Text style={styles.label}>{t('addRecord.inflow')}</Text>
      <TextInput
        style={styles.input}
        value={draft.inflow}
        onChangeText={setInflow}
        placeholder={t('addRecord.valuePlaceholder')}
        keyboardType="decimal-pad"
        returnKeyType="next"
      />

      <Text style={styles.label}>{t('addRecord.profit')}</Text>
      <TextInput
        style={styles.input}
        value={draft.profit}
        onChangeText={setProfit}
        placeholder={t('addRecord.valuePlaceholder')}
        keyboardType="decimal-pad"
        returnKeyType="done"
      />

      <View style={styles.footer}>
        <TouchableOpacity style={styles.footerBtn} onPress={onReset}>
          <Text style={styles.footerText}>↺ {t('batchEntry.reset')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.footerBtn} onPress={onCollapse}>
          <Text style={[styles.footerText, styles.collapseText]}>⌃ {t('batchEntry.collapse')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: spacing.md,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
  },
  muted: {
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
  },
  autoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
    backgroundColor: 'white',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  footerBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  footerText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.muted,
  },
  collapseText: {
    color: colors.primary,
  },
});
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. (If `spacing.lg` is undefined in `theme.ts`, replace both uses with `spacing.md`.)

- [ ] **Step 3: Commit**

```bash
git add src/components/AssetEntryCard.tsx
git commit -m "feat(components): AssetEntryCard controlled snapshot entry card"
```

---

### Task 5: Wire entry mode into the Assets screen

**Files:**
- Modify: `app/(tabs)/assets.tsx` (full rewrite — keeps all existing normal-mode behavior, adds entry mode)

**Interfaces:**
- Consumes: `MonthSelector` (Task 3), `AssetEntryCard` + `SnapshotDraft` (Task 4); repo fns `listSnapshotsByDate`, `getLastSnapshotBefore`, `upsertSnapshot`; `confirmAsync`/`notify` from `src/utils/dialog`; `SnapshotWithAsset` type from `src/utils/types`.
- Produces: the finished Assets screen. No exports consumed elsewhere.

- [ ] **Step 1: Replace the screen with the entry-mode-capable version**

Overwrite `app/(tabs)/assets.tsx` with:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { listAccounts } from '../../src/db/account-repo';
import { listAssets } from '../../src/db/asset-repo';
import {
  getLastSnapshotBefore,
  getSnapshot,
  listSnapshotsByAsset,
  listSnapshotsByDate,
  upsertSnapshot,
} from '../../src/db/snapshot-repo';
import { currentYearMonth } from '../../src/utils/date';
import { confirmAsync, notify } from '../../src/utils/dialog';
import { useFormat, useSemanticColors } from '../../src/hooks/SettingsContext';
import type { Account, AssetWithAccount, SnapshotWithAsset } from '../../src/utils/types';
import { colors, shared, spacing } from '../../src/utils/theme';
import { Sparkline } from '../../src/components/charts/Sparkline';
import { MonthSelector } from '../../src/components/MonthSelector';
import { AssetEntryCard, type SnapshotDraft } from '../../src/components/AssetEntryCard';

type EnrichedAsset = AssetWithAccount & {
  netWorth: number;
  history: number[];
};

type AccountGroup = {
  account: Account;
  assets: EnrichedAsset[];
};

function sameNum(a: string, b: string): boolean {
  const x = parseFloat(a);
  const y = parseFloat(b);
  if (isNaN(x) && isNaN(y)) return true;
  return x === y;
}

function isDirty(d: SnapshotDraft, base: SnapshotDraft): boolean {
  return !sameNum(d.netWorth, base.netWorth) || !sameNum(d.inflow, base.inflow) || !sameNum(d.profit, base.profit);
}

export default function AssetsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { fmt } = useFormat();
  const { gain, loss } = useSemanticColors();
  const [groups, setGroups] = useState<AccountGroup[]>([]);

  // Entry-mode state
  const [entryMode, setEntryMode] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(currentYearMonth());
  const [monthSnapshots, setMonthSnapshots] = useState<Map<number, SnapshotWithAsset>>(new Map());
  const [drafts, setDrafts] = useState<Map<number, SnapshotDraft>>(new Map());
  const [baselines, setBaselines] = useState<Map<number, SnapshotDraft>>(new Map());
  const [lastNetWorthByAsset, setLastNetWorthByAsset] = useState<Map<number, number>>(new Map());
  const [expandedAssetId, setExpandedAssetId] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    const [accounts, assets] = await Promise.all([listAccounts(), listAssets()]);
    const today = currentYearMonth();

    const enriched = await Promise.all(
      assets.map(async (a) => {
        const snap = (await getSnapshot(a.id, today)) ?? (await getLastSnapshotBefore(a.id, today));
        const history = await listSnapshotsByAsset(a.id);
        return {
          ...a,
          netWorth: snap?.netWorth ?? 0,
          history: history.slice(-12).map((s) => s.netWorth),
        };
      })
    );

    const byAccount = accounts.map((acc) => ({
      account: acc,
      assets: enriched.filter((a) => a.accountId === acc.id),
    }));
    setGroups(byAccount);
  }, []);

  const loadMonthSnapshots = useCallback(async () => {
    const snaps = await listSnapshotsByDate(selectedMonth);
    const m = new Map<number, SnapshotWithAsset>();
    snaps.forEach((s) => m.set(s.assetId, s));
    setMonthSnapshots(m);
  }, [selectedMonth]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  useEffect(() => {
    if (entryMode) loadMonthSnapshots();
  }, [entryMode, loadMonthSnapshots]);

  const assetNameById = (id: number): string => {
    for (const g of groups) {
      const a = g.assets.find((x) => x.id === id);
      if (a) return a.name;
    }
    return String(id);
  };

  const dirtyEntries = (): [number, SnapshotDraft][] =>
    [...drafts.entries()].filter(([id, d]) => {
      const base = baselines.get(id);
      return base != null && isDirty(d, base);
    });

  const dirtyCount = dirtyEntries().length;

  const clearDrafts = () => {
    setDrafts(new Map());
    setBaselines(new Map());
    setLastNetWorthByAsset(new Map());
    setExpandedAssetId(null);
  };

  const exitEntryMode = () => {
    clearDrafts();
    setEntryMode(false);
  };

  const enterEntryMode = () => {
    setSelectedMonth(currentYearMonth());
    clearDrafts();
    setEntryMode(true);
  };

  const onCancel = async () => {
    if (dirtyCount > 0) {
      const ok = await confirmAsync(t('batchEntry.cancelTitle'), t('batchEntry.cancelBody'));
      if (!ok) return;
    }
    exitEntryMode();
  };

  const onChangeMonth = async (ym: string) => {
    if (ym === selectedMonth) return;
    if (dirtyCount > 0) {
      const ok = await confirmAsync(t('batchEntry.switchTitle'), t('batchEntry.switchBody'));
      if (!ok) return;
    }
    clearDrafts();
    setSelectedMonth(ym);
  };

  const expand = async (assetId: number) => {
    if (!baselines.has(assetId)) {
      const last = await getLastSnapshotBefore(assetId, selectedMonth);
      const lastNW = last?.netWorth ?? 0;
      const existing = monthSnapshots.get(assetId);
      const base: SnapshotDraft = existing
        ? {
            netWorth: String(existing.netWorth),
            inflow: String(existing.inflow),
            profit: String(existing.profit),
            autoFill: true,
          }
        : { netWorth: String(lastNW), inflow: '', profit: '', autoFill: true };
      setLastNetWorthByAsset((prev) => new Map(prev).set(assetId, lastNW));
      setBaselines((prev) => new Map(prev).set(assetId, base));
      setDrafts((prev) => (prev.has(assetId) ? prev : new Map(prev).set(assetId, base)));
    }
    setExpandedAssetId(assetId);
  };

  const onDraftChange = (assetId: number, draft: SnapshotDraft) => {
    setDrafts((prev) => new Map(prev).set(assetId, draft));
  };

  const onReset = (assetId: number) => {
    const base = baselines.get(assetId);
    if (base) setDrafts((prev) => new Map(prev).set(assetId, base));
  };

  const submit = async () => {
    const dirty = dirtyEntries();
    const failed: string[] = [];
    const succeeded: number[] = [];
    for (const [id, d] of dirty) {
      const n = parseFloat(d.netWorth);
      const i = d.inflow.trim() === '' ? 0 : parseFloat(d.inflow);
      const p = d.profit.trim() === '' ? 0 : parseFloat(d.profit);
      if (isNaN(n) || isNaN(i) || isNaN(p)) {
        failed.push(assetNameById(id));
        continue;
      }
      try {
        await upsertSnapshot(id, selectedMonth, n, i, p);
        succeeded.push(id);
      } catch {
        failed.push(assetNameById(id));
      }
    }
    if (succeeded.length > 0) {
      setDrafts((prev) => {
        const m = new Map(prev);
        succeeded.forEach((id) => m.delete(id));
        return m;
      });
      setBaselines((prev) => {
        const m = new Map(prev);
        succeeded.forEach((id) => m.delete(id));
        return m;
      });
    }
    await loadData();
    if (failed.length > 0) {
      await loadMonthSnapshots();
      notify(t('batchEntry.skippedTitle'), t('batchEntry.skippedBody', { names: failed.join(', ') }));
    } else {
      exitEntryMode();
    }
  };

  const renderHeader = () => {
    if (!entryMode) {
      if (groups.every((g) => g.assets.length === 0)) return null;
      return (
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.enterBtn} onPress={enterEntryMode}>
            <Text style={styles.enterText}>{t('batchEntry.enter')}</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={styles.toolbar}>
        <TouchableOpacity onPress={onCancel} style={styles.toolBtn}>
          <Text style={styles.toolText}>{t('common.cancel')}</Text>
        </TouchableOpacity>
        <MonthSelector value={selectedMonth} onChange={onChangeMonth} />
        <TouchableOpacity
          onPress={submit}
          disabled={dirtyCount === 0}
          style={styles.toolBtn}>
          <Text style={[styles.toolText, styles.submitText, dirtyCount === 0 && styles.disabled]}>
            {t('batchEntry.submit', { count: dirtyCount })}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderEntryRow = (asset: EnrichedAsset) => {
    if (expandedAssetId === asset.id) {
      const draft = drafts.get(asset.id);
      if (!draft) return null;
      return (
        <AssetEntryCard
          key={asset.id}
          assetName={asset.name}
          lastNetWorth={lastNetWorthByAsset.get(asset.id) ?? 0}
          draft={draft}
          onChange={(d) => onDraftChange(asset.id, d)}
          onReset={() => onReset(asset.id)}
          onCollapse={() => setExpandedAssetId(null)}
        />
      );
    }
    const base = baselines.get(asset.id);
    const d = drafts.get(asset.id);
    const dirty = base != null && d != null && isDirty(d, base);
    const recorded = monthSnapshots.has(asset.id);
    return (
      <TouchableOpacity key={asset.id} onPress={() => expand(asset.id)} style={styles.assetRow}>
        <Text style={[styles.assetName, { flex: 1 }]}>{asset.name}</Text>
        {dirty ? (
          <Text style={[styles.marker, { color: colors.primary }]}>{t('batchEntry.edited')}</Text>
        ) : recorded ? (
          <Text style={styles.marker}>{t('batchEntry.recorded')}</Text>
        ) : null}
      </TouchableOpacity>
    );
  };

  if (groups.length === 0) {
    return (
      <View style={[shared.screen, styles.empty]}>
        <Text style={shared.heading}>{t('assets.noAccountsTitle')}</Text>
        <Text style={shared.muted}>{t('assets.noAccountsBody')}</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={shared.screen}
      contentContainerStyle={shared.scrollContent}
      data={groups}
      keyExtractor={(g) => String(g.account.id)}
      ListHeaderComponent={renderHeader()}
      renderItem={({ item }) => (
        <View style={shared.card}>
          <Text style={styles.accountName}>{item.account.name}</Text>
          {item.assets.length === 0 ? (
            <Text style={shared.muted}>{t('assets.noAssets')}</Text>
          ) : entryMode ? (
            item.assets.map((asset) => renderEntryRow(asset))
          ) : (
            item.assets.map((asset) => {
              const trendColor =
                asset.history.length > 1 &&
                asset.history[asset.history.length - 1] >= asset.history[0]
                  ? gain
                  : loss;
              return (
                <TouchableOpacity
                  key={asset.id}
                  onPress={() => router.push(`/asset/${asset.id}`)}
                  style={styles.assetRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.assetName}>{asset.name}</Text>
                    {Object.keys(asset.categories).length > 0 && (
                      <Text style={styles.assetMeta}>
                        {Object.entries(asset.categories).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                      </Text>
                    )}
                  </View>
                  <Sparkline values={asset.history} width={70} height={28} color={trendColor} />
                  <Text style={styles.assetValue}>{fmt(asset.netWorth)}</Text>
                </TouchableOpacity>
              );
            })
          )}
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  empty: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: spacing.sm,
  },
  enterBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 8,
  },
  enterText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  toolBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  toolText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.muted,
  },
  submitText: {
    color: colors.primary,
  },
  disabled: {
    opacity: 0.4,
  },
  accountName: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: spacing.sm,
    color: colors.muted,
  },
  assetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  assetName: {
    fontSize: 16,
    fontWeight: '500',
  },
  assetMeta: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
  },
  assetValue: {
    fontSize: 15,
    fontWeight: '600',
    minWidth: 90,
    textAlign: 'right',
  },
  marker: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
  },
});
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: no errors. If `SnapshotWithAsset` is not exported from `src/utils/types`, check `src/db/snapshot-repo.ts` for its import path and use that path instead.

- [ ] **Step 3: Manual verification (web is fastest)**

Run: `npx expo start --web` (clear the service worker first per the PWA stale-cache note).
Check, on the Assets tab:
1. "录入" button shows only when assets exist; tapping it swaps the top into `[取消] ‹month› [提交(0)]`.
2. Tapping an asset expands the card; only one card open at a time (opening a second collapses the first).
3. Editing net worth with auto-calculate on fills profit; the row shows "已改"; 提交 count increases.
4. ↺ reverts the card to its prefilled values and drops the count; ⌃ collapses keeping the draft.
5. Re-expanding a previously edited asset shows the kept values (no data loss).
6. An asset with an existing snapshot for the month shows "已有" and prefills its stored values; an asset without one prefills last-known net worth.
7. Switch month with unsaved edits → confirm dialog; cancel with edits → confirm dialog.
8. 提交 writes the snapshots (verify on the asset detail screen) and exits entry mode.
9. Enter a non-numeric net worth → that asset is skipped with a notify, and you stay in entry mode.

- [ ] **Step 4: Commit**

```bash
git add app/\(tabs\)/assets.tsx
git commit -m "feat(assets): batch monthly snapshot entry mode"
```

---

## Notes & deliberate deviations from the spec

- **No screen-level DB transaction.** The spec mentioned a best-effort `withTransactionAsync` around submit. Repos encapsulate `getDatabase()` (the screen has no `db` handle) and `withTransactionAsync` is a no-op on Tauri anyway. We instead validate every dirty row's numbers up front and rely on the **resumable** submit (successful rows leave the draft set, failures stay) for safety. Wrapping in a real transaction would require a new batch repo function — out of scope; revisit only if torn writes prove to be a problem.
- **L7 (in-progress text lost on month switch) is structurally avoided.** `AssetEntryCard` is fully controlled and calls `onChange` on every keystroke, so `drafts` always reflects the open card — no separate "uncommitted" buffer to flush before the confirm check.
- **Marker vs displayed value:** `monthSnapshots` (from `listSnapshotsByDate`, no forward-fill) drives the "已有" marker = real snapshot only; the normal-mode row value still uses forward-filled last-known. They intentionally mean different things.

## Self-review notes

- Spec coverage: month selector (T3), expand card + auto-calc + reuse helper (T1/T4), accordion + draft persistence + dirty-by-value + resumable submit + confirms (T5), markers (T5), i18n (T2), past-month no-rechain (Global Constraints + not implemented, by design). ✓
- Type consistency: `SnapshotDraft` defined in T4, consumed in T5; `computeProfit`/`computeInflow` defined T1, consumed T1+T4; `MonthSelector` props match T3↔T5. ✓
- Placeholder scan: none. ✓
