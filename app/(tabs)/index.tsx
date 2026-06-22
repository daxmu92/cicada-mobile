import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View, StyleSheet } from 'react-native';
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
  const { fmt } = useFormat();
  const { forwardFill } = useSettings();
  const { gain, loss } = useSemanticColors();
  const shared = useShared();
  const styles = useThemedStyles(makeStyles);

  const [selectedMonth, setSelectedMonth] = useState(currentYearMonth());
  const [totals, setTotals] = useState({ netWorth: 0, inflow: 0, profit: 0 });
  const [prevNetWorth, setPrevNetWorth] = useState(0);
  const [allocations, setAllocations] = useState<SnapshotWithAsset[]>([]);
  const [trend, setTrend] = useState<TrendPoint[]>([]);

  const loadData = useCallback(async () => {
    const [cur, prev, snaps] = await Promise.all([
      getTotalsForDate(selectedMonth, { forwardFill }),
      getTotalsForDate(prevYearMonth(selectedMonth), { forwardFill }),
      listSnapshotsByDate(selectedMonth, { forwardFill }),
    ]);
    setTotals(cur);
    setPrevNetWorth(prev.netWorth);
    setAllocations(snaps);

    // 12-month trend ending at selectedMonth
    let start = selectedMonth;
    for (let i = 0; i < 11; i++) start = prevYearMonth(start);
    const months = await getMonthlyTotals(start, selectedMonth);
    setTrend(months.map((m) => ({ label: m.date, value: m.netWorth })));
  }, [selectedMonth, forwardFill]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const netGrowth = totals.netWorth - prevNetWorth;
  const growthPct = prevNetWorth !== 0 ? (netGrowth / Math.abs(prevNetWorth)) * 100 : null;
  const greeting = t(greetingKey(new Date().getHours()));

  const allocationItems = allocations.map((s) => ({
    label: `${s.accountName} · ${s.assetName}`,
    value: s.netWorth,
  }));

  return (
    <ScrollView style={shared.screen} contentContainerStyle={styles.content}>
      {/* Greeting + month selector */}
      <View style={styles.topRow}>
        <Text style={styles.greeting}>{greeting} 👋</Text>
        <MonthSelector value={selectedMonth} onChange={setSelectedMonth} />
      </View>

      {/* Hero: net worth + change + trend */}
      <View style={shared.card}>
        <Text style={shared.sectionTitle}>{t('home.totalNetWorth')}</Text>
        <Text style={shared.bigNumber}>{fmt(totals.netWorth)}</Text>
        <View style={{ marginTop: spacing.sm }}>
          <ChangePill value={netGrowth} percent={growthPct} caption={t('home.thisMonth')} />
        </View>
        {trend.length > 1 && (
          <View style={styles.heroTrend}>
            <NetWorthTrendChart points={trend} height={150} />
          </View>
        )}
      </View>

      {/* Two metrics */}
      <View style={styles.metricsRow}>
        <MetricCard
          label={t('home.netGrowth')}
          value={fmt(netGrowth)}
          valueColor={netGrowth >= 0 ? gain : loss}
        />
        <MetricCard
          label={t('home.profit')}
          value={fmt(totals.profit)}
          valueColor={totals.profit >= 0 ? gain : loss}
        />
      </View>

      {/* Allocation */}
      <SectionCard title={t('home.allocation')}>
        <AllocationBarList items={allocationItems} />
      </SectionCard>
    </ScrollView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    content: {
      padding: spacing.lg,
      paddingBottom: spacing.xl,
    },
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
