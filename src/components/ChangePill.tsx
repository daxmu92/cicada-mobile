import { StyleSheet, Text, View } from 'react-native';

import { useFormat, useSemanticColors } from '../hooks/SettingsContext';
import { colors, radius, spacing, tints } from '../utils/theme';

type Props = {
  /** The signed change amount (drives sign, color, and arrow). */
  value: number;
  /** Optional percentage change to append (e.g. 3.1 → "+3.1%"). */
  percent?: number | null;
  /** Optional trailing context label, e.g. "this month". */
  caption?: string;
};

/**
 * A soft rounded pill showing a signed gain/loss with an arrow, formatted
 * amount, and optional percentage. Color follows the user's green/red
 * convention via useSemanticColors; the background is a matching soft tint.
 */
export function ChangePill({ value, percent, caption }: Props) {
  const { fmtSigned } = useFormat();
  const { gain, loss } = useSemanticColors();

  const positive = value >= 0;
  const color = positive ? gain : loss;
  const bg = tints[color] ?? colors.accentSoft;

  // fmtSigned already prefixes a ▲/▼ arrow.
  const pctText =
    percent == null
      ? ''
      : ` · ${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`;

  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.text, { color }]}>
        {fmtSigned(value)}
        {pctText}
      </Text>
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: spacing.sm + 2,
    borderRadius: radius.pill,
    gap: spacing.xs,
  },
  text: {
    fontSize: 12.5,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  caption: {
    fontSize: 12,
    color: colors.muted,
    fontWeight: '500',
  },
});
