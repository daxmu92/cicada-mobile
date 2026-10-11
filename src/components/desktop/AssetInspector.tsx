import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { getAsset } from '../../db/asset-repo';
import { getAccount } from '../../db/account-repo';
import { listSnapshotsByAsset } from '../../db/snapshot-repo';
import { useFormat, useTheme } from '../../hooks/SettingsContext';
import { useDataVersion } from '../../hooks/use-data-version';
import { getLedgerEpoch } from '../../ledger/mode';
import type { Asset, AssetSnapshot } from '../../utils/types';
import { AssetLineChart } from '../charts/AssetLineChart';

export function AssetInspector({ assetId, month, onClose }: { assetId: number; month: string; onClose: () => void }) {
  const { t } = useTranslation();
  const c = useTheme();
  const { fmt } = useFormat();
  const router = useRouter();
  const version = useDataVersion();
  const epoch = getLedgerEpoch();
  const [result, setResult] = useState<{ id: number; epoch: number; asset: Asset | null; account: string; rows: AssetSnapshot[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    void Promise.all([getAsset(assetId), listSnapshotsByAsset(assetId)]).then(async ([asset, rows]) => {
      const account = asset ? await getAccount(asset.accountId) : null;
      if (!cancelled && epoch === getLedgerEpoch()) setResult({ id: assetId, epoch, asset, account: account?.name ?? '', rows });
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [assetId, epoch, version, retry]);
  const loaded = result?.id === assetId && result.epoch === epoch ? result : null;
  const latest = loaded?.rows.filter(row => row.date <= month).at(-1);
  return <View testID="desktop-asset-inspector" style={{ width: 340, borderLeftWidth: 1, borderColor: c.border, backgroundColor: c.card }}>
    <View style={{ padding: 20, borderBottomWidth: 1, borderColor: c.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Text style={{ fontSize: 14, fontWeight: '700', color: c.ink }}>{t('desktop.assetDetails')}</Text>
      <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('desktop.closeDetails')} onPress={onClose}><Text style={{ color: c.muted, fontSize: 24 }}>×</Text></TouchableOpacity>
    </View>
    <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }}>
      {!loaded ? <><Text style={{ color: c.muted }}>{t(failed ? 'common.loadFailed' : 'common.loading')}</Text>{failed && <TouchableOpacity accessibilityRole="button" onPress={() => setRetry(v => v + 1)}><Text style={{ color: c.accent }}>{t('common.retry')}</Text></TouchableOpacity>}</> : <>
        <Text style={{ color: c.muted, fontSize: 12 }}>{loaded.account}</Text>
        <Text style={{ color: c.ink, fontSize: 22, fontWeight: '700' }}>{loaded.asset?.name ?? t('assets.noAssets')}</Text>
        <Text style={{ color: c.ink, fontSize: 28, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{latest ? fmt(latest.netWorth) : '—'}</Text>
        <Text style={{ color: c.muted, fontSize: 12 }}>{latest ? t('assetDetail.asOf', { date: latest.date }) : t('observation.notRecorded')}</Text>
        {latest?.date !== month && latest && <Text style={{ color: c.muted }}>{t('assets.carriedFrom', { date: latest.date })}</Text>}
        <AssetLineChart data={loaded.rows.filter(row => row.date <= month).slice(-12).map(row => ({ label: row.date, value: row.netWorth }))}/>
        <TouchableOpacity accessibilityRole="button" onPress={() => router.push(`/modals/add-record?assetId=${assetId}&date=${month}`)} style={{ padding: 12, backgroundColor: c.accent, borderRadius: 8 }}><Text style={{ color: c.onAccent, textAlign: 'center', fontWeight: '700' }}>{t('desktop.recordMonth')}</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" onPress={() => router.push(`/asset/${assetId}`)}><Text style={{ color: c.accent }}>{t('desktop.openDetails')}</Text></TouchableOpacity>
      </>}
    </ScrollView>
  </View>;
}
