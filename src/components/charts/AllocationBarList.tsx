import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useFormat } from '../../hooks/SettingsContext';
import { colors, spacing } from '../../utils/theme';

export type AllocationItem = {
  label: string;
  value: number;
  color?: string;
};

const PALETTE = [
  '#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981',
  '#06b6d4', '#f43f5e', '#84cc16', '#6366f1', '#d946ef',
];

type Props = {
  items: AllocationItem[];
  maxItems?: number;
};

export function AllocationBarList({ items, maxItems = 8 }: Props) {
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

        return (
          <View key={item.label} style={styles.row}>
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  label: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    marginRight: spacing.sm,
  },
  value: {
    fontSize: 14,
    fontWeight: '600',
  },
  barTrack: {
    height: 6,
    backgroundColor: colors.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  bar: {
    height: '100%',
    borderRadius: 3,
  },
  pct: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 2,
    textAlign: 'right',
  },
});
