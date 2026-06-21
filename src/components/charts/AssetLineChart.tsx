import { useMemo } from 'react';
import { Dimensions, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { LineChart } from 'react-native-gifted-charts';

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

export function AssetLineChart({ data, color = colors.primary, height = 220 }: Props) {
  const { t } = useTranslation();
  const { chartData, maxLabelCount } = useMemo(() => {
    const count = data.length;
    const labelStep = count > 12 ? Math.ceil(count / 6) : 1;
    return {
      chartData: data.map((p, i) => ({
        value: p.value,
        label: i % labelStep === 0 ? p.label.slice(2) : '',
        dataPointText: '',
      })),
      maxLabelCount: Math.ceil(count / labelStep),
    };
  }, [data]);

  if (data.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={{ color: colors.muted }}>{t('charts.noDataYet')}</Text>
      </View>
    );
  }

  const screenWidth = Dimensions.get('window').width;
  const chartWidth = Math.max(screenWidth - spacing.lg * 4, 300);

  return (
    <View>
      <LineChart
        data={chartData}
        height={height}
        width={chartWidth}
        color={color}
        thickness={2}
        curved
        hideDataPoints={data.length > 12}
        dataPointsColor={color}
        dataPointsRadius={3}
        yAxisTextStyle={{ color: colors.muted, fontSize: 10 }}
        xAxisLabelTextStyle={{ color: colors.muted, fontSize: 10 }}
        yAxisColor={colors.border}
        xAxisColor={colors.border}
        rulesColor={colors.border}
        rulesType="solid"
        initialSpacing={10}
        endSpacing={10}
        noOfSections={4}
        areaChart
        startFillColor={color}
        startOpacity={0.2}
        endOpacity={0.0}
      />
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
