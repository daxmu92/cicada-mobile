import { useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { formatMonthYear, nextYearMonth, prevYearMonth } from '../utils/date';
import { useLocale } from '../hooks/SettingsContext';
import { YearCalendar } from './YearCalendar';
import { colors, spacing } from '../utils/theme';

type Props = {
  value: string;
  onChange: (ym: string) => void;
};

export function MonthSelector({ value, onChange }: Props) {
  const locale = useLocale();
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <View style={styles.row}>
      <TouchableOpacity
        style={styles.arrow}
        hitSlop={8}
        onPress={() => onChange(prevYearMonth(value))}>
        <Text style={styles.arrowText}>‹</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.label} onPress={() => setPickerOpen(true)}>
        <Text style={styles.labelText}>{formatMonthYear(value, locale)}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.arrow}
        hitSlop={8}
        onPress={() => onChange(nextYearMonth(value))}>
        <Text style={styles.arrowText}>›</Text>
      </TouchableOpacity>

      <Modal
        visible={pickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerOpen(false)}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={() => setPickerOpen(false)}>
          <View style={styles.sheet}>
            <YearCalendar
              selected={value}
              onChange={(ym) => {
                setPickerOpen(false);
                onChange(ym);
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  arrow: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  arrowText: {
    fontSize: 22,
    fontWeight: '600',
    color: colors.primary,
  },
  label: {
    minWidth: 120,
    alignItems: 'center',
  },
  labelText: {
    fontSize: 16,
    fontWeight: '700',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  sheet: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: spacing.md,
  },
});
