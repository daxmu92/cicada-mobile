import { LineChart } from 'react-native-gifted-charts';
import { View } from 'react-native';

import { colors } from '../../utils/theme';

type Props = {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
};

export function Sparkline({ values, width = 80, height = 32, color = colors.primary }: Props) {
  if (values.length < 2) return <View style={{ width, height }} />;

  const data = values.map((v) => ({ value: v }));

  return (
    <View style={{ width, height }}>
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
        color={color}
        thickness={1.5}
        curved
        initialSpacing={0}
        endSpacing={0}
        disableScroll
      />
    </View>
  );
}
