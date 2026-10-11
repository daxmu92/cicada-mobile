import { allocationRows } from '../../utils/allocation';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useFormat, useThemedStyles, useTheme } from '../../hooks/SettingsContext';
import { categoryPalette, spacing, type ThemeColors } from '../../utils/theme';

export type AllocationItem = {
  label: string;
  value: number;
  color?: string;
  key?: string;
};

const PALETTE = categoryPalette;

type Props = {
  items: AllocationItem[];
  maxItems?: number;
  highlightKey?: string;
};

export function AllocationBarList({ items, maxItems = 8, highlightKey }: Props) {
  const { t } = useTranslation();
  const { fmt } = useFormat();
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { visible, total, liabilities } = allocationRows(items, maxItems, t('analysis.others'));
  const maxValue = Math.max(0, ...visible.map((item) => item.value));

  if (total <= 0 || visible.length === 0) {
    return <Text style={{ color: c.muted }}>{liabilities > 0 ? t('charts.liabilities', { value: fmt(liabilities) }) : t('charts.noDataToDisplay')}</Text>;
  }

  return (
    <View>
      {liabilities > 0 && <Text style={{ color: c.inkSoft, marginBottom: spacing.md }}>{t('charts.liabilities', { value: fmt(liabilities) })}</Text>}
      {visible.map((item, index) => {
        const pct = (item.value / total) * 100;
        const barWidth = maxValue > 0 ? (item.value / maxValue) * 100 : 0;
        const color = item.color ?? PALETTE[index % PALETTE.length];
        const rowKey = item.key ?? item.label;
        const isActive = highlightKey != null && rowKey === highlightKey;

        return (
          <View key={rowKey} style={[styles.row, isActive && styles.rowActive]}>
            <View style={styles.header}>
              <Text style={styles.label} numberOfLines={1}>
                {item.label}
              </Text>
              <Text style={styles.value}>{fmt(item.value)}</Text>
            </View>
            <View style={styles.barTrack}>
              <View style={[styles.bar, { width: `${barWidth}%`, backgroundColor: color }]} />
            </View>
            <Text style={styles.pct}>{pct.toFixed(1)}%</Text>
          </View>
        );
      })}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    row: {
      marginBottom: spacing.md,
    },
    rowActive: {
      backgroundColor: c.track,
      borderRadius: 8,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      marginHorizontal: -spacing.sm,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: spacing.xs,
    },
    label: {
      flex: 1,
      fontSize: 14,
      fontWeight: '500',
      color: c.inkSoft,
      marginRight: spacing.sm,
    },
    value: {
      fontSize: 14,
      fontWeight: '600',
      color: c.ink,
      fontVariant: ['tabular-nums'],
    },
    barTrack: {
      height: 7,
      backgroundColor: c.track,
      borderRadius: 4,
      overflow: 'hidden',
    },
    bar: {
      height: '100%',
      borderRadius: 4,
    },
    pct: {
      fontSize: 12,
      color: c.muted,
      marginTop: 2,
      textAlign: 'right',
    },
  });
