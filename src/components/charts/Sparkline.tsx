import { LineChart } from 'react-native-gifted-charts';
import { View } from 'react-native';

import { useTheme } from '../../hooks/SettingsContext';

type Props = {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  /** Render a soft gradient area below the line (used for the home hero trend). */
  area?: boolean;
};

export function Sparkline({
  values,
  width = 80,
  height = 32,
  color,
  area = false,
}: Props) {
  const c = useTheme();
  const lineColor = color ?? c.primary;

  if (values.length < 2) return <View style={{ width, height }} />;

  // Normalize so only the SHAPE matters. gifted-charts baselines at 0, which
  // clips all-negative series (e.g. a 花呗 liability); normalizing keeps any
  // range — positive, negative, or flat — fully visible. We map into a padded
  // band (not 0..1) so peaks/troughs don't slam into the top/bottom edges and
  // there's headroom for the curve to overshoot without being clipped.
  const PAD = 0.15;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const data = values.map((v) => ({
    value: span === 0 ? 0.5 : PAD + ((v - min) / span) * (1 - 2 * PAD),
  }));

  return (
    // gifted-charts can render a few px wider than `width`; clip the spillover.
    <View style={{ width, height, overflow: 'hidden' }}>
      <LineChart
        data={data}
        width={width}
        height={height}
        adjustToWidth
        hideDataPoints
        hideAxesAndRules
        hideYAxisText
        xAxisColor="transparent"
        yAxisColor="transparent"
        color={lineColor}
        thickness={area ? 2.5 : 1.5}
        curved
        maxValue={1}
        initialSpacing={0}
        endSpacing={0}
        disableScroll
        areaChart={area}
        startFillColor={area ? lineColor : undefined}
        endFillColor={area ? lineColor : undefined}
        startOpacity={area ? 0.22 : 0}
        endOpacity={0}
      />
    </View>
  );
}
