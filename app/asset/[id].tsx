import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { getAsset } from '../../src/db/asset-repo';
import { getAccount } from '../../src/db/account-repo';
import { listSnapshotsByAsset } from '../../src/db/snapshot-repo';
import { currentYearMonth, prevYearMonth } from '../../src/utils/date';
import { useFormat, useSemanticColors, useShared, useTheme, useThemedStyles } from '../../src/hooks/SettingsContext';
import type { Asset, AssetSnapshot } from '../../src/utils/types';
import { spacing, type ThemeColors } from '../../src/utils/theme';
import { AssetLineChart } from '../../src/components/charts/AssetLineChart';
import { AssetBarChart } from '../../src/components/charts/AssetBarChart';

type Metric = 'netWorth' | 'profit' | 'inflow';
type ProfitMode = 'cumulative' | 'monthly';

const METRIC_LABEL_KEYS: Record<Metric, string> = {
  netWorth: 'assetDetail.netWorth',
  profit: 'assetDetail.profit',
  inflow: 'assetDetail.inflow',
};

type TimeRange = '3M' | '6M' | '1Y' | '3Y' | 'All';

const TIME_RANGES: TimeRange[] = ['3M', '6M', '1Y', '3Y', 'All'];

const RANGE_MONTHS: Record<Exclude<TimeRange, 'All'>, number> = {
  '3M': 3,
  '6M': 6,
  '1Y': 12,
  '3Y': 36,
};

