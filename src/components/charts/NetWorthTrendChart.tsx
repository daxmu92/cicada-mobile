import { useMemo, useState } from 'react';
import { LayoutChangeEvent, View } from 'react-native';
import { LineChart } from 'react-native-gifted-charts';

import { useLocale, useSemanticColors, useTheme } from '../../hooks/SettingsContext';
import { abbrev, niceAxis } from '../../utils/chart';
import { monthShort } from '../../utils/date';
import { spacing } from '../../utils/theme';
import { usePointerConfig } from './pointer';

export type TrendPoint = {
  label: string; // "YYYY-MM"
  value: number;
};

type Props = {
  points: TrendPoint[];
  color?: string;
  height?: number;
};

const Y_AXIS_WIDTH = 42;

/**
 * Compact net-worth line chart with axes for the home hero card. Width is
 * measured from the actual container (not Dimensions) so it never overflows the
 * card; the y-axis auto-scales to the data range rather than starting at zero.
 */
export function NetWorthTrendChart({ points, color, height = 150 }: Props) {
  const locale = useLocale();
  const c = useTheme();
  const { gain, loss } = useSemanticColors();
  const [boxWidth, setBoxWidth] = useState(0);

  // A net-worth curve is colored by its net direction over the range, honoring
  // the user's gain/loss convention (green-up or red-up) — never the theme
  // accent, so it reads the same across themes. Callers may still override.
  const lineColor =
    color ??
    (points.length > 1 && points[points.length - 1].value >= points[0].value ? gain : loss);

  const axis = useMemo(() => {
    const vals = points.map((p) => p.value);
    return niceAxis(Math.min(...vals), Math.max(...vals), 3);
  }, [points]);

  // Shift data down by the baseline so gifted-charts plots from 0 (reliable),
  // then add the baseline back in the y-axis labels. Avoids the flaky yAxisOffset.
  const chartData = useMemo(() => {
    const count = points.length;
    const step = Math.max(1, Math.ceil(count / 6)); // ~6 x-labels max
    return points.map((p, i) => {
      const month = Number(p.label.split('-')[1]);
      return {
        value: p.value - axis.offset,
        actual: p.value, // unshifted, for the tooltip
        date: p.label, // full "YYYY-MM", for the tooltip
        label: i % step === 0 ? monthShort(month, locale) : '',
      };
    });
  }, [points, locale, axis.offset]);

  const pointer = usePointerConfig(lineColor);

  // gifted-charts total width = plot width + y-axis labels; subtract the axis
  // (plus a small margin) from the measured box so nothing spills out.
  const plotWidth = Math.max(boxWidth - Y_AXIS_WIDTH - spacing.sm, 0);

  return (
    <View onLayout={(e: LayoutChangeEvent) => setBoxWidth(e.nativeEvent.layout.width)} style={{ overflow: 'hidden' }}>
      {points.length >= 2 && plotWidth > 0 && (
        <LineChart
          data={chartData}
          height={height}
          width={plotWidth}
          color={lineColor}
          thickness={2.5}
          curved
          adjustToWidth
          hideDataPoints
          areaChart
          startFillColor={lineColor}
          startOpacity={0.18}
          endOpacity={0.0}
          // y-axis range (data is pre-shifted by axis.offset; labels add it back)
          maxValue={axis.top - axis.offset}
          noOfSections={axis.noOfSections}
          stepValue={axis.niceStep}
          // axes + grid
          yAxisColor={c.border}
          xAxisColor={c.border}
          rulesColor={c.border}
          rulesType="solid"
          yAxisTextStyle={{ color: c.muted, fontSize: 10 }}
          xAxisLabelTextStyle={{ color: c.muted, fontSize: 10 }}
          formatYLabel={(label: string) => abbrev(Number(label) + axis.offset)}
          yAxisLabelWidth={Y_AXIS_WIDTH}
          initialSpacing={8}
          endSpacing={16}
          disableScroll
          pointerConfig={pointer}
        />
      )}
    </View>
  );
}
