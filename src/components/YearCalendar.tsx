import { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { getMonthlyTotals } from '../db/snapshot-repo';
import { useFormat, useLocale, useSemanticColors, useSettings, useTheme, useThemedStyles } from '../hooks/SettingsContext';
import { useTranslation } from 'react-i18next';
import { currentYear, currentYearMonth, monthShort, yearMonth } from '../utils/date';
import { radius, spacing, type ThemeColors } from '../utils/theme';

type Props = {
  selected: string;
  onChange: (ym: string) => void;
};

type MonthCell = {
  month: number;
  netGrowth: number | null;
};

export function YearCalendar({ selected, onChange }: Props) {
  const { t } = useTranslation();
  const locale = useLocale();
  const { fmtSignedCompact } = useFormat();
  const { forwardFill } = useSettings();
  const { gain, loss } = useSemanticColors();
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [selectedYear, selectedMonth] = selected.split('-').map(Number);
  const [displayYear, setDisplayYear] = useState<number>(selectedYear);
  const [cells, setCells] = useState<MonthCell[]>(emptyCells());

  useEffect(() => {
    setDisplayYear(selectedYear);
  }, [selectedYear]);

  // NOTE: year-view net growth uses raw SQL sums from getMonthlyTotals and
  // does NOT apply forward-fill. The dependency on `forwardFill` is kept so
  // this effect re-runs if the setting changes in case that ever gets wired up.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const start = yearMonth(displayYear - 1, 12);
      const end = yearMonth(displayYear, 12);
      const rows = await getMonthlyTotals(start, end);
      if (cancelled) return;

      const byDate = new Map<string, number>();
      for (const r of rows) byDate.set(r.date, r.netWorth);

      const next: MonthCell[] = [];
      for (let m = 1; m <= 12; m++) {
        const curKey = yearMonth(displayYear, m);
        const prevKey = m === 1 ? yearMonth(displayYear - 1, 12) : yearMonth(displayYear, m - 1);
        const cur = byDate.get(curKey);
        const prev = byDate.get(prevKey);
        if (cur == null) {
          next.push({ month: m, netGrowth: null });
        } else {
          next.push({ month: m, netGrowth: cur - (prev ?? 0) });
        }
      }
      setCells(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [displayYear, forwardFill, selected]);

  const goToday = () => {
    onChange(currentYearMonth());
    setDisplayYear(currentYear());
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => setDisplayYear((y) => y - 1)}
          style={styles.arrowBtn}>
          <Text style={styles.arrow}>‹</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.yearLabel}>{displayYear}</Text>
          <TouchableOpacity onPress={goToday}>
            <Text style={styles.todayLink}>{t('common.today')}</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          onPress={() => setDisplayYear((y) => y + 1)}
          style={styles.arrowBtn}>
          <Text style={styles.arrow}>›</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.grid}>
        {cells.map((cell) => {
          const isSelected = displayYear === selectedYear && cell.month === selectedMonth;
          const hasData = cell.netGrowth != null;
          const growthColor = !hasData
            ? c.muted
            : cell.netGrowth! > 0
            ? gain
            : cell.netGrowth! < 0
            ? loss
            : c.muted;
          return (
            <View key={cell.month} style={styles.cellWrap}>
              <TouchableOpacity
                onPress={() => onChange(yearMonth(displayYear, cell.month))}
                activeOpacity={0.7}
                style={[
                  styles.cell,
                  !hasData && styles.cellMuted,
                  isSelected && styles.cellSelected,
                ]}>
                <Text
                  style={[
                    styles.monthLabel,
                    isSelected && styles.monthLabelSelected,
                  ]}>
                  {monthShort(cell.month, locale)}
                </Text>
                <Text
                  style={[styles.growth, { color: growthColor }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.5}>
                  {hasData ? fmtSignedCompact(cell.netGrowth!) : '—'}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function emptyCells(): MonthCell[] {
  const out: MonthCell[] = [];
  for (let m = 1; m <= 12; m++) out.push({ month: m, netGrowth: null });
  return out;
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    card: {
      backgroundColor: c.card,
      borderRadius: radius.lg,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.xs,
      marginBottom: spacing.md,
      shadowColor: '#3a3530',
      shadowOpacity: 0.06,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 2,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.md,
      paddingHorizontal: spacing.sm,
    },
    arrowBtn: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
    },
    arrow: {
      fontSize: 28,
      color: c.primary,
      fontWeight: '600',
    },
    headerCenter: {
      alignItems: 'center',
    },
    yearLabel: {
      fontSize: 20,
      fontWeight: '700',
    },
    todayLink: {
      fontSize: 12,
      color: c.primary,
      marginTop: 2,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
    },
    cellWrap: {
      width: '25%',
      padding: 2,
    },
    cell: {
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.card,
      paddingVertical: spacing.xs,
      paddingHorizontal: 2,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 68,
    },
    cellMuted: {
      backgroundColor: c.bg,
    },
    cellSelected: {
      borderColor: c.primary,
      borderWidth: 2,
      backgroundColor: c.accentSoft,
    },
    monthLabel: {
      fontSize: 15,
      fontWeight: '600',
      color: c.muted,
      marginBottom: 2,
    },
    monthLabelSelected: {
      color: c.primary,
    },
    growth: {
      fontSize: 15,
      fontWeight: '700',
      textAlign: 'center',
      fontVariant: ['tabular-nums'],
    },
  });
