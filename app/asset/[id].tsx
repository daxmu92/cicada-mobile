import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { getAsset } from '../../src/db/asset-repo';
import { getAccount } from '../../src/db/account-repo';
import { listSnapshotsByAsset } from '../../src/db/snapshot-repo';
import { currentYearMonth } from '../../src/utils/date';
import { useFormat } from '../../src/hooks/SettingsContext';
import type { Asset, AssetSnapshot } from '../../src/utils/types';
import { colors, shared, spacing } from '../../src/utils/theme';
import { AssetLineChart } from '../../src/components/charts/AssetLineChart';

type Metric = 'netWorth' | 'profit' | 'inflow';

const METRIC_LABELS: Record<Metric, string> = {
  netWorth: 'Net Worth',
  profit: 'Profit',
  inflow: 'Inflow',
};

export default function AssetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { fmt } = useFormat();
  const assetId = Number(id);

  const [asset, setAsset] = useState<Asset | null>(null);
  const [accountName, setAccountName] = useState('');
  const [snapshots, setSnapshots] = useState<AssetSnapshot[]>([]);
  const [metric, setMetric] = useState<Metric>('netWorth');

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
  const chartData = snapshots.map((s) => ({
    label: s.date,
    value: s[metric],
  }));

  return (
    <>
      <Stack.Screen options={{ title: asset?.name ?? 'Asset' }} />
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
                <Text style={shared.muted}>As of {latest.date}</Text>
              )}
            </View>

            {snapshots.length > 0 && (
              <View style={shared.card}>
                <View style={styles.chipRow}>
                  {(Object.keys(METRIC_LABELS) as Metric[]).map((m) => (
                    <TouchableOpacity
                      key={m}
                      onPress={() => setMetric(m)}
                      style={[
                        styles.chip,
                        metric === m && { backgroundColor: colors.primary },
                      ]}>
                      <Text
                        style={[
                          styles.chipText,
                          metric === m && { color: 'white' },
                        ]}>
                        {METRIC_LABELS[m]}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <AssetLineChart
                  data={chartData}
                  color={
                    metric === 'profit'
                      ? latest && latest.profit >= 0
                        ? colors.positive
                        : colors.negative
                      : colors.primary
                  }
                />
              </View>
            )}

            <TouchableOpacity
              style={[shared.card, styles.actionBtn]}
              onPress={() =>
                router.push(`/modals/add-record?assetId=${assetId}&date=${currentYearMonth()}`)
              }>
              <Text style={styles.actionText}>+ Record Snapshot</Text>
            </TouchableOpacity>

            <Text style={[shared.sectionTitle, { marginTop: spacing.lg }]}>History</Text>
            {snapshots.length === 0 ? (
              <View style={shared.card}>
                <Text style={shared.muted}>No snapshots yet. Tap "Record Snapshot" above.</Text>
              </View>
            ) : (
              <View style={shared.card}>
                <View style={styles.tableHeader}>
                  <Text style={[styles.cell, styles.headerCell]}>Date</Text>
                  <Text style={[styles.cell, styles.headerCell, { textAlign: 'right' }]}>Net Worth</Text>
                  <Text style={[styles.cell, styles.headerCell, { textAlign: 'right' }]}>Profit</Text>
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
                        { textAlign: 'right', color: s.profit >= 0 ? colors.positive : colors.negative },
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

const styles = StyleSheet.create({
  assetName: {
    fontSize: 24,
    fontWeight: '700',
    marginTop: spacing.xs,
  },
  chipRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'white',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.muted,
  },
  actionBtn: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  actionText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primary,
  },
  tableHeader: {
    flexDirection: 'row',
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  cell: {
    flex: 1,
    fontSize: 14,
  },
  headerCell: {
    fontWeight: '600',
    color: colors.muted,
    fontSize: 12,
    textTransform: 'uppercase',
  },
});
