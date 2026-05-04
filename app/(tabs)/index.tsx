import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, View, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';

import {
  getMonthlyTotals,
  getTotalsForDate,
  listSnapshotsByDate,
} from '../../src/db/snapshot-repo';
import { currentYearMonth, prevYearMonth } from '../../src/utils/date';
import { useFormat, useSemanticColors, useSettings } from '../../src/hooks/SettingsContext';
import { shared, spacing } from '../../src/utils/theme';
import { AllocationBarList } from '../../src/components/charts/AllocationBarList';
import { Sparkline } from '../../src/components/charts/Sparkline';
import { YearCalendar } from '../../src/components/YearCalendar';
import type { SnapshotWithAsset } from '../../src/utils/types';

export default function HomeScreen() {
  const { fmt, fmtSigned } = useFormat();
  const { forwardFill } = useSettings();
  const { gain, loss } = useSemanticColors();
  const [selectedMonth, setSelectedMonth] = useState(currentYearMonth());
  const [totals, setTotals] = useState({ netWorth: 0, inflow: 0, profit: 0 });
  const [prevNetWorth, setPrevNetWorth] = useState(0);
  const [allocations, setAllocations] = useState<SnapshotWithAsset[]>([]);
  const [trend, setTrend] = useState<number[]>([]);

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
    setTrend(months.map((m) => m.netWorth));
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
  const allocationItems = allocations.map((s) => ({
    label: `${s.accountName} · ${s.assetName}`,
    value: s.netWorth,
  }));

  // NOTE: YearCalendar computes each month's net growth from raw SQL sums via
  // getMonthlyTotals. Forward-fill (when enabled in settings) is intentionally
  // NOT applied to the year-view cells yet — getMonthlyTotals has no
  // forward-fill support and we chose not to add it as part of this change.
  return (
    <ScrollView style={shared.screen} contentContainerStyle={shared.scrollContent}>
      <YearCalendar selected={selectedMonth} onChange={setSelectedMonth} />

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
              color={trend[trend.length - 1] >= trend[0] ? gain : loss}
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
              { color: netGrowth >= 0 ? gain : loss },
            ]}>
            {fmtSigned(netGrowth)}
          </Text>
        </View>
        <View style={[shared.card, styles.metric]}>
          <Text style={shared.sectionTitle}>Profit</Text>
          <Text
            style={[
              styles.metricValue,
              { color: totals.profit >= 0 ? gain : loss },
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

const styles = StyleSheet.create({
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
