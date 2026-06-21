import { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { listAccounts } from '../../src/db/account-repo';
import { listAssets } from '../../src/db/asset-repo';
import {
  getLastSnapshotBefore,
  getSnapshot,
  listSnapshotsByAsset,
  listSnapshotsByDate,
  upsertSnapshot,
} from '../../src/db/snapshot-repo';
import { currentYearMonth } from '../../src/utils/date';
import { confirmAsync, notify } from '../../src/utils/dialog';
import { useFormat, useSemanticColors } from '../../src/hooks/SettingsContext';
import type { Account, AssetWithAccount, SnapshotWithAsset } from '../../src/utils/types';
import { colors, shared, spacing } from '../../src/utils/theme';
import { Sparkline } from '../../src/components/charts/Sparkline';
import { MonthSelector } from '../../src/components/MonthSelector';
import { AssetEntryCard, type SnapshotDraft } from '../../src/components/AssetEntryCard';

type EnrichedAsset = AssetWithAccount & {
  netWorth: number;
  history: number[];
};

type AccountGroup = {
  account: Account;
  assets: EnrichedAsset[];
};

function sameNum(a: string, b: string): boolean {
  const x = parseFloat(a);
  const y = parseFloat(b);
  if (isNaN(x) && isNaN(y)) return true;
  return x === y;
}

function isDirty(d: SnapshotDraft, base: SnapshotDraft): boolean {
  return !sameNum(d.netWorth, base.netWorth) || !sameNum(d.inflow, base.inflow) || !sameNum(d.profit, base.profit);
}

export default function AssetsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { fmt } = useFormat();
  const { gain, loss } = useSemanticColors();
  const [groups, setGroups] = useState<AccountGroup[]>([]);

  // Entry-mode state
  const [entryMode, setEntryMode] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(currentYearMonth());
  const [monthSnapshots, setMonthSnapshots] = useState<Map<number, SnapshotWithAsset>>(new Map());
  const [drafts, setDrafts] = useState<Map<number, SnapshotDraft>>(new Map());
  const [baselines, setBaselines] = useState<Map<number, SnapshotDraft>>(new Map());
  const [lastNetWorthByAsset, setLastNetWorthByAsset] = useState<Map<number, number>>(new Map());
  const [expandedAssetId, setExpandedAssetId] = useState<number | null>(null);

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

  const loadMonthSnapshots = useCallback(async () => {
    const snaps = await listSnapshotsByDate(selectedMonth);
    const m = new Map<number, SnapshotWithAsset>();
    snaps.forEach((s) => m.set(s.assetId, s));
    setMonthSnapshots(m);
  }, [selectedMonth]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  useEffect(() => {
    if (entryMode) loadMonthSnapshots();
  }, [entryMode, loadMonthSnapshots]);

  const assetNameById = (id: number): string => {
    for (const g of groups) {
      const a = g.assets.find((x) => x.id === id);
      if (a) return a.name;
    }
    return String(id);
  };

  const dirtyEntries = (): [number, SnapshotDraft][] =>
    [...drafts.entries()].filter(([id, d]) => {
      const base = baselines.get(id);
      return base != null && isDirty(d, base);
    });

  const dirtyCount = dirtyEntries().length;

  const clearDrafts = () => {
    setDrafts(new Map());
    setBaselines(new Map());
    setLastNetWorthByAsset(new Map());
    setExpandedAssetId(null);
  };

  const exitEntryMode = () => {
    clearDrafts();
    setEntryMode(false);
  };

  const enterEntryMode = () => {
    setSelectedMonth(currentYearMonth());
    clearDrafts();
    setEntryMode(true);
  };

  const onCancel = async () => {
    if (dirtyCount > 0) {
      const ok = await confirmAsync(t('batchEntry.cancelTitle'), t('batchEntry.cancelBody'));
      if (!ok) return;
    }
    exitEntryMode();
  };

  const onChangeMonth = async (ym: string) => {
    if (ym === selectedMonth) return;
    if (dirtyCount > 0) {
      const ok = await confirmAsync(t('batchEntry.switchTitle'), t('batchEntry.switchBody'));
      if (!ok) return;
    }
    clearDrafts();
    setSelectedMonth(ym);
  };

  const expand = async (assetId: number) => {
    if (!baselines.has(assetId)) {
      const last = await getLastSnapshotBefore(assetId, selectedMonth);
      const lastNW = last?.netWorth ?? 0;
      // Query the snapshot directly rather than reading monthSnapshots state,
      // which may not have loaded yet if the user taps an asset immediately
      // after entering entry mode — a stale empty map would mis-prefill from
      // last-known net worth and cache a wrong baseline for the session.
      const existing = await getSnapshot(assetId, selectedMonth);
      const base: SnapshotDraft = existing
        ? {
            netWorth: String(existing.netWorth),
            inflow: String(existing.inflow),
            profit: String(existing.profit),
            autoFill: true,
          }
        : { netWorth: String(lastNW), inflow: '', profit: '', autoFill: true };
      setLastNetWorthByAsset((prev) => new Map(prev).set(assetId, lastNW));
      setBaselines((prev) => new Map(prev).set(assetId, base));
      setDrafts((prev) => (prev.has(assetId) ? prev : new Map(prev).set(assetId, base)));
    }
    setExpandedAssetId(assetId);
  };

  const onDraftChange = (assetId: number, draft: SnapshotDraft) => {
    setDrafts((prev) => new Map(prev).set(assetId, draft));
  };

  const onReset = (assetId: number) => {
    const base = baselines.get(assetId);
    if (base) setDrafts((prev) => new Map(prev).set(assetId, base));
  };

  const submit = async () => {
    const dirty = dirtyEntries();
    const failed: string[] = [];
    const succeeded: number[] = [];
    for (const [id, d] of dirty) {
      const n = parseFloat(d.netWorth);
      const i = d.inflow.trim() === '' ? 0 : parseFloat(d.inflow);
      const p = d.profit.trim() === '' ? 0 : parseFloat(d.profit);
      if (isNaN(n) || isNaN(i) || isNaN(p)) {
        failed.push(assetNameById(id));
        continue;
      }
      try {
        await upsertSnapshot(id, selectedMonth, n, i, p);
        succeeded.push(id);
      } catch {
        failed.push(assetNameById(id));
      }
    }
    if (succeeded.length > 0) {
      setDrafts((prev) => {
        const m = new Map(prev);
        succeeded.forEach((id) => m.delete(id));
        return m;
      });
      setBaselines((prev) => {
        const m = new Map(prev);
        succeeded.forEach((id) => m.delete(id));
        return m;
      });
    }
    await loadData();
    if (failed.length > 0) {
      await loadMonthSnapshots();
      notify(t('batchEntry.skippedTitle'), t('batchEntry.skippedBody', { names: failed.join(', ') }));
    } else {
      exitEntryMode();
    }
  };

  const renderHeader = () => {
    if (!entryMode) {
      if (groups.every((g) => g.assets.length === 0)) return null;
      return (
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.enterBtn} onPress={enterEntryMode}>
            <Text style={styles.enterText}>{t('batchEntry.enter')}</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return (
      <View style={styles.toolbar}>
        <TouchableOpacity onPress={onCancel} style={styles.toolBtn}>
          <Text style={styles.toolText}>{t('common.cancel')}</Text>
        </TouchableOpacity>
        <MonthSelector value={selectedMonth} onChange={onChangeMonth} />
        <TouchableOpacity
          onPress={submit}
          disabled={dirtyCount === 0}
          style={styles.toolBtn}>
          <Text style={[styles.toolText, styles.submitText, dirtyCount === 0 && styles.disabled]}>
            {t('batchEntry.submit', { count: dirtyCount })}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderEntryRow = (asset: EnrichedAsset) => {
    if (expandedAssetId === asset.id) {
      const draft = drafts.get(asset.id);
      if (!draft) return null;
      return (
        <AssetEntryCard
          key={asset.id}
          assetName={asset.name}
          lastNetWorth={lastNetWorthByAsset.get(asset.id) ?? 0}
          draft={draft}
          onChange={(d) => onDraftChange(asset.id, d)}
          onReset={() => onReset(asset.id)}
          onCollapse={() => setExpandedAssetId(null)}
        />
      );
    }
    const base = baselines.get(asset.id);
    const d = drafts.get(asset.id);
    const dirty = base != null && d != null && isDirty(d, base);
    const recorded = monthSnapshots.has(asset.id);
    return (
      <TouchableOpacity key={asset.id} onPress={() => expand(asset.id)} style={styles.assetRow}>
        <Text style={[styles.assetName, { flex: 1 }]}>{asset.name}</Text>
        {dirty ? (
          <Text style={[styles.marker, { color: colors.primary }]}>{t('batchEntry.edited')}</Text>
        ) : recorded ? (
          <Text style={styles.marker}>{t('batchEntry.recorded')}</Text>
        ) : null}
      </TouchableOpacity>
    );
  };

  if (groups.length === 0) {
    return (
      <View style={[shared.screen, styles.empty]}>
        <Text style={shared.heading}>{t('assets.noAccountsTitle')}</Text>
        <Text style={shared.muted}>{t('assets.noAccountsBody')}</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={shared.screen}
      contentContainerStyle={shared.scrollContent}
      data={groups}
      keyExtractor={(g) => String(g.account.id)}
      ListHeaderComponent={renderHeader()}
      renderItem={({ item }) => (
        <View style={shared.card}>
          <Text style={styles.accountName}>{item.account.name}</Text>
          {item.assets.length === 0 ? (
            <Text style={shared.muted}>{t('assets.noAssets')}</Text>
          ) : entryMode ? (
            item.assets.map((asset) => renderEntryRow(asset))
          ) : (
            item.assets.map((asset) => {
              const trendColor =
                asset.history.length > 1 &&
                asset.history[asset.history.length - 1] >= asset.history[0]
                  ? gain
                  : loss;
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
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: spacing.sm,
  },
  enterBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 8,
  },
  enterText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  toolBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  toolText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.muted,
  },
  submitText: {
    color: colors.primary,
  },
  disabled: {
    opacity: 0.4,
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
  marker: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.muted,
  },
});
