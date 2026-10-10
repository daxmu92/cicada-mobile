import { useDesktopLayout } from '../../src/hooks/use-desktop-layout';
import { ObservationNotice } from '../../src/components/ObservationNotice';
import { getObservationMetadata, getTrendCoverage, type ObservationMetadata } from '../../src/db/observation-repo';
import { compareRecordedAssets, completeTrend } from '../../src/utils/observation';
import { useObservationMonth } from '../../src/hooks/use-observation-month';
import {listAssetOverview} from '../../src/db/asset-repo';
import {listAccounts} from '../../src/db/account-repo';
import { getLedgerEpoch } from '../../src/ledger/mode';
import { notify } from '../../src/utils/dialog';
import { useDataVersion } from '../../src/hooks/use-data-version';
import { useCallback, useRef, useState } from 'react';
import { ScrollView, Text, View, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';

import {
  getMonthlyTotals,
  getTotalsForDate,
  listSnapshotsByDate,
} from '../../src/db/snapshot-repo';
import { prevYearMonth } from '../../src/utils/date';
import { useFormat, useSemanticColors, useSettings, useShared, useThemedStyles } from '../../src/hooks/SettingsContext';
import { spacing, type ThemeColors } from '../../src/utils/theme';
import { AllocationBarList } from '../../src/components/charts/AllocationBarList';
import { NetWorthTrendChart, type TrendPoint } from '../../src/components/charts/NetWorthTrendChart';
import { ChangePill } from '../../src/components/ChangePill';
import { MetricCard } from '../../src/components/MetricCard';
import { MonthSelector } from '../../src/components/MonthSelector';
import { SectionCard } from '../../src/components/SectionCard';
import type { SnapshotWithAsset } from '../../src/utils/types';

function greetingKey(hour: number): string {
  if (hour < 12) return 'home.greetingMorning';
  if (hour < 18) return 'home.greetingAfternoon';
  return 'home.greetingEvening';
}

export default function HomeScreen() {
  const { t } = useTranslation();
  const dataVersion = useDataVersion();
  const epoch=getLedgerEpoch();
  const [loadedEpoch,setLoadedEpoch]=useState(-1);
  const { desktop, contentWidth } = useDesktopLayout();
  const wide = contentWidth >= 920;
  const { fmt } = useFormat();
  const { forwardFill } = useSettings();
  const { gain, loss } = useSemanticColors();
  const shared = useShared();
  const styles = useThemedStyles(makeStyles);

  const [selectedMonth, setSelectedMonth] = useObservationMonth();
  const [totals, setTotals] = useState({ netWorth: 0, inflow: 0, profit: 0 });
  const [comparison,setComparison]=useState<ReturnType<typeof compareRecordedAssets>>(compareRecordedAssets([],[]));
  const [metadata,setMetadata]=useState<ObservationMetadata|null>(null);
  const [loadedMonth,setLoadedMonth]=useState('');
  const [allocations, setAllocations] = useState<SnapshotWithAsset[]>([]);
  const [trend, setTrend] = useState<TrendPoint[]>([]);

  const request = useRef(0);
  const loadData = useCallback(async () => {
    const generation = ++request.current;
    const capturedEpoch=getLedgerEpoch();
    const [cur, prevSnaps, snaps,meta] = await Promise.all([
      getTotalsForDate(selectedMonth, { forwardFill }),
      listSnapshotsByDate(prevYearMonth(selectedMonth), { forwardFill }),
      listSnapshotsByDate(selectedMonth, { forwardFill }),
      getObservationMetadata(selectedMonth),
    ]);

    // 12-month trend ending at selectedMonth
    let start = selectedMonth;
    for (let i = 0; i < 11; i++) start = prevYearMonth(start);
    const [months,coverage]=await Promise.all([getMonthlyTotals(start, selectedMonth, { forwardFill }),getTrendCoverage(start,selectedMonth)]);
    if (generation !== request.current||capturedEpoch!==getLedgerEpoch()) return;
    setLoadedEpoch(capturedEpoch);
    setTotals(cur);
    setComparison(compareRecordedAssets(snaps,prevSnaps));setMetadata(meta);setLoadedMonth(selectedMonth);
    setAllocations(snaps);
    const counts=new Map(coverage.map(row=>[row.date,row.recordedActive]));
    setTrend(completeTrend(start, selectedMonth, months).map(point=>({...point,partial:point.value!==null&&(counts.get(point.label)??0)<meta.activeAssets})));
    // Warm the next tab after Home has its data; never gate Home on this read.
    void Promise.all([listAccounts(),listAssetOverview(selectedMonth,forwardFill)]).catch(()=>{});
  }, [selectedMonth, forwardFill]);

  useFocusEffect(
    useCallback(() => {
      void dataVersion;
      void loadData().catch(() => notify(t('common.error'), t('common.loadFailed')));
    }, [loadData, dataVersion, t])
  );

  const netGrowth = comparison.change;
  const growthPct = comparison.percent;
  const greeting = t(greetingKey(new Date().getHours()));

  const allocationItems = allocations.map((s) => ({
    label: `${s.accountName} · ${s.assetName}`,
    value: s.netWorth,
  }));

  if(loadedEpoch!==epoch||loadedMonth!==selectedMonth)return <View style={shared.screen}><Text style={shared.muted}>{t('common.loading')}</Text></View>;
  return (
    <ScrollView style={shared.screen} contentContainerStyle={styles.content}>
      {/* Greeting + month selector */}
      {!desktop && <View style={styles.topRow}>
        <Text style={styles.greeting}>{greeting} 👋</Text>
        <MonthSelector value={selectedMonth} onChange={setSelectedMonth} />
      </View>}

      <ObservationNotice meta={metadata} month={selectedMonth} onLatest={setSelectedMonth}/>
      <View style={wide ? styles.desktopGrid : undefined}>
      {/* Hero: net worth + change + trend */}
      <View style={[shared.card, wide && styles.heroColumn]}>
        <Text style={shared.sectionTitle}>{t('home.totalNetWorth')}</Text>
        <Text style={shared.bigNumber}>{allocations.length ? fmt(totals.netWorth) : '—'}</Text>
        {!allocations.length && <Text style={shared.muted}>{t('home.noSnapshot')}</Text>}
        {allocations.some((row) => row.estimated) && <Text style={shared.muted}>{t('home.estimated')}</Text>}
        <View style={{ marginTop: spacing.sm }}>
          {netGrowth !== null ? <ChangePill value={netGrowth} percent={growthPct} caption={t('observation.comparableCount',{count:comparison.count})} /> : <Text style={shared.muted}>{t('home.noComparison')}</Text>}
        </View>
        {trend.length > 1 && (
          <View style={styles.heroTrend}>
            <NetWorthTrendChart points={trend} height={wide ? 280 : 150} />
          </View>
        )}
      </View>

      <View style={wide ? styles.sideColumn : undefined}>
      {/* Two metrics */}
      <View style={styles.metricsRow}>
        <MetricCard
          label={t('observation.comparableChange')}
          value={netGrowth===null?'—':fmt(netGrowth)}
          valueColor={(netGrowth??0) >= 0 ? gain : loss}
        />
        <MetricCard
          label={t('home.profit')}
          value={allocations.some(row=>!row.estimated) ? fmt(totals.profit) : '—'}
          valueColor={totals.profit >= 0 ? gain : loss}
        />
      </View>

      {/* Allocation */}
      <SectionCard title={t('home.allocation')}>
        <AllocationBarList items={allocationItems} />
      </SectionCard>
      </View>
      </View>
      <SectionCard title={t('observation.explainChange')}>
        <View style={[styles.metricsRow,!wide&&{flexDirection:'column'}]}>
          <MetricCard label={t('observation.comparableInflow')} value={comparison.inflow===null?'—':fmt(comparison.inflow)}/>
          <MetricCard label={t('observation.comparableProfit')} value={comparison.profit===null?'—':fmt(comparison.profit)}/>
          <MetricCard label={t('observation.residual')} value={comparison.residual===null?'—':fmt(comparison.residual)}/>
        </View>
        <Text style={shared.muted}>{t('observation.comparisonHelp',{count:comparison.count})}</Text>
      </SectionCard>
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    content: {
      width: '100%',
      maxWidth: 1200,
      alignSelf: 'center',
      padding: spacing.lg,
      paddingBottom: spacing.xl,
    },
    desktopGrid: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg },
    heroColumn: { flex: 1.4, minWidth: 0 },
    sideColumn: { flex: 1, minWidth: 0 },
    topRow: {
      flexDirection: 'row',
      flexWrap:'wrap',gap:spacing.sm,
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.lg,
    },
    greeting: {
      fontSize: 18,
      fontWeight: '700',
      color: c.ink,
    },
    heroTrend: {
      marginTop: spacing.lg,
    },
    metricsRow: {
      flexDirection: 'row',
      gap: spacing.md,
      marginBottom: spacing.md,
    },
  });
