import { useState } from 'react';
import { ScrollView, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { YearCalendar } from '../src/components/YearCalendar';
import { currentYearMonth } from '../src/utils/date';
import { colors, shared, spacing } from '../src/utils/theme';

/**
 * Trends / history screen. v1 relocates the year calendar here (off the home
 * screen). Tapping a month deep-links back to Home with that month selected.
 * Future: multi-range net-worth line chart, year-over-year comparison.
 */
export default function TrendsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [selected, setSelected] = useState(currentYearMonth());

  const handleChange = (ym: string) => {
    setSelected(ym);
    router.navigate({ pathname: '/', params: { month: ym } });
  };

  return (
    <ScrollView style={shared.screen} contentContainerStyle={styles.content}>
      <Text style={styles.intro}>{t('trends.yearIntro')}</Text>
      <YearCalendar selected={selected} onChange={handleChange} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  intro: {
    fontSize: 13,
    color: colors.inkSoft,
    marginBottom: spacing.md,
    lineHeight: 19,
  },
});
