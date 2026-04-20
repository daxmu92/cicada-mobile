import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { listAccounts } from '../../src/db/account-repo';
import { listAssets } from '../../src/db/asset-repo';
import {
  getLastSnapshotBefore,
  getSnapshot,
  listSnapshotsByAsset,
} from '../../src/db/snapshot-repo';
import { currentYearMonth } from '../../src/utils/date';
import { useFormat } from '../../src/hooks/SettingsContext';
import type { Account, AssetWithAccount } from '../../src/utils/types';
import { colors, shared, spacing } from '../../src/utils/theme';
import { Sparkline } from '../../src/components/charts/Sparkline';

type EnrichedAsset = AssetWithAccount & {
  netWorth: number;
  history: number[];
};

type AccountGroup = {
  account: Account;
  assets: EnrichedAsset[];
};

export default function AssetsScreen() {
  const router = useRouter();
  const { fmt } = useFormat();
  const [groups, setGroups] = useState<AccountGroup[]>([]);

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

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  if (groups.length === 0) {
    return (
      <View style={[shared.screen, styles.empty]}>
        <Text style={shared.heading}>No accounts yet</Text>
        <Text style={shared.muted}>Go to Settings to create an account and add assets.</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={shared.screen}
      contentContainerStyle={shared.scrollContent}
      data={groups}
      keyExtractor={(g) => String(g.account.id)}
      renderItem={({ item }) => (
        <View style={shared.card}>
          <Text style={styles.accountName}>{item.account.name}</Text>
          {item.assets.length === 0 ? (
            <Text style={shared.muted}>No assets</Text>
          ) : (
            item.assets.map((asset) => {
              const trendColor =
                asset.history.length > 1 &&
                asset.history[asset.history.length - 1] >= asset.history[0]
                  ? colors.positive
                  : colors.negative;
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
});
