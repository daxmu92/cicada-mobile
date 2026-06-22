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
