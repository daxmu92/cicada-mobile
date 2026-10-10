import { useDesktopEntry } from '../../src/hooks/use-desktop-entry';
import { useDesktopLayout } from '../../src/hooks/use-desktop-layout';
import { AssetInspector } from '../../src/components/desktop/AssetInspector';
import { useRecoverableDraft } from '../../src/hooks/use-recoverable-draft';
import { DraftRecoveryNotice } from '../../src/components/DraftRecoveryNotice';
import { ObservationNotice } from '../../src/components/ObservationNotice';
import { getObservationMetadata, type ObservationMetadata } from '../../src/db/observation-repo';
import { useObservationMonth } from '../../src/hooks/use-observation-month';
import { getLedgerEpoch,getLedgerMode,useLedgerMode } from '../../src/ledger/mode';
import { useUnsavedChanges } from '../../src/hooks/use-unsaved-changes';
import { parseAmount, tryAmount } from '../../src/utils/money';
import { useSaveAction } from '../../src/hooks/use-save-action';
import { useDataVersion } from '../../src/hooks/use-data-version';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { listAccounts } from '../../src/db/account-repo';
import { listAssetOverview } from '../../src/db/asset-repo';
import {
  getLastSnapshotBefore,
  getSnapshot,
  listSnapshotsByDate,
  upsertSnapshot,
} from '../../src/db/snapshot-repo';
import { currentYearMonth } from '../../src/utils/date';
import { confirmAsync, notify } from '../../src/utils/dialog';
import { useFormat, useSemanticColors, useShared, useTheme, useThemedStyles, useSettings } from '../../src/hooks/SettingsContext';
import type { Account, AssetWithAccount, SnapshotWithAsset } from '../../src/utils/types';
import { spacing, type ThemeColors } from '../../src/utils/theme';
import { Sparkline } from '../../src/components/charts/Sparkline';
import { MonthSelector } from '../../src/components/MonthSelector';
import { AssetEntryCard, type SnapshotDraft } from '../../src/components/AssetEntryCard';

type EnrichedAsset = AssetWithAccount & {
  netWorth: number | null;
  history: number[];
  sourceDate?: string | null;
  lastRecorded?: string | null;
};

type AccountGroup = {
  account: Account;
  assets: EnrichedAsset[];
};

function sameNum(a: string, b: string): boolean {
  const x = tryAmount(a);
  const y = tryAmount(b);
  if (x === null || y === null) return a === b;
  return x === y;
}

function isDirty(d: SnapshotDraft, base: SnapshotDraft): boolean {
  return !sameNum(d.netWorth, base.netWorth) || !sameNum(d.inflow, base.inflow) || !sameNum(d.profit, base.profit);
}

