import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';

import {
  getMonthlyTotals,
  getTotalsForDate,
  listSnapshotsByDate,
} from '../../src/db/snapshot-repo';
import {
  currentYearMonth,
  prevYearMonth,
  nextYearMonth,
  MONTH_NAMES,
  yearMonth,
} from '../../src/utils/date';
import { useFormat } from '../../src/hooks/SettingsContext';
import { colors, shared, spacing } from '../../src/utils/theme';
import { AllocationBarList } from '../../src/components/charts/AllocationBarList';
import { Sparkline } from '../../src/components/charts/Sparkline';
import type { SnapshotWithAsset } from '../../src/utils/types';

export default function HomeScreen() {
  const { fmt, fmtSigned } = useFormat();
  const [selectedMonth, setSelectedMonth] = useState(currentYearMonth());
  const [totals, setTotals] = useState({ netWorth: 0, inflow: 0, profit: 0 });
  const [prevNetWorth, setPrevNetWorth] = useState(0);
  const [allocations, setAllocations] = useState<SnapshotWithAsset[]>([]);
  const [trend, setTrend] = useState<number[]>([]);

  const loadData = useCallback(async () => {
    const [cur, prev, snaps] = await Promise.all([
      getTotalsForDate(selectedMonth),
      getTotalsForDate(prevYearMonth(selectedMonth)),
      listSnapshotsByDate(selectedMonth),
    ]);
    setTotals(cur);
    setPrevNetWorth(prev.netWorth);
    setAllocations(snaps);

    // 12-month trend ending at selectedMonth
    let start = selectedMonth;
    for (let i = 0; i < 11; i++) start = prevYearMonth(start);
    const months = await getMonthlyTotals(start, selectedMonth);
    setTrend(months.map((m) => m.netWorth));
  }, [selectedMonth]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const netGrowth = totals.netWorth - prevNetWorth;
  const [year, month] = selectedMonth.split('-').map(Number);
  const allocationItems = allocations.map((s) => ({
    label: `${s.accountName} · ${s.assetName}`,
    value: s.netWorth,
  }));

  return (
    <ScrollView style={shared.screen} contentContainerStyle={shared.scrollContent}>
      <MonthSelector
        selected={selectedMonth}
        onChange={setSelectedMonth}
        year={year}
        month={month}
      />

      <View style={shared.card}>
        <View style={styles.worthHeader}>
          <View style={{ flex: 1 }}>
            <Text style={shared.sectionTitle}>Total Net Worth</Text>
            <Text style={shared.bigNumber}>{fmt(totals.netWorth)}</Text>
          </View>
          {trend.length > 1 && (
            <Sparkline
              values={trend}
              width={100}
              height={40}
              color={trend[trend.length - 1] >= trend[0] ? colors.positive : colors.negative}
            />
          )}
        </View>
      </View>

      <View style={styles.metricsRow}>
        <View style={[shared.card, styles.metric]}>
          <Text style={shared.sectionTitle}>Net Growth</Text>
          <Text
            style={[
              styles.metricValue,
              { color: netGrowth >= 0 ? colors.positive : colors.negative },
            ]}>
            {fmtSigned(netGrowth)}
          </Text>
        </View>
        <View style={[shared.card, styles.metric]}>
          <Text style={shared.sectionTitle}>Profit</Text>
          <Text
            style={[
              styles.metricValue,
              { color: totals.profit >= 0 ? colors.positive : colors.negative },
            ]}>
            {fmtSigned(totals.profit)}
          </Text>
        </View>
      </View>

      <View style={shared.card}>
        <Text style={[shared.sectionTitle, { marginBottom: spacing.md }]}>Allocation</Text>
        <AllocationBarList items={allocationItems} />
      </View>
    </ScrollView>
  );
}

function MonthSelector({
  selected,
  onChange,
  year,
  month,
}: {
  selected: string;
  onChange: (ym: string) => void;
  year: number;
  month: number;
}) {
  return (
    <View style={[shared.card, styles.selectorCard]}>
      <View style={styles.selectorRow}>
        <TouchableOpacity
          onPress={() => onChange(prevYearMonth(selected))}
          style={styles.arrowBtn}>
          <Text style={styles.arrow}>‹</Text>
        </TouchableOpacity>
        <View style={styles.selectorCenter}>
          <Text style={styles.monthLabel}>{MONTH_NAMES[month - 1]} {year}</Text>
          <TouchableOpacity onPress={() => onChange(currentYearMonth())}>
            <Text style={styles.todayLink}>Today</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          onPress={() => onChange(nextYearMonth(selected))}
          style={styles.arrowBtn}>
          <Text style={styles.arrow}>›</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  selectorCard: {
    paddingVertical: spacing.sm,
  },
  selectorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  arrowBtn: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  arrow: {
    fontSize: 28,
    color: colors.primary,
    fontWeight: '600',
  },
  selectorCenter: {
    alignItems: 'center',
  },
  monthLabel: {
    fontSize: 18,
    fontWeight: '600',
  },
  todayLink: {
    fontSize: 12,
    color: colors.primary,
    marginTop: 2,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  metric: {
    flex: 1,
  },
  metricValue: {
    fontSize: 20,
    fontWeight: '600',
  },
  worthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
