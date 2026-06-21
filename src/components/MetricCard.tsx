import { StyleSheet, Text, View } from 'react-native';

import { colors, shared, spacing } from '../utils/theme';

type Props = {
  label: string;
  value: string;
  /** Optional explicit value color (e.g. a semantic gain/loss color). */
  valueColor?: string;
};

/** A compact stat card: small uppercase label over an emphasized value. */
export function MetricCard({ label, value, valueColor }: Props) {
  return (
    <View style={[shared.card, styles.card]}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, valueColor ? { color: valueColor } : null]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    marginBottom: 0,
    padding: spacing.md + 2,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: spacing.xs + 1,
  },
  value: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
});