export default function AssetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const { fmt } = useFormat();
  const { gain, loss } = useSemanticColors();
  const c = useTheme();
  const shared = useShared();
  const styles = useThemedStyles(makeStyles);
  const assetId = Number(id);

  const [asset, setAsset] = useState<Asset | null>(null);
  const [accountName, setAccountName] = useState('');
  const [snapshots, setSnapshots] = useState<AssetSnapshot[]>([]);
  const [metric, setMetric] = useState<Metric>('netWorth');
  const [profitMode, setProfitMode] = useState<ProfitMode>('cumulative');
  const [range, setRange] = useState<TimeRange>('All');

  const loadData = useCallback(async () => {
    const a = await getAsset(assetId);
    setAsset(a);
    if (a) {
      const acc = await getAccount(a.accountId);
      setAccountName(acc?.name ?? '');
    }
    const snaps = await listSnapshotsByAsset(assetId);
    setSnapshots(snaps);
  }, [assetId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const reversed = [...snapshots].reverse();
  const latest = reversed[0];

  const filteredSnapshots = useMemo<AssetSnapshot[]>(() => {
    if (range === 'All' || snapshots.length === 0) return snapshots;
    const latestDate = snapshots[snapshots.length - 1].date;
    const months = RANGE_MONTHS[range];
    let cutoff = latestDate;
    // prevYearMonth steps back one month at a time; subtract (months - 1)
    // so the window is inclusive of `months` snapshots ending at latestDate.
    for (let i = 0; i < months - 1; i++) {
      cutoff = prevYearMonth(cutoff);
    }
    return snapshots.filter((s) => s.date >= cutoff);
  }, [snapshots, range]);

  // Cumulative profit = running total of monthly profit across all history.
  const cumulativeProfit = useMemo(() => {
    let sum = 0;
    const m = new Map<string, number>();
    for (const s of snapshots) {
      sum += s.profit;
      m.set(s.date, sum);
    }
    return m;
  }, [snapshots]);

  // Flows (inflow, monthly profit) render as bars; stocks (net worth,
  // cumulative profit) render as lines.
  const useBars = metric === 'inflow' || (metric === 'profit' && profitMode === 'monthly');

  const chartData = filteredSnapshots.map((s) => ({
    label: s.date,
    value:
      metric === 'profit' && profitMode === 'cumulative'
        ? cumulativeProfit.get(s.date) ?? 0
        : s[metric],
  }));

  const firstChartValue = chartData.length ? chartData[0].value : 0;
  const lastChartValue = chartData.length ? chartData[chartData.length - 1].value : 0;
  // Profit is colored by sign; a value/net-worth series by its net direction
  // over the range. Both honor the user's gain/loss convention — no theme tint.
  const lineColor =
    metric === 'profit'
      ? lastChartValue >= 0
        ? gain
        : loss
      : lastChartValue >= firstChartValue
        ? gain
        : loss;

  return (
    <>
      <Stack.Screen options={{ title: asset?.name ?? t('nav.asset') }} />
      <ScrollView style={shared.screen} contentContainerStyle={shared.scrollContent}>
        {asset && (
          <>
            <View style={shared.card}>
              <Text style={shared.sectionTitle}>{accountName}</Text>
              <Text style={styles.assetName}>{asset.name}</Text>
              {latest && (
                <Text style={[shared.bigNumber, { marginTop: spacing.md }]}>
                  {fmt(latest.netWorth)}
                </Text>
              )}
              {latest && (
                <Text style={shared.muted}>{t('assetDetail.asOf', { date: latest.date })}</Text>
              )}
            </View>

            {snapshots.length > 0 && (
              <View style={shared.card}>
                <View style={styles.chipRowOuter}>
                  <View style={styles.chipGroup}>
                    {(Object.keys(METRIC_LABEL_KEYS) as Metric[]).map((m) => (
                      <TouchableOpacity
                        key={m}
                        onPress={() => setMetric(m)}
                        style={[
                          styles.chip,
                          metric === m && { backgroundColor: c.primary },
                        ]}>
                        <Text
                          style={[
                            styles.chipText,
                            metric === m && { color: c.onAccent },
                          ]}>
                          {t(METRIC_LABEL_KEYS[m])}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {/* Profit-only sub-toggle, kept on this row so the chart never jumps */}
                  {metric === 'profit' && (
                    <View style={styles.chipGroup}>
                      {(['cumulative', 'monthly'] as ProfitMode[]).map((pm) => (
                        <TouchableOpacity
                          key={pm}
                          onPress={() => setProfitMode(pm)}
                          style={[
                            styles.chipSm,
                            profitMode === pm && { backgroundColor: c.primary },
                          ]}>
                          <Text style={[styles.chipText, profitMode === pm && { color: c.onAccent }]}>
                            {t(pm === 'cumulative' ? 'assetDetail.cumulative' : 'assetDetail.monthly')}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
                <View style={styles.rangeRow}>
                  {TIME_RANGES.map((r) => (
                    <TouchableOpacity
                      key={r}
                      onPress={() => setRange(r)}
                      style={[
                        styles.chip,
                        range === r && { backgroundColor: c.primary },
                      ]}>
                      <Text
                        style={[
                          styles.chipText,
                          range === r && { color: c.onAccent },
                        ]}>
                        {r}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {useBars ? (
                  // Both flows (monthly profit, inflow) color by sign: positive
                  // gain-color (money in), negative loss-color (money out).
                  <AssetBarChart data={chartData} diverging />
                ) : (
                  <AssetLineChart data={chartData} color={lineColor} />
                )}
              </View>
            )}

            <TouchableOpacity
              style={[shared.card, styles.actionBtn]}
              onPress={() =>
                router.push(`/modals/add-record?assetId=${assetId}&date=${currentYearMonth()}`)
              }>
              <Text style={styles.actionText}>{t('assetDetail.recordSnapshot')}</Text>
            </TouchableOpacity>

            <Text style={[shared.sectionTitle, { marginTop: spacing.lg }]}>{t('assetDetail.history')}</Text>
            {snapshots.length === 0 ? (
              <View style={shared.card}>
                <Text style={shared.muted}>{t('assetDetail.noSnapshots')}</Text>
              </View>
            ) : (
              <View style={shared.card}>
                <View style={styles.tableHeader}>
                  <Text style={[styles.cell, styles.headerCell]}>{t('assetDetail.colDate')}</Text>
                  <Text style={[styles.cell, styles.headerCell, { textAlign: 'right' }]}>{t('assetDetail.colNetWorth')}</Text>
                  <Text style={[styles.cell, styles.headerCell, { textAlign: 'right' }]}>{t('assetDetail.colProfit')}</Text>
                </View>
                {reversed.map((s) => (
                  <TouchableOpacity
                    key={s.date}
                    style={styles.tableRow}
                    onPress={() =>
                      router.push(`/modals/add-record?assetId=${assetId}&date=${s.date}`)
                    }>
                    <Text style={styles.cell}>{s.date}</Text>
                    <Text style={[styles.cell, { textAlign: 'right' }]}>
                      {fmt(s.netWorth)}
                    </Text>
                    <Text
                      style={[
                        styles.cell,
                        { textAlign: 'right', color: s.profit >= 0 ? gain : loss },
                      ]}>
                      {fmt(s.profit)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    assetName: {
      fontSize: 24,
      fontWeight: '700',
      marginTop: spacing.xs,
    },
    chipRowOuter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.sm,
    },
    chipGroup: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    rangeRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.card,
    },
    chipSm: {
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.card,
    },
    chipText: {
      fontSize: 13,
      fontWeight: '500',
      color: c.muted,
    },
    actionBtn: {
      alignItems: 'center',
      paddingVertical: spacing.md,
    },
    actionText: {
      fontSize: 16,
      fontWeight: '600',
      color: c.primary,
    },
    tableHeader: {
      flexDirection: 'row',
      paddingBottom: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    tableRow: {
      flexDirection: 'row',
      paddingVertical: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    cell: {
      flex: 1,
      fontSize: 14,
    },
    headerCell: {
      fontWeight: '600',
      color: c.muted,
      fontSize: 12,
      textTransform: 'uppercase',
    },
  });
