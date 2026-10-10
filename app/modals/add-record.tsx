import { useRecoverableDraft } from '../../src/hooks/use-recoverable-draft';
import { DraftRecoveryNotice } from '../../src/components/DraftRecoveryNotice';
import { useUnsavedChanges } from '../../src/hooks/use-unsaved-changes';
import { getReconciliationPreview } from '../../src/services/reconciliation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { DateField } from '../../src/components/DateField';
import { parseAmount, tryAmount } from '../../src/utils/money';
import { currentYearMonth } from '../../src/utils/date';
import { useSaveAction } from '../../src/hooks/use-save-action';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { confirmAsync } from '../../src/utils/dialog';
import { getAsset } from '../../src/db/asset-repo';
import { getAccount } from '../../src/db/account-repo';
import {
  deleteSnapshot,
  getLastSnapshotBefore,
  getSnapshot,
  upsertSnapshot,
} from '../../src/db/snapshot-repo';
import { useFormat, useShared, useThemedStyles } from '../../src/hooks/SettingsContext';
import { semantic, spacing, type ThemeColors } from '../../src/utils/theme';
import { computeInflow, computeProfit } from '../../src/utils/snapshot-calc';

export default function AddRecordModal() {
  const router = useRouter();
  const { t } = useTranslation();
  const { fmt } = useFormat();
  const shared = useShared();
  const styles = useThemedStyles(makeStyles);
  const params = useLocalSearchParams<{ assetId: string; date: string }>();
  const assetId = Number(params.assetId);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [date, setDate] = useState(params.date ?? currentYearMonth());
  const { saving, save } = useSaveAction();
  const [assetName, setAssetName] = useState('');
  const [accountName, setAccountName] = useState('');
  const [lastNetWorth, setLastNetWorth] = useState(0);
  const [hasExisting, setHasExisting] = useState(false);

  const [netWorth, setNetWorth] = useState('');
  const [inflow, setInflow] = useState('');
  const [profit, setProfit] = useState('');
  const [autoFill, setAutoFill] = useState(true);

  const recordKey = `${assetId}|${date}`;
  const ready = loadedKey === recordKey;
  const [assetUuid,setAssetUuid]=useState<string|null>(null);
  const [baseline,setBaseline]=useState('');
  const dirty=ready&&JSON.stringify([netWorth,inflow,profit])!==baseline;
  const recovery=useRecoverableDraft({key:assetUuid?`snapshot:${assetUuid}:${date}`:null,ready,dirty,baseline:JSON.stringify([baseline,lastNetWorth]),value:[netWorth,inflow,profit,autoFill],valid:value=>Array.isArray(value)&&value.length===4&&value.slice(0,3).every(v=>typeof v==='string')&&typeof value[3]==='boolean',restore:value=>{const values=value as [string,string,string,boolean];setNetWorth(values[0]);setInflow(values[1]);setProfit(values[2]);setAutoFill(values[3]);}});
  const busy = saving || !ready || recovery.blocked;
  const markSaved=useUnsavedChanges(dirty,saving,async()=>{if(!await recovery.clear())throw new Error('Draft cleanup failed');});
  const request = useRef(0);
  const loadData = useCallback(async (isCancelled: () => boolean) => {
    const generation = ++request.current;
    setLoadedKey(null); setLoadError(false);
    setNetWorth(''); setInflow(''); setProfit(''); setHasExisting(false);
    const asset = await getAsset(assetId);
    if (!asset) throw new Error('Asset not found');
    const [account, existing, last] = await Promise.all([getAccount(asset.accountId), getSnapshot(assetId, date), getLastSnapshotBefore(assetId, date)]);
    if (generation !== request.current || isCancelled()) return;
    setAssetUuid(asset.uuid??null);
    setAssetName(asset.name); setAccountName(account?.name ?? '');
    setHasExisting(existing !== null);
    setNetWorth(existing ? String(existing.netWorth) : '');
    setInflow(existing ? String(existing.inflow) : '');
    setProfit(existing ? String(existing.profit) : '');
    setLastNetWorth(last?.netWorth ?? 0);
    setBaseline(JSON.stringify(existing?[String(existing.netWorth),String(existing.inflow),String(existing.profit)]:['','','']));
    setLoadedKey(`${assetId}|${date}`);
  }, [assetId, date]);

  useEffect(() => {
    let cancelled = false;
    void loadData(() => cancelled).catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, [loadData]);

  const updateNetWorth = (v: string) => {
    setNetWorth(v);
    if (autoFill) {
      const n = tryAmount(v) ?? 0;
      const i = tryAmount(inflow) ?? 0;
      setProfit(String(computeProfit(n, lastNetWorth, i)));
    }
  };

  const updateInflow = (v: string) => {
    setInflow(v);
    if (autoFill) {
      const n = tryAmount(netWorth) ?? 0;
      const i = tryAmount(v) ?? 0;
      setProfit(String(computeProfit(n, lastNetWorth, i)));
    }
  };

  const updateProfit = (v: string) => {
    setProfit(v);
    if (autoFill) {
      const n = tryAmount(netWorth) ?? 0;
      const p = tryAmount(v) ?? 0;
      setInflow(String(computeInflow(n, lastNetWorth, p)));
    }
  };

  const changeDate=async(next:string)=>{
    if(!dirty||await confirmAsync(t('drafts.title'),t('drafts.body'))){if(dirty&&!await recovery.clear())return;setDate(next);}
  };
  const afterWrite=async()=>{
    recovery.consumed();
    const preview=await getReconciliationPreview(assetId).catch(()=>null);
    if(preview?.changes.some(change=>change.date>date)&&await confirmAsync(t('reconcile.title'),t('reconcile.offer'))){markSaved();router.replace(`/modals/reconcile-asset?assetId=${assetId}`);}
    else {markSaved();router.back();}
  };
  const submit = () => {
    if (!ready) return;
    return save(async () => {
      const n = parseAmount(netWorth);
      const i = parseAmount(inflow, true);
      const p = parseAmount(profit, true);
      recovery.pause();
      try{await upsertSnapshot(assetId, date, n, i, p,{key:`snapshot:${assetUuid}:${date}`});}
      catch(error){recovery.resume();throw error;}
      await afterWrite();
    });
  };

  const confirmDelete = () => {
    if (!ready || !hasExisting) return;
    return save(async () => {
      const ok = await confirmAsync(
        t('addRecord.deleteTitle'),
        t('addRecord.deleteBody', { date }),
        t('common.delete'),
        true
      );
      if (!ok) return;
      recovery.pause();
      try{await deleteSnapshot(assetId, date,{key:`snapshot:${assetUuid}:${date}`});}
      catch(error){recovery.resume();throw error;}
      await afterWrite();
    });
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={shared.screen} contentContainerStyle={shared.scrollContent}>
        <DraftRecoveryNotice recovery={recovery}/>
        <View style={shared.card}>
          <Text style={shared.sectionTitle}>
            {accountName} · {assetName}
          </Text>
          <DateField value={date} onChange={(next)=>{void changeDate(next);}} month label={t('addTransaction.date')} disabled={saving} />
          <Text style={shared.muted}>
            {t('addRecord.previousNetWorth', { value: fmt(lastNetWorth) })}
          </Text>
        </View>

        {loadError && <Text style={shared.muted}>{t('common.loadFailed')}</Text>}
        <View style={shared.card}>
          <View style={styles.autoFillRow}>
            <Text style={styles.label}>{t('addRecord.autoCalculate')}</Text>
            <Switch value={autoFill} onValueChange={setAutoFill} disabled={busy} />
          </View>
          <Text style={shared.muted}>
            {t('addRecord.autoCalcHelp')}
          </Text>
        </View>

        <View style={shared.card}>
          <Text style={styles.label}>{t('addRecord.netWorth')}</Text>
          <TextInput
            style={styles.input}
            accessibilityLabel={t('addRecord.netWorth')}
            value={netWorth}
            onChangeText={updateNetWorth}
            placeholder={t('addRecord.valuePlaceholder')}
            keyboardType="decimal-pad"
            editable={!busy}
          />

          <Text style={styles.label}>{t('addRecord.inflow')}</Text>
          <TextInput
            style={styles.input}
            accessibilityLabel={t('addRecord.inflow')}
            value={inflow}
            onChangeText={updateInflow}
            placeholder={t('addRecord.valuePlaceholder')}
            keyboardType="decimal-pad"
            editable={!busy}
          />

          <Text style={styles.label}>{t('addRecord.profit')}</Text>
          <TextInput
            style={styles.input}
            accessibilityLabel={t('addRecord.profit')}
            value={profit}
            onChangeText={updateProfit}
            placeholder={t('addRecord.valuePlaceholder')}
            keyboardType="decimal-pad"
            editable={!busy}
          />
        </View>

        <TouchableOpacity accessibilityRole="button" style={styles.submitBtn} onPress={submit} disabled={busy}>
          <Text style={styles.submitText}>{saving ? t('common.saving') : hasExisting ? t('common.update') : t('common.save')}</Text>
        </TouchableOpacity>

        {hasExisting && (
          <TouchableOpacity style={styles.deleteBtn} onPress={confirmDelete} disabled={busy}>
            <Text style={styles.deleteText}>{t('common.delete')}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    dateLabel: {
      fontSize: 16,
      fontWeight: '600',
      marginTop: spacing.xs,
      marginBottom: spacing.xs,
      color: c.primary,
    },
    pickerWrap: {
      marginTop: spacing.xs,
      marginBottom: spacing.sm,
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 8,
      padding: spacing.sm,
    },
    doneBtn: {
      alignSelf: 'flex-end',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
    },
    doneText: {
      color: c.primary,
      fontSize: 14,
      fontWeight: '600',
    },
    autoFillRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: spacing.sm,
    },
    label: {
      fontSize: 14,
      fontWeight: '600',
      marginBottom: spacing.xs,
      marginTop: spacing.sm,
    },
    input: {
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 8,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      fontSize: 16,
      backgroundColor: c.card,
    },
    submitBtn: {
      backgroundColor: c.primary,
      padding: spacing.md,
      borderRadius: 8,
      alignItems: 'center',
      marginTop: spacing.md,
    },
    submitText: {
      color: c.onAccent,
      fontSize: 16,
      fontWeight: '600',
    },
    deleteBtn: {
      padding: spacing.md,
      borderRadius: 8,
      alignItems: 'center',
      marginTop: spacing.sm,
    },
    deleteText: {
      color: semantic.negative,
      fontSize: 16,
      fontWeight: '600',
    },
  });
