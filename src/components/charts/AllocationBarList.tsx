import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useFormat } from '../../hooks/SettingsContext';
import { categoryPalette, colors, spacing } from '../../utils/theme';

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
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const visible = sorted.slice(0, maxItems);
  const total = sorted.reduce((sum, i) => sum + i.value, 0);
  const maxValue = visible[0]?.value ?? 0;

  if (total <= 0 || visible.length === 0) {
    return <Text style={{ color: colors.muted }}>{t('charts.noDataToDisplay')}</Text>;
  }

  return (
    <View>
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

const styles = StyleSheet.create({
  row: {
    marginBottom: spacing.md,
  },
  rowActive: {
    backgroundColor: colors.track,
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
    color: colors.inkSoft,
    marginRight: spacing.sm,
  },
  value: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  barTrack: {
    height: 7,
    backgroundColor: colors.track,
    borderRadius: 4,
    overflow: 'hidden',
  },
  bar: {
    height: '100%',
    borderRadius: 4,
  },
  pct: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
    textAlign: 'right',
  },
});
