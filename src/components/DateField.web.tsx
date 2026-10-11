import { useTheme } from '../hooks/SettingsContext';
export type DateFieldProps = { value: string; onChange: (value: string) => void; month?: boolean; label: string; disabled?: boolean };
export function DateField({ value, onChange, month, label, disabled }: DateFieldProps) {
  const c = useTheme();
  return <input aria-label={label} type={month ? 'month' : 'date'} value={value} disabled={disabled}
    onChange={(event) => { if (event.target.value) onChange(event.target.value); }}
    style={{ color: c.ink, background: c.card, border: `1px solid ${c.border}`, borderRadius: 8, padding: 10, fontSize: 16, minWidth: 0, width: '100%', boxSizing: 'border-box' }} />;
}
