import { StyleSheet, Text, View } from 'react-native';
import { PieChart } from 'react-native-gifted-charts';

import { spacing, type ThemeColors } from '../../utils/theme';
import { useTheme, useThemedStyles } from '../../hooks/SettingsContext';

export type DonutSlice = {
  key: string;
  label: string;
  value: number;
  color: string;
};

type Props = {
  slices: DonutSlice[];
  centerPrimary: string;
  centerSecondary?: string;
  caption?: string;
  focusedKey?: string;
  onSlicePress?: (key: string) => void;
};

export function CompositionDonut({
  slices,
  centerPrimary,
  centerSecondary,
  caption,
  focusedKey,
  onSlicePress,
}: Props) {
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);

  const data = slices.map((s) => ({
    value: s.value,
    color: s.color,
    focused: s.key === focusedKey,
  }));

  return (
    <View style={styles.wrap}>
      {slices.length > 0 && (
        <PieChart
          donut
          data={data}
          radius={96}
          innerRadius={64}
          innerCircleColor={c.card}
          focusOnPress
          sectionAutoFocus
          onPress={(_item: unknown, index: number) => {
            const s = slices[index];
            if (s && onSlicePress) onSlicePress(s.key);
          }}
          centerLabelComponent={() => (
            <View style={styles.center}>
              <Text style={styles.centerPrimary}>{centerPrimary}</Text>
              {centerSecondary ? (
                <Text style={styles.centerSecondary}>{centerSecondary}</Text>
              ) : null}
            </View>
          )}
        />
      )}
      {slices.length === 0 && (
        <View style={styles.center}>
          <Text style={styles.centerPrimary}>{centerPrimary}</Text>
          {centerSecondary ? <Text style={styles.centerSecondary}>{centerSecondary}</Text> : null}
        </View>
      )}
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    wrap: {
      alignItems: 'center',
      paddingVertical: spacing.sm,
    },
    center: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    centerPrimary: {
      fontSize: 18,
      fontWeight: '700',
      color: c.ink,
      fontVariant: ['tabular-nums'],
    },
    centerSecondary: {
      fontSize: 12,
      color: c.muted,
      marginTop: 2,
    },
    caption: {
      fontSize: 12,
      color: c.muted,
      marginTop: spacing.sm,
      textAlign: 'center',
    },
  });
