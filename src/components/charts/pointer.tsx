import { StyleSheet, Text, View } from 'react-native';

import { useFormat, useLocale } from '../../hooks/SettingsContext';
import { formatMonthYear } from '../../utils/date';
import { colors, radius, spacing } from '../../utils/theme';

/** A chart data item carrying the fields our tooltip needs. */
export type PointerItem = {
  value: number; // plotted (possibly shifted) value
  actual?: number; // true value for display
  date?: string; // "YYYY-MM" for display
};

/**
 * Shared gifted-charts pointerConfig: a follow-on-hover/touch tooltip showing
 * the point's date and formatted value. Works on web (hover) and native (drag).
 */
export function usePointerConfig(color: string) {
  const { fmt } = useFormat();
  const locale = useLocale();

  return {
    pointerColor: color,
    pointerStripColor: colors.muted,
    pointerStripWidth: 1,
    radius: 4,
    pointerLabelWidth: 130,
    pointerLabelHeight: 56,
    activatePointersOnLongPress: false,
    autoAdjustPointerLabelPosition: true,
    pointerLabelComponent: (items: PointerItem[]) => {
      const it = items?.[0];
      if (!it) return null;
      const value = it.actual ?? it.value;
      return (
        <View style={styles.box}>
          {it.date ? <Text style={styles.date}>{formatMonthYear(it.date, locale)}</Text> : null}
          <Text style={styles.value}>{fmt(value)}</Text>
        </View>
      );
    },
  };
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.ink,
    borderRadius: radius.sm,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.sm,
    minWidth: 110,
  },
  date: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 10,
    marginBottom: 2,
  },
  value: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
