import { useMemo, useState } from 'react';
import { Dimensions, LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { LineChart } from 'react-native-gifted-charts';

import { useTheme, useThemedStyles } from '../../hooks/SettingsContext';
import { abbrev, niceAxis } from '../../utils/chart';
import { spacing, type ThemeColors } from '../../utils/theme';
import { usePointerConfig } from './pointer';

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
// Reserve a stable box so the card never collapses while a freshly-mounted
// chart waits for onLayout (prevents the flicker/jump when switching metrics).
const CHART_BOX_HEIGHT = 272;
const WIDTH_ESTIMATE = Dimensions.get('window').width - 64; // screen + card padding

/** "2024-07" → "07/24" (compact, unambiguous across years, fits one line). */
function shortMonthYear(ym: string): string {
  const [y, m] = ym.split('-');
  return `${m}/${y.slice(2)}`;
}

export function AssetLineChart({ data, color, height = 220 }: Props) {
  const { t } = useTranslation();
  const c = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [boxWidth, setBoxWidth] = useState(WIDTH_ESTIMATE);

  const lineColor = color ?? c.primary;

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
      actual: p.value, // unshifted, for the tooltip
      date: p.label, // full "YYYY-MM", for the tooltip
      label: i % labelStep === 0 ? shortMonthYear(p.label) : '',
      dataPointText: '',
    }));
  }, [data, axis]);

  const pointer = usePointerConfig(lineColor);

  if (data.length === 0 || !axis) {
    return (
      <View style={styles.empty}>
        <Text style={{ color: c.muted }}>{t('charts.noDataYet')}</Text>
      </View>
    );
  }

  // Measure the container so the chart (plot + y-axis labels) fits exactly.
  const plotWidth = Math.max(boxWidth - Y_AXIS_WIDTH - spacing.sm, 0);

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setBoxWidth(e.nativeEvent.layout.width)}
      style={{ overflow: 'hidden', minHeight: CHART_BOX_HEIGHT }}>
      {plotWidth > 0 && (
      <LineChart
        data={chartData}
        height={height}
        width={plotWidth}
        adjustToWidth
        yAxisLabelWidth={Y_AXIS_WIDTH}
        color={lineColor}
        thickness={2}
        curved
        hideDataPoints={data.length > 12}
        dataPointsColor={lineColor}
        dataPointsRadius={3}
        maxValue={axis.top - axis.offset}
        noOfSections={axis.noOfSections}
        stepValue={axis.niceStep}
        yAxisTextStyle={{ color: c.muted, fontSize: 10 }}
        formatYLabel={(label: string) => abbrev(Number(label) + axis.offset)}
        // Dense date axis: rotate labels so they don't get clipped to the
        // (tiny) per-point width. labelsExtraHeight reserves room for them.
        rotateLabel
        labelsExtraHeight={20}
        xAxisLabelTextStyle={{ color: c.muted, fontSize: 9.5 }}
        yAxisColor={c.border}
        xAxisColor={c.border}
        rulesColor={c.border}
        rulesType="solid"
        initialSpacing={10}
        endSpacing={10}
        areaChart
        startFillColor={lineColor}
        startOpacity={0.2}
        endOpacity={0.0}
        pointerConfig={pointer}
      />
      )}
    </View>
  );
}

const makeStyles = (c: ThemeColors) =>
  StyleSheet.create({
    empty: {
      height: 200,
      justifyContent: 'center',
      alignItems: 'center',
    },
  });
