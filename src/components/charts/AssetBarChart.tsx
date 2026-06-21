import { useMemo, useState } from 'react';
import { Dimensions, LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { BarChart } from 'react-native-gifted-charts';

import { useFormat, useLocale, useSemanticColors } from '../../hooks/SettingsContext';
import { abbrev, niceAxis } from '../../utils/chart';
import { formatMonthYear } from '../../utils/date';
import { colors, radius, spacing } from '../../utils/theme';

export type BarPoint = {
  label: string; // "YYYY-MM"
  value: number;
};

type Props = {
  data: BarPoint[];
  /** Single-bar color (used when not diverging). */
  color?: string;
  /** Color each bar by sign (gain/loss) — for monthly profit. */
  diverging?: boolean;
  height?: number;
};

const Y_AXIS_WIDTH = 46;
// Match AssetLineChart so the card height stays constant across line/bar metrics.
const CHART_BOX_HEIGHT = 272;
const WIDTH_ESTIMATE = Dimensions.get('window').width - 64;

function shortMonthYear(ym: string): string {
  const [y, m] = ym.split('-');
  return `${m}/${y.slice(2)}`;
}

/**
 * Monthly-flow bar chart (per-period amounts like inflow or monthly profit).
 * Bars baseline at zero so negative months drop below the axis; tap a bar to
 * see its month and value. Width is measured so it fits its card.
 */
export function AssetBarChart({ data, color = colors.accent, diverging = false, height = 220 }: Props) {
  const { fmt } = useFormat();
  const locale = useLocale();
  const { gain, loss } = useSemanticColors();
  const [boxWidth, setBoxWidth] = useState(WIDTH_ESTIMATE);

  const labelStep = data.length > 12 ? Math.ceil(data.length / 6) : 1;
  const plotWidth = Math.max(boxWidth - Y_AXIS_WIDTH - spacing.sm, 0);
  const slot = data.length > 0 ? plotWidth / data.length : 0;
  const barWidth = Math.max(slot * 0.6, 2);
  const barSpacing = Math.max(slot * 0.4, 1);

  const chartData = useMemo(
    () =>
      data.map((p, i) => ({
        value: p.value,
        frontColor: diverging ? (p.value >= 0 ? gain : loss) : color,
        label: i % labelStep === 0 ? shortMonthYear(p.label) : '',
        labelWidth: i % labelStep === 0 ? 40 : 0, // room for the rotated date
        date: p.label,
      })),
    [data, diverging, color, gain, loss, labelStep]
  );

  // "Nice" y-axis so labels round to 0 / 1K / 2K instead of 646-style steps.
  const yAxis = useMemo(() => {
    const vals = data.map((d) => d.value);
    const rawMax = Math.max(0, ...vals);
    const rawMin = Math.min(0, ...vals);
    const { niceStep } = niceAxis(rawMin, rawMax, 5);
    const topSections = Math.max(1, Math.ceil(rawMax / niceStep));
    const bottomSections = Math.ceil(Math.abs(rawMin) / niceStep);
    return { step: niceStep, max: topSections * niceStep, topSections, bottomSections };
  }, [data]);

  // gifted-charts' `height` is only the area ABOVE the x-axis; negative sections
  // extend below it. Scale the positive height so the TOTAL height (above +
  // below) stays ~constant and matches the line charts, regardless of negatives.
  const totalSections = yAxis.topSections + yAxis.bottomSections;
  const posHeight = Math.max(60, Math.round((height * yAxis.topSections) / totalSections));

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setBoxWidth(e.nativeEvent.layout.width)}
      style={{ overflow: 'hidden', minHeight: CHART_BOX_HEIGHT }}>
      {plotWidth > 0 && data.length > 0 && (
        <BarChart
          data={chartData}
          height={posHeight}
          width={plotWidth}
          barWidth={barWidth}
          spacing={barSpacing}
          initialSpacing={barSpacing}
          roundedTop
          maxValue={yAxis.max}
          stepValue={yAxis.step}
          noOfSections={yAxis.topSections}
          noOfSectionsBelowXAxis={yAxis.bottomSections}
          yAxisColor={colors.border}
          xAxisColor={colors.border}
          rulesColor={colors.border}
          rulesType="solid"
          yAxisTextStyle={{ color: colors.muted, fontSize: 10 }}
          formatYLabel={(label: string) => abbrev(Number(label))}
          yAxisLabelWidth={Y_AXIS_WIDTH}
          rotateLabel
          xAxisLabelsAtBottom
          labelsExtraHeight={20}
          xAxisLabelTextStyle={{ color: colors.muted, fontSize: 9.5 }}
          renderTooltip={(item: { value: number; date?: string }) => (
            <View style={styles.tip}>
              {item.date ? <Text style={styles.tipDate}>{formatMonthYear(item.date, locale)}</Text> : null}
              <Text style={styles.tipValue}>{fmt(item.value)}</Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tip: {
    backgroundColor: colors.ink,
    borderRadius: radius.sm,
    paddingVertical: spacing.xs + 1,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.xs,
  },
  tipDate: { color: 'rgba(255,255,255,0.7)', fontSize: 10, marginBottom: 1 },
  tipValue: { color: '#fff', fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
