import { StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useFormat, useThemedStyles } from '../hooks/SettingsContext';
import { computeInflow, computeProfit } from '../utils/snapshot-calc';
import { spacing, type ThemeColors } from '../utils/theme';

export type SnapshotDraft = {
  netWorth: string;
  inflow: string;
  profit: string;
  autoFill: boolean;
};

type Props = {
  assetName: string;
  lastNetWorth: number;
  draft: SnapshotDraft;
  onChange: (draft: SnapshotDraft) => void;
  onReset: () => void;
  onCollapse: () => void;
};

export function AssetEntryCard({
  assetName,
  lastNetWorth,
  draft,
  onChange,
  onReset,
  onCollapse,
}: Props) {
  const { t } = useTranslation();
  const { fmt } = useFormat();
  const styles = useThemedStyles(makeStyles);

  const setNetWorth = (v: string) => {
    const next = { ...draft, netWorth: v };
    if (draft.autoFill) {
      next.profit = String(computeProfit(parseFloat(v) || 0, lastNetWorth, parseFloat(draft.inflow) || 0));
    }
    onChange(next);
  };

  const setInflow = (v: string) => {
    const next = { ...draft, inflow: v };
    if (draft.autoFill) {
      next.profit = String(computeProfit(parseFloat(draft.netWorth) || 0, lastNetWorth, parseFloat(v) || 0));
    }
    onChange(next);
  };

  const setProfit = (v: string) => {
    const next = { ...draft, profit: v };
    if (draft.autoFill) {
      next.inflow = String(computeInflow(parseFloat(draft.netWorth) || 0, lastNetWorth, parseFloat(v) || 0));
    }
    onChange(next);
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{assetName}</Text>
      <Text style={styles.muted}>{t('batchEntry.lastNetWorth', { value: fmt(lastNetWorth) })}</Text>

      <View style={styles.autoRow}>
        <Text style={styles.label}>{t('addRecord.autoCalculate')}</Text>
        <Switch value={draft.autoFill} onValueChange={(v) => onChange({ ...draft, autoFill: v })} />
      </View>

      <Text style={styles.label}>{t('addRecord.netWorth')}</Text>
      <TextInput
        style={styles.input}
        value={draft.netWorth}
        onChangeText={setNetWorth}
        placeholder={t('addRecord.valuePlaceholder')}
        keyboardType="decimal-pad"
        returnKeyType="next"
      />

      <Text style={styles.label}>{t('addRecord.inflow')}</Text>
      <TextInput
        style={styles.input}
        value={draft.inflow}
        onChangeText={setInflow}
        placeholder={t('addRecord.valuePlaceholder')}
        keyboardType="decimal-pad"
        returnKeyType="next"
      />

      <Text style={styles.label}>{t('addRecord.profit')}</Text>
      <TextInput
        style={styles.input}
        value={draft.profit}
        onChangeText={setProfit}
        placeholder={t('addRecord.valuePlaceholder')}
        keyboardType="decimal-pad"
        returnKeyType="done"
      />

      <View style={styles.footer}>
        <TouchableOpacity style={styles.footerBtn} onPress={onReset}>
          <Text style={styles.footerText}>↺ {t('batchEntry.reset')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.footerBtn} onPress={onCollapse}>
          <Text style={[styles.footerText, styles.collapseText]}>⌃ {t('batchEntry.collapse')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    card: {
      borderTopWidth: 1,
      borderTopColor: c.border,
      paddingVertical: spacing.md,
    },
    title: {
      fontSize: 16,
      fontWeight: '600',
    },
    muted: {
      fontSize: 13,
      color: c.muted,
      marginTop: 2,
    },
    autoRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: spacing.sm,
    },
    label: {
      fontSize: 14,
      fontWeight: '600',
      marginTop: spacing.sm,
      marginBottom: spacing.xs,
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
    footer: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: spacing.lg,
      marginTop: spacing.md,
    },
    footerBtn: {
      paddingVertical: spacing.xs,
      paddingHorizontal: spacing.sm,
    },
    footerText: {
      fontSize: 15,
      fontWeight: '600',
      color: c.muted,
    },
    collapseText: {
      color: c.primary,
    },
  });
