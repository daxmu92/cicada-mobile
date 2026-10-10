import {listAssetOverview} from '../../src/db/asset-repo';
import {listAccounts} from '../../src/db/account-repo';
import { getLedgerEpoch } from '../../src/ledger/mode';
import { notify } from '../../src/utils/dialog';
import { useDataVersion } from '../../src/hooks/use-data-version';
import { useCallback, useRef, useState } from 'react';
import { ScrollView, Text, View, StyleSheet, useWindowDimensions } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';

import {
  getMonthlyTotals,
  getTotalsForDate,
  listSnapshotsByDate,
} from '../../src/db/snapshot-repo';
import { currentYearMonth, prevYearMonth } from '../../src/utils/date';
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
  const wide = useWindowDimensions().width >= 1000;
  const { fmt } = useFormat();
  const { forwardFill } = useSettings();
  const { gain, loss } = useSemanticColors();
  const shared = useShared();
  const styles = useThemedStyles(makeStyles);

  const [selectedMonth, setSelectedMonth] = useState(currentYearMonth());
  const [totals, setTotals] = useState({ netWorth: 0, inflow: 0, profit: 0 });
  const [prevNetWorth, setPrevNetWorth] = useState<number | null>(null);
  const [allocations, setAllocations] = useState<SnapshotWithAsset[]>([]);
  const [trend, setTrend] = useState<TrendPoint[]>([]);

  const request = useRef(0);
  const loadData = useCallback(async () => {
    const generation = ++request.current;
    const capturedEpoch=getLedgerEpoch();
    const [cur, prevSnaps, snaps] = await Promise.all([
      getTotalsForDate(selectedMonth, { forwardFill }),
      listSnapshotsByDate(prevYearMonth(selectedMonth), { forwardFill }),
      listSnapshotsByDate(selectedMonth, { forwardFill }),
    ]);

    // 12-month trend ending at selectedMonth
    let start = selectedMonth;
    for (let i = 0; i < 11; i++) start = prevYearMonth(start);
    const months = await getMonthlyTotals(start, selectedMonth, { forwardFill });
    if (generation !== request.current||capturedEpoch!==getLedgerEpoch()) return;
    setLoadedEpoch(capturedEpoch);
    setTotals(cur);
    setPrevNetWorth(prevSnaps.length ? prevSnaps.reduce((sum, row) => sum + row.netWorth, 0) : null);
    setAllocations(snaps);
    setTrend(months.map((m) => ({ label: m.date, value: m.netWorth })));
    // Warm the next tab after Home has its data; never gate Home on this read.
    void Promise.all([listAccounts(),listAssetOverview(currentYearMonth(),forwardFill)]).catch(()=>{});
  }, [selectedMonth, forwardFill]);

  useFocusEffect(
    useCallback(() => {
      void dataVersion;
      void loadData().catch(() => notify(t('common.error'), t('common.loadFailed')));
    }, [loadData, dataVersion, t])
  );

  const netGrowth = totals.netWorth - (prevNetWorth ?? 0);
  const growthPct = prevNetWorth !== null && prevNetWorth !== 0 ? (netGrowth / Math.abs(prevNetWorth)) * 100 : null;
  const greeting = t(greetingKey(new Date().getHours()));

  const allocationItems = allocations.map((s) => ({
    label: `${s.accountName} · ${s.assetName}`,
    value: s.netWorth,
  }));

  if(loadedEpoch!==epoch)return <View style={shared.screen}><Text style={shared.muted}>{t('common.loading')}</Text></View>;
  return (
    <ScrollView style={shared.screen} contentContainerStyle={styles.content}>
      {/* Greeting + month selector */}
      <View style={styles.topRow}>
        <Text style={styles.greeting}>{greeting} 👋</Text>
        <MonthSelector value={selectedMonth} onChange={setSelectedMonth} />
      </View>

      <View style={wide ? styles.desktopGrid : undefined}>
      {/* Hero: net worth + change + trend */}
      <View style={[shared.card, wide && styles.heroColumn]}>
        <Text style={shared.sectionTitle}>{t('home.totalNetWorth')}</Text>
        <Text style={shared.bigNumber}>{allocations.length ? fmt(totals.netWorth) : '—'}</Text>
        {!allocations.length && <Text style={shared.muted}>{t('home.noSnapshot')}</Text>}
        {allocations.some((row) => row.estimated) && <Text style={shared.muted}>{t('home.estimated')}</Text>}
        <View style={{ marginTop: spacing.sm }}>
          {prevNetWorth !== null && allocations.length > 0 ? <ChangePill value={netGrowth} percent={growthPct} caption={t('home.thisMonth')} /> : <Text style={shared.muted}>{t('home.noComparison')}</Text>}
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
          label={t('home.netGrowth')}
          value={prevNetWorth === null || !allocations.length ? '—' : fmt(netGrowth)}
          valueColor={netGrowth >= 0 ? gain : loss}
        />
        <MetricCard
          label={t('home.profit')}
          value={allocations.length ? fmt(totals.profit) : '—'}
          valueColor={totals.profit >= 0 ? gain : loss}
        />
      </View>

      {/* Allocation */}
      <SectionCard title={t('home.allocation')}>
        <AllocationBarList items={allocationItems} />
      </SectionCard>
      </View>
      </View>
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
