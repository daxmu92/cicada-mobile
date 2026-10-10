import { View } from 'react-native';
import { completeTrend } from '../../utils/observation';
import { NetWorthTrendChart } from './NetWorthTrendChart';
export type LinePoint = {label:string;value:number};
/** Retain the calendar axis for asset history as well as the aggregate overview. */
export function AssetLineChart({data,color,height=240}:{data:LinePoint[];color?:string;height?:number}){
 const points=data.length?completeTrend(data[0].label,data[data.length-1].label,data.map(point=>({date:point.label,netWorth:point.value}))):[];
 return <View style={{minHeight:272}}><NetWorthTrendChart points={points} color={color} height={height}/></View>;
}
