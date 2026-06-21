import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useLocale } from '../hooks/SettingsContext';
import {
  currentYearMonth,
  formatMonthYear,
  nextYearMonth,
  prevYearMonth,
} from '../utils/date';
import { colors, radius, spacing } from '../utils/theme';

type Props = {
  value: string; // "YYYY-MM"
  onChange: (ym: string) => void;
};

/**
 * Compact month stepper: ‹ [Jun 2026] › . Tapping the label jumps back to the
 * current month. Replaces the full year-calendar grid on the home screen; the
 * richer year view lives on the Trends screen.
 */
export function MonthSelector({ value, onChange }: Props) {
  const locale = useLocale();
  const isCurrent = value === currentYearMonth();

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        style={styles.arrow}
        hitSlop={8}
        onPress={() => onChange(prevYearMonth(value))}>
        <Text style={styles.arrowText}>‹</Text>
      </TouchableOpacity>
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => !isCurrent && onChange(currentYearMonth())}>
        <Text style={styles.label}>{formatMonthYear(value, locale)}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.arrow}
        hitSlop={8}
        onPress={() => onChange(nextYearMonth(value))}>
        <Text style={styles.arrowText}>›</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.pill,
    paddingVertical: 4,
    paddingHorizontal: spacing.xs,
    shadowColor: '#3a3530',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  arrow: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  arrowText: {
    fontSize: 20,
    lineHeight: 22,
    color: colors.accent,
    fontWeight: '700',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.ink,
    minWidth: 96,
    textAlign: 'center',
  },
});
