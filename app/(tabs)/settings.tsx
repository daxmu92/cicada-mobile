import { useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { resetDatabase } from '../../src/db/database';
import { exportBackup, importBackup } from '../../src/services/backup';
import { loadSampleData } from '../../src/services/sample-data';
import { useSettings } from '../../src/hooks/SettingsContext';
import type { GainColor } from '../../src/hooks/SettingsContext';
import { confirmAsync, notify } from '../../src/utils/dialog';
import { colors, shared, spacing } from '../../src/utils/theme';

const CURRENCY_OPTIONS = ['$', '€', '£', '¥', 'R$', '₹', '₩', 'CHF'];

const GAIN_COLOR_OPTIONS: { value: GainColor; label: string; color: string }[] = [
  { value: 'green', label: 'Green', color: colors.positive },
  { value: 'red', label: 'Red', color: colors.negative },
];

export default function SettingsScreen() {
  const router = useRouter();
  const {
    currency,
    setCurrency,
    forwardFill,
    setForwardFill,
    gainColor,
    setGainColor,
  } = useSettings();
  const [loading, setLoading] = useState(false);

  const confirmReset = async () => {
    const ok = await confirmAsync(
      'Reset Database',
      'This will permanently delete all accounts, assets, snapshots, and transactions. This cannot be undone.',
      'Reset',
      true
    );
    if (!ok) return;
    await resetDatabase();
    notify('Done', 'Database has been reset.');
  };

  const confirmLoadSample = async () => {
    const ok = await confirmAsync(
      'Load Sample Data',
      'This will replace all current data with generated sample accounts, assets, snapshots, and transactions.',
      'Load',
      true
    );
    if (!ok) return;
    setLoading(true);
    try {
      await loadSampleData();
      notify('Done', 'Sample data loaded. Check the Home and Assets tabs.');
    } catch (e: any) {
      notify('Error', e?.message ?? 'Failed to load sample data');
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={shared.screen} contentContainerStyle={shared.scrollContent}>
      <Text style={shared.sectionTitle}>Preferences</Text>
      <View style={shared.card}>
        <View style={styles.toggleRow}>
          <View style={styles.toggleText}>
            <Text style={styles.rowTitle}>Forward-fill missing months</Text>
            <Text style={shared.muted}>
              Use the last known value when a snapshot is missing
            </Text>
          </View>
          <Switch value={forwardFill} onValueChange={setForwardFill} />
        </View>
      </View>
      <View style={shared.card}>
        <Text style={styles.rowTitle}>Currency</Text>
        <Text style={shared.muted}>Displayed before all amounts</Text>
        <View style={styles.currencyRow}>
          {CURRENCY_OPTIONS.map((symbol) => (
            <TouchableOpacity
              key={symbol}
              onPress={() => setCurrency(symbol)}
              style={[
                styles.currencyChip,
                currency === symbol && styles.currencyChipActive,
              ]}>
              <Text
                style={[
                  styles.currencyChipText,
                  currency === symbol && { color: 'white' },
                ]}>
                {symbol}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      <View style={shared.card}>
        <Text style={styles.rowTitle}>Color for gains</Text>
        <Text style={shared.muted}>
          Red for gains matches Chinese/HK stock market convention
        </Text>
        <View style={styles.currencyRow}>
          {GAIN_COLOR_OPTIONS.map((opt) => {
            const active = gainColor === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                onPress={() => setGainColor(opt.value)}
                style={[
                  styles.currencyChip,
                  styles.gainChip,
                  active && { backgroundColor: opt.color, borderColor: opt.color },
                ]}>
                <Text
                  style={[
                    styles.currencyChipText,
                    { color: active ? 'white' : opt.color },
                  ]}>
                  {opt.label} {'\u25B2'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <Text style={[shared.sectionTitle, { marginTop: spacing.xl }]}>Manage</Text>
      <Row
        title="Accounts & Assets"
        subtitle="Add, rename, or delete accounts and assets"
        onPress={() => router.push('/modals/manage-accounts')}
      />

      <Text style={[shared.sectionTitle, { marginTop: spacing.xl }]}>Backup</Text>
      <Row
        title="Export Data"
        subtitle="Save a JSON backup file"
        onPress={async () => {
          setLoading(true);
          try {
            await exportBackup();
          } catch (e: any) {
            notify('Export Failed', e?.message ?? 'Unable to export');
          } finally {
            setLoading(false);
          }
        }}
        disabled={loading}
      />
      <Row
        title="Import Data"
        subtitle="Replace all data from a backup file"
        onPress={async () => {
          // Confirm synchronously on web so the file picker stays within the
          // user gesture that importBackup() needs.
          const proceed = await confirmAsync(
            'Import Backup',
            'This will replace all existing data. Continue?',
            'Import',
            true
          );
          if (!proceed) return;
          setLoading(true);
          try {
            const counts = await importBackup();
            notify(
              'Imported',
              `Accounts: ${counts.accounts}\nAssets: ${counts.assets}\nSnapshots: ${counts.snapshots}\nTransactions: ${counts.transactions}`
            );
          } catch (e: any) {
            if (e?.message !== 'CANCELLED') {
              notify('Import Failed', e?.message ?? 'Unable to import');
            }
          } finally {
            setLoading(false);
          }
        }}
        disabled={loading}
      />

      <Text style={[shared.sectionTitle, { marginTop: spacing.xl }]}>Data</Text>
      <Row
        title="Load Sample Data"
        subtitle="Populate with 24 months of sample accounts and transactions"
        onPress={confirmLoadSample}
        disabled={loading}
      />
      <Row
        title="Reset Database"
        subtitle="Delete all data"
        onPress={confirmReset}
        destructive
        disabled={loading}
      />

      {loading && (
        <View style={styles.loading}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[shared.muted, { marginTop: spacing.sm }]}>Working…</Text>
        </View>
      )}
    </ScrollView>
  );
}

function Row({
  title,
  subtitle,
  onPress,
  destructive = false,
  disabled = false,
}: {
  title: string;
  subtitle?: string;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[shared.card, styles.row, disabled && { opacity: 0.5 }]}>
      <Text
        style={[styles.rowTitle, destructive && { color: colors.negative }]}>
        {title}
      </Text>
      {subtitle && <Text style={shared.muted}>{subtitle}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    marginBottom: spacing.sm,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  currencyRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  currencyChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'white',
    minWidth: 48,
    alignItems: 'center',
  },
  currencyChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  currencyChipText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.muted,
  },
  gainChip: {
    paddingHorizontal: spacing.lg,
    minWidth: 96,
  },
  loading: {
    marginTop: spacing.lg,
    alignItems: 'center',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  toggleText: {
    flex: 1,
  },
});
