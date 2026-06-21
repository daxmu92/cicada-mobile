import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useFormat } from '../../hooks/SettingsContext';
import { colors, spacing } from '../../utils/theme';

export type CategoryItem = {
  label: string;
  value: number;
};

type Props = {
  items: CategoryItem[];
  color: string;
  emptyText?: string;
};

export function CategoryBars({ items, color, emptyText }: Props) {
  const { t } = useTranslation();
  const { fmt } = useFormat();
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const total = sorted.reduce((sum, i) => sum + i.value, 0);
  const maxValue = sorted[0]?.value ?? 0;

  if (total <= 0 || sorted.length === 0) {
    return <Text style={{ color: colors.muted }}>{emptyText ?? t('charts.noData')}</Text>;
  }

  return (
    <View>
      {sorted.map((item) => {
        const pct = (item.value / total) * 100;
        const barWidth = maxValue > 0 ? (item.value / maxValue) * 100 : 0;

        return (
          <View key={item.label} style={styles.row}>
            <View style={styles.header}>
              <Text style={styles.label} numberOfLines={1}>
                {item.label}
              </Text>
              <Text style={styles.value}>
                {fmt(item.value)}
                <Text style={styles.pct}>  {pct.toFixed(0)}%</Text>
              </Text>
            </View>
            <View style={styles.barTrack}>
              <View style={[styles.bar, { width: `${barWidth}%`, backgroundColor: color }]} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  label: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    marginRight: spacing.sm,
  },
  value: {
    fontSize: 13,
    fontWeight: '600',
  },
  pct: {
    fontSize: 11,
    color: colors.muted,
    fontWeight: '400',
  },
  barTrack: {
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  bar: {
    height: '100%',
    borderRadius: 2,
  },
});
