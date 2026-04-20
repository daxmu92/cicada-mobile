import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
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
import { useLocalSearchParams, useRouter } from 'expo-router';

import { getAsset } from '../../src/db/asset-repo';
import { getAccount } from '../../src/db/account-repo';
import {
  deleteSnapshot,
  getLastSnapshotBefore,
  getSnapshot,
  upsertSnapshot,
} from '../../src/db/snapshot-repo';
import { useFormat } from '../../src/hooks/SettingsContext';
import { colors, shared, spacing } from '../../src/utils/theme';

export default function AddRecordModal() {
  const router = useRouter();
  const { fmt } = useFormat();
  const params = useLocalSearchParams<{ assetId: string; date: string }>();
  const assetId = Number(params.assetId);
  const [date, setDate] = useState(params.date ?? '');
  const [assetName, setAssetName] = useState('');
  const [accountName, setAccountName] = useState('');
  const [lastNetWorth, setLastNetWorth] = useState(0);
  const [hasExisting, setHasExisting] = useState(false);

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
      setProfit(String(n - lastNetWorth - i));
    }
  };

  const updateInflow = (v: string) => {
    setInflow(v);
    if (autoFill) {
      const n = parseFloat(netWorth) || 0;
      const i = parseFloat(v) || 0;
      setProfit(String(n - lastNetWorth - i));
    }
  };

  const updateProfit = (v: string) => {
    setProfit(v);
    if (autoFill) {
      const n = parseFloat(netWorth) || 0;
      const p = parseFloat(v) || 0;
      setInflow(String(n - lastNetWorth - p));
    }
  };

  const submit = async () => {
    const n = parseFloat(netWorth);
    const i = parseFloat(inflow) || 0;
    const p = parseFloat(profit) || 0;
    if (isNaN(n)) {
      Alert.alert('Invalid input', 'Please enter a valid net worth.');
      return;
    }
    await upsertSnapshot(assetId, date, n, i, p);
    router.back();
  };

  const confirmDelete = () => {
    Alert.alert('Delete Snapshot', `Remove ${date} snapshot?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteSnapshot(assetId, date);
          router.back();
        },
      },
    ]);
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
          <Text style={styles.dateLabel}>Date: {date}</Text>
          <Text style={shared.muted}>
            Previous net worth: {fmt(lastNetWorth)}
          </Text>
        </View>

        <View style={shared.card}>
          <View style={styles.autoFillRow}>
            <Text style={styles.label}>Auto-calculate</Text>
            <Switch value={autoFill} onValueChange={setAutoFill} />
          </View>
          <Text style={shared.muted}>
            When enabled, editing any two fields auto-fills the third using:
            profit = (netWorth - lastNetWorth) - inflow
          </Text>
        </View>

        <View style={shared.card}>
          <Text style={styles.label}>Net Worth</Text>
          <TextInput
            style={styles.input}
            value={netWorth}
            onChangeText={updateNetWorth}
            placeholder="0.00"
            keyboardType="decimal-pad"
          />

          <Text style={styles.label}>Inflow</Text>
          <TextInput
            style={styles.input}
            value={inflow}
            onChangeText={updateInflow}
            placeholder="0.00"
            keyboardType="decimal-pad"
          />

          <Text style={styles.label}>Profit</Text>
          <TextInput
            style={styles.input}
            value={profit}
            onChangeText={updateProfit}
            placeholder="0.00"
            keyboardType="decimal-pad"
          />
        </View>

        <TouchableOpacity style={styles.submitBtn} onPress={submit}>
          <Text style={styles.submitText}>{hasExisting ? 'Update' : 'Save'}</Text>
        </TouchableOpacity>

        {hasExisting && (
          <TouchableOpacity style={styles.deleteBtn} onPress={confirmDelete}>
            <Text style={styles.deleteText}>Delete</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  dateLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: spacing.xs,
    marginBottom: spacing.xs,
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
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 16,
    backgroundColor: 'white',
  },
  submitBtn: {
    backgroundColor: colors.primary,
    padding: spacing.md,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  submitText: {
    color: 'white',
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
    color: colors.negative,
    fontSize: 16,
    fontWeight: '600',
  },
});
