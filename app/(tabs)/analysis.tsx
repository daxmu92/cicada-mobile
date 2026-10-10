import { getObservationMetadata, getTrendCoverage } from '../../src/db/observation-repo';
import { useObservationMonth } from '../../src/hooks/use-observation-month';
import { completeTrend } from '../../src/utils/observation';
import { getLedgerEpoch } from '../../src/ledger/mode';
import { notify } from '../../src/utils/dialog';
import { useDataVersion } from '../../src/hooks/use-data-version';
import { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { getDateRange, getMonthlyTotals, listSnapshotsByDate } from '../../src/db/snapshot-repo';
import { listAssets } from '../../src/db/asset-repo';
import { minusMonths } from '../../src/utils/date';
import { useFormat, useSettings, useShared, useThemedStyles } from '../../src/hooks/SettingsContext';
import { categoryPalette, spacing, type ThemeColors } from '../../src/utils/theme';
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
  const dataVersion = useDataVersion();
  const epoch=getLedgerEpoch();
  const [loadedEpoch,setLoadedEpoch]=useState(-1);
  const { fmt } = useFormat();
  const { forwardFill } = useSettings();
  const shared = useShared();
  const styles = useThemedStyles(makeStyles);

  const [selectedMonth, setSelectedMonth] = useObservationMonth();
  const [range, setRange] = useState<Range>('1Y');
  const [dimension, setDimension] = useState<string>(ACCOUNT_DIMENSION);
  const [focusedKey, setFocusedKey] = useState<string | undefined>(undefined);
  const handleMonthChange = (ym: string) => { setSelectedMonth(ym); setFocusedKey(undefined); };

  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [compInput, setCompInput] = useState<CompositionInput[]>([]);

  const request = useRef(0);
  const loadData = useCallback(async () => {
    const generation = ++request.current;
    const capturedEpoch=getLedgerEpoch();
    // Trend window: 1Y/3Y end at selectedMonth; All spans full history.
    let start = selectedMonth;
    let end = selectedMonth;
    if (range === '1Y') start = minusMonths(selectedMonth, 11);
    else if (range === '3Y') start = minusMonths(selectedMonth, 35);
    else {
      const dr = await getDateRange();
      if (dr) {
        start = dr.start;
        end = selectedMonth;
      }
    }
    // Trend and composition use the same monthly valuation policy.
    const [months,coverage,meta]=await Promise.all([getMonthlyTotals(start, end, { forwardFill }),getTrendCoverage(start,end),getObservationMetadata(selectedMonth)]);

    // Composition at selectedMonth: join snapshots with assets for categories.
    const [snaps, assets] = await Promise.all([
      listSnapshotsByDate(selectedMonth, { forwardFill }),
      listAssets({ includeArchived: true }),
    ]);
    if (generation !== request.current||capturedEpoch!==getLedgerEpoch()) return;
    setLoadedEpoch(capturedEpoch);
    const counts=new Map(coverage.map(row=>[row.date,row.recordedActive]));
    setTrend(completeTrend(start, end, months).map(point=>({...point,partial:point.value!==null&&(counts.get(point.label)??0)<meta.activeAssets})));
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
      void dataVersion;
      void loadData().catch(() => notify(t('common.error'), t('common.loadFailed')));
    }, [loadData, dataVersion, t])
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

  if(loadedEpoch!==epoch)return <View style={shared.screen}><Text style={shared.muted}>{t('common.loading')}</Text></View>;
  return (
    <ScrollView style={shared.screen} contentContainerStyle={styles.content}>
      <View style={styles.selectorRow}>
        <MonthSelector value={selectedMonth} onChange={handleMonthChange} disablePicker />
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
          centerSecondary={comp.excludedCount > 0 ? `${t('analysis.netWorthTrue')} ${fmt(comp.trueTotal)}` : undefined}
          caption={caption}
          focusedKey={focusedKey}
          onSlicePress={(key) => setFocusedKey((cur) => (cur === key ? undefined : key))}
        />
        {legendItems.length > 0 && (
          <AllocationBarList items={legendItems} highlightKey={focusedKey} />
        )}
      </SectionCard>

      <SectionCard title={t('analysis.calendarTitle')}>
        <Text style={styles.intro}>{t('analysis.calendarIntro')}</Text>
        <YearCalendar selected={selectedMonth} onChange={handleMonthChange} />
      </SectionCard>
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    content: { padding: spacing.lg, paddingBottom: spacing.xl },
    selectorRow: { marginBottom: spacing.md },
    chipRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: 999,
      backgroundColor: c.track,
    },
    chipActive: { backgroundColor: c.accent },
    chipText: { fontSize: 13, color: c.inkSoft, fontWeight: '600' },
    chipTextActive: { color: c.onAccent },
    empty: { color: c.muted, paddingVertical: spacing.lg, textAlign: 'center' },
    intro: { fontSize: 13, color: c.inkSoft, marginBottom: spacing.md, lineHeight: 19 },
  });
