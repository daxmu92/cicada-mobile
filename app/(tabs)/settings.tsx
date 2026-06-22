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
import { useTranslation } from 'react-i18next';

import { resetDatabase } from '../../src/db/database';
import { exportBackup, importBackup } from '../../src/services/backup';
import { loadSampleData } from '../../src/services/sample-data';
import { useSettings, useShared, useTheme, useThemedStyles } from '../../src/hooks/SettingsContext';
import type { GainColor } from '../../src/hooks/SettingsContext';
import { confirmAsync, notify } from '../../src/utils/dialog';
import { semantic, spacing, type ThemeColors } from '../../src/utils/theme';
import { LANGUAGES, type Language } from '../../src/i18n';
import CloudSyncSection from '../../src/components/CloudSyncSection';

const CURRENCY_OPTIONS = ['$', '€', '£', '¥', 'R$', '₹', '₩', 'CHF'];

const GAIN_COLOR_OPTIONS: { value: GainColor; labelKey: string; color: string }[] = [
  { value: 'green', labelKey: 'settings.green', color: semantic.positive },
  { value: 'red', labelKey: 'settings.red', color: semantic.negative },
];

const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'English',
  zh: '中文',
};

export default function SettingsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const {
    currency,
    setCurrency,
    forwardFill,
    setForwardFill,
    gainColor,
    setGainColor,
    language,
    setLanguage,
  } = useSettings();
  const c = useTheme();
  const shared = useShared();
  const styles = useThemedStyles(makeStyles);
  const [loading, setLoading] = useState(false);

  const confirmReset = async () => {
    const ok = await confirmAsync(
      t('settings.resetTitle'),
      t('settings.resetBody'),
      t('settings.resetConfirm'),
      true
    );
    if (!ok) return;
    await resetDatabase();
    notify(t('settings.doneTitle'), t('settings.resetDone'));
  };

  const confirmLoadSample = async () => {
    const ok = await confirmAsync(
      t('settings.loadSampleTitle'),
      t('settings.loadSampleBody'),
      t('settings.loadConfirm'),
      true
    );
    if (!ok) return;
    setLoading(true);
    try {
      await loadSampleData();
      notify(t('settings.doneTitle'), t('settings.sampleLoaded'));
    } catch (e: any) {
      notify(t('common.error'), e?.message ?? t('settings.loadSampleFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView style={shared.screen} contentContainerStyle={shared.scrollContent}>
      <Text style={shared.sectionTitle}>{t('settings.preferences')}</Text>
      <View style={shared.card}>
        <View style={styles.toggleRow}>
          <View style={styles.toggleText}>
            <Text style={styles.rowTitle}>{t('settings.forwardFillTitle')}</Text>
            <Text style={shared.muted}>
              {t('settings.forwardFillHelp')}
            </Text>
          </View>
          <Switch value={forwardFill} onValueChange={setForwardFill} />
        </View>
      </View>
      <View style={shared.card}>
        <Text style={styles.rowTitle}>{t('settings.currency')}</Text>
        <Text style={shared.muted}>{t('settings.currencyHelp')}</Text>
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
                  currency === symbol && { color: c.onAccent },
                ]}>
                {symbol}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      <View style={shared.card}>
        <Text style={styles.rowTitle}>{t('settings.colorForGains')}</Text>
        <Text style={shared.muted}>
          {t('settings.colorForGainsHelp')}
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
                    { color: active ? c.onAccent : opt.color },
                  ]}>
                  {t(opt.labelKey)} {'▲'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={shared.card}>
        <Text style={styles.rowTitle}>{t('settings.language')}</Text>
        <Text style={shared.muted}>{t('settings.languageHelp')}</Text>
        <View style={styles.currencyRow}>
          {LANGUAGES.map((lang) => (
            <TouchableOpacity
              key={lang}
              onPress={() => setLanguage(lang)}
              style={[
                styles.currencyChip,
                styles.gainChip,
                language === lang && styles.currencyChipActive,
              ]}>
              <Text
                style={[
                  styles.currencyChipText,
                  language === lang && { color: c.onAccent },
                ]}>
                {LANGUAGE_LABELS[lang]}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <CloudSyncSection />

      <Text style={[shared.sectionTitle, { marginTop: spacing.xl }]}>{t('settings.manage')}</Text>
      <Row
        title={t('settings.accountsAssets')}
        subtitle={t('settings.accountsAssetsSub')}
        onPress={() => router.push('/modals/manage-accounts')}
      />

      <Text style={[shared.sectionTitle, { marginTop: spacing.xl }]}>{t('settings.backup')}</Text>
      <Row
        title={t('settings.exportData')}
        subtitle={t('settings.exportDataSub')}
        onPress={async () => {
          setLoading(true);
          try {
            await exportBackup();
          } catch (e: any) {
            notify(t('settings.exportFailedTitle'), e?.message ?? t('settings.exportFailedBody'));
          } finally {
            setLoading(false);
          }
        }}
        disabled={loading}
      />
      <Row
        title={t('settings.importData')}
        subtitle={t('settings.importDataSub')}
        onPress={async () => {
          // Confirm synchronously on web so the file picker stays within the
          // user gesture that importBackup() needs.
          const proceed = await confirmAsync(
            t('settings.importTitle'),
            t('settings.importBody'),
            t('settings.importConfirm'),
            true
          );
          if (!proceed) return;
          setLoading(true);
          try {
            const counts = await importBackup();
            notify(
              t('settings.importedTitle'),
              t('settings.importedBody', { accounts: counts.accounts, assets: counts.assets, snapshots: counts.snapshots, transactions: counts.transactions })
            );
          } catch (e: any) {
            if (e?.message !== 'CANCELLED') {
              notify(t('settings.importFailedTitle'), e?.message ?? t('settings.importFailedBody'));
            }
          } finally {
            setLoading(false);
          }
        }}
        disabled={loading}
      />

      <Text style={[shared.sectionTitle, { marginTop: spacing.xl }]}>{t('settings.data')}</Text>
      <Row
        title={t('settings.loadSample')}
        subtitle={t('settings.loadSampleSub')}
        onPress={confirmLoadSample}
        disabled={loading}
      />
      <Row
        title={t('settings.resetDb')}
        subtitle={t('settings.resetDbSub')}
        onPress={confirmReset}
        destructive
        disabled={loading}
      />

      {loading && (
        <View style={styles.loading}>
          <ActivityIndicator size="small" color={c.primary} />
          <Text style={[shared.muted, { marginTop: spacing.sm }]}>{t('common.working')}</Text>
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
  const shared = useShared();
  const styles = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={[shared.card, styles.row, disabled && { opacity: 0.5 }]}>
      <Text
        style={[styles.rowTitle, destructive && { color: semantic.negative }]}>
        {title}
      </Text>
      {subtitle && <Text style={shared.muted}>{subtitle}</Text>}
    </TouchableOpacity>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
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
      borderColor: c.border,
      backgroundColor: c.card,
      minWidth: 48,
      alignItems: 'center',
    },
    currencyChipActive: {
      backgroundColor: c.primary,
      borderColor: c.primary,
    },
    currencyChipText: {
      fontSize: 16,
      fontWeight: '600',
      color: c.muted,
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