export default function AssetsScreen() {
  const { t } = useTranslation();
  const dataVersion = useDataVersion();
  const mode=useLedgerMode();const epoch=getLedgerEpoch();
  const entryEpoch=useRef(epoch);
  const [groupEpoch,setGroupEpoch]=useState(-1);
  const [entryLedger,setEntryLedger]=useState(mode);
  const [groupLedger,setGroupLedger]=useState(mode);
  const router = useRouter();
  const { fmt } = useFormat();
  const { forwardFill } = useSettings();
  const { gain, loss } = useSemanticColors();
  const shared = useShared();
  const styles = useThemedStyles(makeStyles);
  const c = useTheme();
  const { saving, save } = useSaveAction();
  const entrySession = useRef(0);
  const overviewRequest = useRef(0);
  const snapshotRequest = useRef(0);
  const [observationMonth,setObservationMonth]=useObservationMonth();
  const { desktop, contentWidth, split }=useDesktopLayout();
  const [inspectedAsset,setInspectedAsset]=useState<number|null>(null);
  const wide=desktop&&contentWidth>=820;
  const [search,setSearch]=useState('');
  const [category,setCategory]=useState('');
  const [sort,setSort]=useState<'name'|'value'>('name');
  const [metadata,setMetadata]=useState<ObservationMetadata|null>(null);
  const [loadedMonth,setLoadedMonth]=useState('');
  const [groups, setGroups] = useState<AccountGroup[]>([]);

  // Entry-mode state
  const [entryMode, setEntryMode] = useState(false);
  const activeEntry=entryMode&&entryLedger===mode&&entryEpoch.current===epoch;
  const {setActive:setDesktopEntryActive}=useDesktopEntry();
  useEffect(()=>{setDesktopEntryActive(activeEntry);return()=>setDesktopEntryActive(false);},[activeEntry,setDesktopEntryActive]);
  const [selectedMonth, setSelectedMonth] = useState(currentYearMonth());
  const [snapshotsMonth,setSnapshotsMonth]=useState('');
  const [monthSnapshots, setMonthSnapshots] = useState<Map<number, SnapshotWithAsset>>(new Map());
  const [drafts, setDrafts] = useState<Map<number, SnapshotDraft>>(new Map());
  const [baselines, setBaselines] = useState<Map<number, SnapshotDraft>>(new Map());
  const [lastNetWorthByAsset, setLastNetWorthByAsset] = useState<Map<number, number>>(new Map());
  const [expandedAssetId, setExpandedAssetId] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    void mode;
    const generation = ++overviewRequest.current;
    const ledger=getLedgerMode();const capturedEpoch=getLedgerEpoch();
    const [accounts, enriched,meta] = await Promise.all([listAccounts(), listAssetOverview(observationMonth, forwardFill),getObservationMetadata(observationMonth)]);

    const byAccount = accounts.map((acc) => ({
      account: acc,
      assets: enriched.filter((a) => a.accountId === acc.id),
    }));
    if (generation === overviewRequest.current&&ledger===getLedgerMode()&&capturedEpoch===getLedgerEpoch()) {setGroups(byAccount);setGroupLedger(ledger);setGroupEpoch(capturedEpoch);setMetadata(meta);setLoadedMonth(observationMonth);}
  }, [forwardFill,mode,observationMonth]);

  const loadMonthSnapshots = useCallback(async () => {
    const generation = ++snapshotRequest.current;
    const session = entrySession.current;
    const snaps = await listSnapshotsByDate(selectedMonth);
    const m = new Map<number, SnapshotWithAsset>();
    snaps.forEach((s) => m.set(s.assetId, s));
    if (generation === snapshotRequest.current && session === entrySession.current) {setMonthSnapshots(m);setSnapshotsMonth(selectedMonth);}
  }, [selectedMonth]);

  useFocusEffect(
    useCallback(() => {
      void dataVersion;
      void loadData().catch(() => notify(t('common.error'), t('common.loadFailed')));
    }, [loadData, dataVersion, t])
  );

  useEffect(() => {
    if (activeEntry) void loadMonthSnapshots().catch(() => notify(t('common.error'), t('common.loadFailed')));
    void dataVersion;
  }, [activeEntry, loadMonthSnapshots, dataVersion, t]);

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
  type BatchDraft={uuid:string;draft:SnapshotDraft;base:SnapshotDraft};
  const batchValue=dirtyEntries().map(([id,draft])=>({uuid:groups.flatMap(group=>group.assets).find(asset=>asset.id===id)?.uuid,name:assetNameById(id),draft,base:baselines.get(id)}));
  const validBatch=(value:unknown):value is BatchDraft[]=>Array.isArray(value)&&value.every(item=>item&&typeof item.uuid==='string'&&[item.draft,item.base].every(d=>d&&['netWorth','inflow','profit'].every(key=>typeof d[key]==='string')&&typeof d.autoFill==='boolean'));
  const recovery=useRecoverableDraft({key:`batch:${selectedMonth}`,ready:activeEntry&&snapshotsMonth===selectedMonth,dirty:dirtyCount>0,baseline:`batch:${selectedMonth}`,value:batchValue,valid:value=>validBatch(value)&&value.every(item=>{
    const asset=groups.flatMap(group=>group.assets).find(a=>a.uuid===item.uuid);if(!asset)return false;
    const snapshot=monthSnapshots.get(asset.id);return snapshot?item.base.netWorth===String(snapshot.netWorth)&&item.base.inflow===String(snapshot.inflow)&&item.base.profit===String(snapshot.profit):item.base.inflow===''&&item.base.profit==='';
  }),restore:async value=>{
    if(!validBatch(value))throw new Error('Invalid batch draft');
    const captured=getLedgerEpoch(),restored=new Map<number,SnapshotDraft>(),bases=new Map<number,SnapshotDraft>(),prior=new Map<number,number>();
    for(const item of value){
      const asset=groups.flatMap(group=>group.assets).find(a=>a.uuid===item.uuid);if(!asset)throw new Error('Draft asset changed');
      const [existing,last]=await Promise.all([getSnapshot(asset.id,selectedMonth),getLastSnapshotBefore(asset.id,selectedMonth)]);
      const base=existing?{netWorth:String(existing.netWorth),inflow:String(existing.inflow),profit:String(existing.profit),autoFill:true}:{netWorth:String(last?.netWorth??0),inflow:'',profit:'',autoFill:true};
      if(isDirty(item.base,base))throw new Error('Draft baseline changed');
      restored.set(asset.id,item.draft);bases.set(asset.id,base);prior.set(asset.id,last?.netWorth??0);
    }
    if(captured!==getLedgerEpoch())throw new Error('Ledger changed');
    setDrafts(restored);setBaselines(bases);setLastNetWorthByAsset(prior);setExpandedAssetId(restored.keys().next().value??null);
  }});


  const clearDrafts = () => {
    entrySession.current++; snapshotRequest.current++;
    setMonthSnapshots(new Map());setSnapshotsMonth('');
    setDrafts(new Map());
    setBaselines(new Map());
    setLastNetWorthByAsset(new Map());
    setExpandedAssetId(null);
  };

  const exitEntryMode = () => {
    clearDrafts();
    setEntryMode(false);
  };

  useUnsavedChanges(activeEntry&&dirtyCount>0,saving,async()=>{if(!await recovery.clear())throw new Error('Draft cleanup failed');exitEntryMode();});
  useEffect(()=>{
    entrySession.current++;snapshotRequest.current++;
    setDrafts(new Map());setBaselines(new Map());setLastNetWorthByAsset(new Map());setExpandedAssetId(null);setMonthSnapshots(new Map());setEntryMode(false);setSearch('');setCategory('');
  },[mode,epoch]);

  const enterEntryMode = () => {
    entryEpoch.current=getLedgerEpoch();setEntryLedger(getLedgerMode());
    setSelectedMonth(observationMonth);
    clearDrafts();
    setEntryMode(true);
  };

  const onCancel = async () => {
    if (dirtyCount > 0||recovery.draft) {
      const ok = await confirmAsync(t('batchEntry.cancelTitle'), t('batchEntry.cancelBody'));
      if (!ok) return;
    }
    if(await recovery.clear())exitEntryMode();
  };

  const onChangeMonth = async (ym: string) => {
    if (ym === selectedMonth) return;
    if (dirtyCount > 0) {
      const ok = await confirmAsync(t('batchEntry.switchTitle'), t('batchEntry.switchBody'));
      if (!ok) return;
    }
    if(!await recovery.clear())return;clearDrafts();
    setSelectedMonth(ym);setObservationMonth(ym);
  };

  const expand = async (assetId: number) => {
    if(!activeEntry||entryLedger!==getLedgerMode()||recovery.blocked)return;
    const session = entrySession.current;
    if (!baselines.has(assetId)) {
      const last = await getLastSnapshotBefore(assetId, selectedMonth);
      const lastNW = last?.netWorth ?? 0;
      // Query the snapshot directly rather than reading monthSnapshots state,
      // which may not have loaded yet if the user taps an asset immediately
      // after entering entry mode — a stale empty map would mis-prefill from
      // last-known net worth and cache a wrong baseline for the session.
      const existing = await getSnapshot(assetId, selectedMonth);
      if (session !== entrySession.current||entryLedger!==getLedgerMode()) return;
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
    if (session === entrySession.current&&entryLedger===getLedgerMode()) setExpandedAssetId(assetId);
  };

  const onDraftChange = (assetId: number, draft: SnapshotDraft) => {
    if(entryLedger!==getLedgerMode())return;
    setDrafts((prev) => new Map(prev).set(assetId, draft));
  };

  const onReset = (assetId: number) => {
    const base = baselines.get(assetId);
    if (base) setDrafts((prev) => new Map(prev).set(assetId, base));
  };

  const submit = () => save(async () => {
    if(!activeEntry||entryLedger!==getLedgerMode()||recovery.blocked)return;
    recovery.pause();
    const dirty = dirtyEntries();
    const failed: string[] = [];
    const succeeded: number[] = [];
    for (const [id, d] of dirty) {
      try {
        const n = parseAmount(d.netWorth);
        const i = parseAmount(d.inflow, true);
        const p = parseAmount(d.profit, true);
        const uuid=groups.flatMap(group=>group.assets).find(a=>a.id===id)?.uuid;
        if(!uuid)throw new Error('Asset identity missing');
        await upsertSnapshot(id, selectedMonth, n, i, p,{key:`batch:${selectedMonth}`,assetUuid:uuid});
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
      recovery.resume();
      await loadMonthSnapshots();
      notify(t('batchEntry.skippedTitle'), t('batchEntry.skippedBody', { names: failed.join(', ') }));
    } else {
      recovery.consumed();exitEntryMode();
    }
  });

  const categories=[...new Set(groups.flatMap(group=>group.assets.flatMap(asset=>Object.values(asset.categories))))].sort();
  const visibleGroups=activeEntry?groups:groups.map(group=>({...group,assets:group.assets.filter(asset=>(!category||Object.values(asset.categories).includes(category))&&(!search.trim()||(asset.name+' '+group.account.name).toLowerCase().includes(search.trim().toLowerCase()))).sort((a,b)=>sort==='value'?(b.netWorth??-Infinity)-(a.netWorth??-Infinity):a.name.localeCompare(b.name))})).filter(group=>!search&&!category||group.assets.length>0);
  const renderHeader = () => {
    if (!activeEntry) {
      return (
        <View>
          {!desktop&&<MonthSelector value={observationMonth} onChange={setObservationMonth}/>}
          <ObservationNotice meta={metadata} month={observationMonth} onLatest={setObservationMonth}/>
          <TextInput accessibilityLabel={t('assets.search')} placeholder={t('assets.search')} value={search} onChangeText={setSearch} style={{borderWidth:1,borderColor:c.border,color:c.ink,padding:10,borderRadius:8,marginBottom:10}}/>
          <View style={{flexDirection:'row',flexWrap:'wrap',gap:8,marginBottom:12}}>
            {['',...categories].map(value=><TouchableOpacity accessibilityRole="button" key={value} onPress={()=>setCategory(value)} style={{padding:8,borderRadius:8,backgroundColor:category===value?c.accentSoft:c.card}}><Text style={{color:c.ink}}>{value||t('assets.allCategories')}</Text></TouchableOpacity>)}
            <TouchableOpacity accessibilityRole="button" onPress={()=>setSort(sort==='name'?'value':'name')}><Text style={{color:c.primary,padding:8}}>{t(sort==='name'?'assets.sortName':'assets.sortValue')}</Text></TouchableOpacity>
          </View>
          <View style={styles.topBar}>
          <TouchableOpacity accessibilityRole="button" style={styles.enterBtn} onPress={() => router.push('/modals/manage-accounts')}><Text style={styles.enterText}>{t('settings.accountsAssets')}</Text></TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={t('batchEntry.enter')} style={styles.enterBtn} onPress={enterEntryMode}>
            <Text style={styles.enterText}>{t('batchEntry.enter')}</Text>
          </TouchableOpacity>
          </View>
        </View>
      );
    }
    return (
      <View>
      <DraftRecoveryNotice recovery={recovery}/>
      <View style={styles.toolbar}>
        <TouchableOpacity onPress={onCancel} disabled={saving} style={styles.toolBtn}>
          <Text style={styles.toolText}>{t('common.cancel')}</Text>
        </TouchableOpacity>
        <MonthSelector disabled={saving||recovery.blocked} value={selectedMonth} onChange={onChangeMonth} />
        <TouchableOpacity
          onPress={submit}
          disabled={saving || recovery.blocked || dirtyCount === 0}
          style={styles.toolBtn}>
          <Text style={[styles.toolText, styles.submitText, dirtyCount === 0 && styles.disabled]}>
            {t('batchEntry.submit', { count: dirtyCount })}
          </Text>
        </TouchableOpacity>
      </View>
      </View>
    );
  };

  const renderEntryRow = (asset: EnrichedAsset) => {
    if (expandedAssetId === asset.id) {
      const draft = drafts.get(asset.id);
      if (!draft) return null;
      return (
        <AssetEntryCard disabled={saving}
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
      <TouchableOpacity key={asset.id} disabled={saving} onPress={() => { void expand(asset.id).catch(() => notify(t('common.error'), t('common.loadFailed'))); }} style={styles.assetRow}>
        <Text style={[styles.assetName, { flex: 1 }]}>{asset.name}</Text>
        {dirty ? (
          <Text style={[styles.marker, { color: c.primary }]}>{t('batchEntry.edited')}</Text>
        ) : recorded ? (
          <Text style={styles.marker}>{t('batchEntry.recorded')}</Text>
        ) : null}
      </TouchableOpacity>
    );
  };

  if(groupLedger!==mode||groupEpoch!==epoch||loadedMonth!==observationMonth)return <View style={shared.screen}><Text style={shared.muted}>{t('common.loading')}</Text></View>;
  if (groups.length === 0) {
    return (
      <View style={[shared.screen, styles.empty]}>
        <Text style={shared.heading}>{t('assets.noAccountsTitle')}</Text>
        <Text style={shared.muted}>{t('assets.noAccountsBody')}</Text>
        <TouchableOpacity accessibilityRole="button" style={styles.enterBtn} onPress={() => router.push('/modals/manage-accounts')}><Text style={styles.enterText}>{t('settings.accountsAssets')}</Text></TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[shared.screen,{flexDirection:'row'}]}>
    <FlatList
      style={shared.screen}
      contentContainerStyle={[shared.scrollContent,desktop&&{maxWidth:1440,padding:24}]}
      data={visibleGroups}
      ListEmptyComponent={<Text style={shared.muted}>{t('assets.noMatches')}</Text>}
      keyExtractor={(g) => String(g.account.id)}
      ListHeaderComponent={renderHeader()}
      renderItem={({ item }) => (
        <View style={shared.card}>
          <Text style={styles.accountName}>{item.account.name}</Text>
          {wide&&!activeEntry&&<View style={{flexDirection:'row',gap:8,paddingVertical:8}}><Text style={{flex:1,color:c.muted}}>{t('assets.assetColumn')}</Text><Text style={{width:70,color:c.muted}}>{t('analysis.trendTitle')}</Text><Text style={{width:140,textAlign:'right',color:c.muted}}>{t('addRecord.netWorth')}</Text><Text style={{width:100,textAlign:'right',color:c.muted}}>{t('assets.latestRecord')}</Text></View>}
          {item.assets.length === 0 ? (
            <Text style={shared.muted}>{t('assets.noAssets')}</Text>
          ) : activeEntry ? (
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
                  onPress={() => split ? setInspectedAsset(asset.id) : router.push(`/asset/${asset.id}`)}
                  style={[styles.assetRow,desktop&&{paddingVertical:12,borderBottomWidth:1,borderColor:c.border},inspectedAsset===asset.id&&split&&{backgroundColor:c.accentSoft}]}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.assetName}>{asset.name}</Text>
                    {Object.keys(asset.categories).length > 0 && (
                      <Text style={styles.assetMeta}>
                        {Object.entries(asset.categories).map(([k, v]) => `${k}: ${v}`).join(' · ')}
                      </Text>
                    )}
                    <Text style={styles.assetMeta}>{asset.sourceDate&&asset.sourceDate!==observationMonth?t('assets.carriedFrom',{date:asset.sourceDate}):asset.netWorth===null?t('observation.notRecorded'):''}</Text>
                  </View>
                  <Sparkline values={asset.history} width={70} height={28} color={trendColor} />
                  <Text style={[styles.assetValue,wide&&{width:140}]}>{asset.netWorth === null ? '—' : fmt(asset.netWorth)}</Text>
                  {wide&&<Text style={{width:100,textAlign:'right',color:c.muted,fontSize:12}}>{asset.lastRecorded??'—'}</Text>}
                </TouchableOpacity>
              );
            })
          )}
        </View>
      )}
    />
    {split&&!activeEntry&&inspectedAsset!==null&&groups.some(g=>g.assets.some(a=>a.id===inspectedAsset))&&<AssetInspector key={`${mode}:${epoch}`} assetId={inspectedAsset} month={observationMonth} onClose={()=>setInspectedAsset(null)}/>}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
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
      backgroundColor: c.primary,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: 8,
    },
    enterText: {
      color: c.onAccent,
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
      color: c.muted,
    },
    submitText: {
      color: c.primary,
    },
    disabled: {
      opacity: 0.4,
    },
    accountName: {
      fontSize: 16,
      fontWeight: '700',
      marginBottom: spacing.sm,
      color: c.muted,
    },
    assetRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: spacing.md,
      borderTopWidth: 1,
      borderTopColor: c.border,
      gap: spacing.sm,
    },
    assetName: {
      fontSize: 16,
      fontWeight: '500',
    },
    assetMeta: {
      fontSize: 12,
      color: c.muted,
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
      color: c.muted,
    },
  });
