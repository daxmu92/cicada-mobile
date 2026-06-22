import { useCallback, useEffect, useState } from 'react';
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
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { confirmAsync, notify } from '../../src/utils/dialog';
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

function formatYM(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function parseYM(s: string): Date {
  const [y, m] = s.split('-').map(Number);
  return new Date(y || new Date().getFullYear(), (m || 1) - 1, 1);
}

export default function AddRecordModal() {
  const router = useRouter();
  const { t } = useTranslation();
  const { fmt } = useFormat();
  const shared = useShared();
  const styles = useThemedStyles(makeStyles);
  const params = useLocalSearchParams<{ assetId: string; date: string }>();
  const assetId = Number(params.assetId);
  const [date, setDate] = useState(params.date ?? '');
  const [showPicker, setShowPicker] = useState(false);
  const [assetName, setAssetName] = useState('');
  const [accountName, setAccountName] = useState('');
  const [lastNetWorth, setLastNetWorth] = useState(0);
  const [hasExisting, setHasExisting] = useState(false);

  const onPickerChange = (event: DateTimePickerEvent, selected?: Date) => {
    if (Platform.OS === 'android') {
      setShowPicker(false);
      if (event.type === 'set' && selected) {
        setDate(formatYM(selected));
      }
    } else if (selected) {
      setDate(formatYM(selected));
    }
  };

  const [netWorth, setNetWorth] = useState('');
  const [inflow, setInflow] = useState('');
  const [profit, setProfit] = useState('');
  const [autoFill, setAutoFill] = useState(true);

  const loadData = useCallback(async () => {
    const asset = await getAsset(assetId);
    if (!asset) return;
    setAssetName(asset.name);
    const acc = await getAccount(asset.accountId);
    setAccountName(acc?.name ?? '');

    const existing = await getSnapshot(assetId, date);
    if (existing) {
      setHasExisting(true);
      setNetWorth(String(existing.netWorth));
      setInflow(String(existing.inflow));
      setProfit(String(existing.profit));
    } else {
      setHasExisting(false);
    }

    const last = await getLastSnapshotBefore(assetId, date);
    setLastNetWorth(last?.netWorth ?? 0);
  }, [assetId, date]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const updateNetWorth = (v: string) => {
    setNetWorth(v);
    if (autoFill && !hasExisting) {
      const n = parseFloat(v) || 0;
      const i = parseFloat(inflow) || 0;
      setProfit(String(computeProfit(n, lastNetWorth, i)));
    }
  };

  const updateInflow = (v: string) => {
    setInflow(v);
    if (autoFill) {
      const n = parseFloat(netWorth) || 0;
      const i = parseFloat(v) || 0;
      setProfit(String(computeProfit(n, lastNetWorth, i)));
    }
  };

  const updateProfit = (v: string) => {
    setProfit(v);
    if (autoFill) {
      const n = parseFloat(netWorth) || 0;
      const p = parseFloat(v) || 0;
      setInflow(String(computeInflow(n, lastNetWorth, p)));
    }
  };

  const submit = async () => {
    const n = parseFloat(netWorth);
    const i = parseFloat(inflow) || 0;
    const p = parseFloat(profit) || 0;
    if (isNaN(n)) {
      notify(t('addRecord.invalidTitle'), t('addRecord.invalidNetWorth'));
      return;
    }
    await upsertSnapshot(assetId, date, n, i, p);
    router.back();
  };

  const confirmDelete = async () => {
    const ok = await confirmAsync(
      t('addRecord.deleteTitle'),
      t('addRecord.deleteBody', { date }),
      t('common.delete'),
      true
    );
    if (!ok) return;
    await deleteSnapshot(assetId, date);
    router.back();
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={shared.screen} contentContainerStyle={shared.scrollContent}>
        <View style={shared.card}>
          <Text style={shared.sectionTitle}>
            {accountName} · {assetName}
          </Text>
          <TouchableOpacity onPress={() => setShowPicker((s) => !s)}>
            <Text style={styles.dateLabel}>{t('addRecord.dateLabel', { date })}</Text>
          </TouchableOpacity>
          {showPicker && (
            <View style={styles.pickerWrap}>
              <DateTimePicker
                value={parseYM(date)}
                mode="date"
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
                onChange={onPickerChange}
              />
              {Platform.OS === 'ios' && (
                <TouchableOpacity
                  style={styles.doneBtn}
                  onPress={() => setShowPicker(false)}>
                  <Text style={styles.doneText}>{t('common.done')}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          <Text style={shared.muted}>
            {t('addRecord.previousNetWorth', { value: fmt(lastNetWorth) })}
          </Text>
        </View>

        <View style={shared.card}>
          <View style={styles.autoFillRow}>
            <Text style={styles.label}>{t('addRecord.autoCalculate')}</Text>
            <Switch value={autoFill} onValueChange={setAutoFill} />
          </View>
          <Text style={shared.muted}>
            {t('addRecord.autoCalcHelp')}
          </Text>
        </View>

        <View style={shared.card}>
          <Text style={styles.label}>{t('addRecord.netWorth')}</Text>
          <TextInput
            style={styles.input}
            value={netWorth}
            onChangeText={updateNetWorth}
            placeholder={t('addRecord.valuePlaceholder')}
            keyboardType="decimal-pad"
          />

          <Text style={styles.label}>{t('addRecord.inflow')}</Text>
          <TextInput
            style={styles.input}
            value={inflow}
            onChangeText={updateInflow}
            placeholder={t('addRecord.valuePlaceholder')}
            keyboardType="decimal-pad"
          />

          <Text style={styles.label}>{t('addRecord.profit')}</Text>
          <TextInput
            style={styles.input}
            value={profit}
            onChangeText={updateProfit}
            placeholder={t('addRecord.valuePlaceholder')}
            keyboardType="decimal-pad"
          />
        </View>

        <TouchableOpacity style={styles.submitBtn} onPress={submit}>
          <Text style={styles.submitText}>{hasExisting ? t('common.update') : t('common.save')}</Text>
        </TouchableOpacity>

        {hasExisting && (
          <TouchableOpacity style={styles.deleteBtn} onPress={confirmDelete}>
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
