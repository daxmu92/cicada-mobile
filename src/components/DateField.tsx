import { useState } from 'react';
import { Platform, Text, TouchableOpacity, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../hooks/SettingsContext';
export type DateFieldProps = { value: string; onChange: (value: string) => void; month?: boolean; label: string; disabled?: boolean };
export function DateField({ value, onChange, month, label, disabled }: DateFieldProps) {
  const [open, setOpen] = useState(false); const c = useTheme(); const { t } = useTranslation();
  const [y, m, day = 1] = value.split('-').map(Number);
  const date = new Date(y || new Date().getFullYear(), (m || 1) - 1, day);
  return <View>
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={() => setOpen(!open)} style={{ padding: 10, borderWidth: 1, borderColor: c.border, borderRadius: 8 }}><Text style={{ color: c.ink }}>{value}</Text></TouchableOpacity>
    {open && <DateTimePicker value={date} mode="date" display={Platform.OS === 'ios' ? 'inline' : 'default'} onChange={(event, selected) => {
      if (Platform.OS === 'android') setOpen(false);
      if (event.type !== 'dismissed' && selected) {
        const text = `${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, '0')}`;
        onChange(month ? text : `${text}-${String(selected.getDate()).padStart(2, '0')}`);
      }
    }} />}
    {open && Platform.OS === 'ios' && <TouchableOpacity accessibilityRole="button" onPress={() => setOpen(false)}><Text style={{ color: c.ink }}>{t('common.done')}</Text></TouchableOpacity>}
  </View>;
}
