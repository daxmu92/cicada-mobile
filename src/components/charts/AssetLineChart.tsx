import { useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { LineChart } from 'react-native-gifted-charts';

import { abbrev, niceAxis } from '../../utils/chart';
import { colors, spacing } from '../../utils/theme';

export type LinePoint = {
  label: string;
  value: number;
};

type Props = {
  data: LinePoint[];
  color?: string;
  height?: number;
};

const Y_AXIS_WIDTH = 46;

/** "2024-07" → "07/24" (compact, unambiguous across years, fits one line). */
function shortMonthYear(ym: string): string {
  const [y, m] = ym.split('-');
  return `${m}/${y.slice(2)}`;
}

export function AssetLineChart({ data, color = colors.primary, height = 220 }: Props) {
  const { t } = useTranslation();
  const [boxWidth, setBoxWidth] = useState(0);

  const axis = useMemo(() => {
    const vals = data.map((p) => p.value);
    if (vals.length === 0) return null;
    return niceAxis(Math.min(...vals), Math.max(...vals), 4);
  }, [data]);

  // Shift values down by the baseline so gifted-charts plots from 0 (reliable);
  // the y-axis labels add the baseline back (keeps negative series visible).
  const chartData = useMemo(() => {
    const offset = axis?.offset ?? 0;
    const count = data.length;
    const labelStep = count > 12 ? Math.ceil(count / 6) : 1;
    return data.map((p, i) => ({
      value: p.value - offset,
      label: i % labelStep === 0 ? shortMonthYear(p.label) : '',
      dataPointText: '',
    }));
  }, [data, axis]);

  if (data.length === 0 || !axis) {
    return (
      <View style={styles.empty}>
        <Text style={{ color: colors.muted }}>{t('charts.noDataYet')}</Text>
      </View>
    );
  }

  // Measure the container so the chart (plot + y-axis labels) fits exactly.
  const plotWidth = Math.max(boxWidth - Y_AXIS_WIDTH - spacing.sm, 0);

  return (
    <View onLayout={(e: LayoutChangeEvent) => setBoxWidth(e.nativeEvent.layout.width)} style={{ overflow: 'hidden' }}>
      {plotWidth > 0 && (
      <LineChart
        data={chartData}
        height={height}
        width={plotWidth}
        adjustToWidth
        yAxisLabelWidth={Y_AXIS_WIDTH}
        color={color}
        thickness={2}
        curved
        hideDataPoints={data.length > 12}
        dataPointsColor={color}
        dataPointsRadius={3}
        maxValue={axis.top - axis.offset}
        noOfSections={axis.noOfSections}
        stepValue={axis.niceStep}
        yAxisTextStyle={{ color: colors.muted, fontSize: 10 }}
        formatYLabel={(label: string) => abbrev(Number(label) + axis.offset)}
        // Dense date axis: rotate labels so they don't get clipped to the
        // (tiny) per-point width. labelsExtraHeight reserves room for them.
        rotateLabel
        labelsExtraHeight={20}
        xAxisLabelTextStyle={{ color: colors.muted, fontSize: 9.5 }}
        yAxisColor={colors.border}
        xAxisColor={colors.border}
        rulesColor={colors.border}
        rulesType="solid"
        initialSpacing={10}
        endSpacing={10}
        areaChart
        startFillColor={color}
        startOpacity={0.2}
        endOpacity={0.0}
      />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    height: 200,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
