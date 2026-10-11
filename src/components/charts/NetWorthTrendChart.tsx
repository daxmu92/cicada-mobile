import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { useTranslation } from 'react-i18next';
import { useFormat, useLocale, useSemanticColors, useTheme } from '../../hooks/SettingsContext';
import { abbrev, niceAxis } from '../../utils/chart';
import { monthShort } from '../../utils/date';
import { trendPath } from '../../utils/observation';
export type TrendPoint = {label:string;value:number|null;partial?:boolean};
export function NetWorthTrendChart({points,color,height=150}:{points:TrendPoint[];color?:string;height?:number}){
 const c=useTheme(),locale=useLocale(),{fmt}=useFormat(),{gain,loss}=useSemanticColors(),{t}=useTranslation();
 const [width,setWidth]=useState(0),[selected,setSelected]=useState<number|null>(null);
 useEffect(()=>setSelected(null),[points]);
 const values=points.flatMap(p=>p.value===null?[]:[p.value]);
 const axis=niceAxis(values.length?Math.min(...values):0,values.length?Math.max(...values):1,3);
 if(!values.length)return <Text style={{color:c.muted}}>{t('home.noSnapshot')}</Text>;
 const lineColor=color??(values.at(-1)!>=values[0]?gain:loss),left=52,right=12,top=12,bottom=28;
 const x=(i:number)=>left+Math.max(0,width-left-right)*i/Math.max(1,points.length-1);
 const y=(v:number)=>top+(axis.top-v)/(axis.top-axis.offset)*(height-top-bottom);
 const selectedPoint=selected===null?undefined:points[selected];
 const labelStep=Math.max(1,Math.ceil(points.length/6));
 return <View onLayout={e=>setWidth(e.nativeEvent.layout.width)}>
  {width>left+right&&<Svg width={width} height={height} accessibilityRole="image" accessibilityLabel={t('analysis.trendTitle')}>
   {Array.from({length:axis.noOfSections+1},(_,i)=>{const v=axis.offset+axis.niceStep*i,yy=y(v);return <Line key={'grid'+i} x1={left} x2={width-right} y1={yy} y2={yy} stroke={c.border}/>;})}
   {Array.from({length:axis.noOfSections+1},(_,i)=>{const v=axis.offset+axis.niceStep*i;return <SvgText key={'axis'+i} x={left-8} y={y(v)+4} fill={c.muted} fontSize={10} textAnchor="end">{abbrev(v,axis.niceStep)}</SvgText>;})}
   <Path d={trendPath(points,x,y)} fill="none" stroke={lineColor} strokeWidth={2.5}/>
   {points.map((p,i)=><Circle key={p.label} cx={x(i)} cy={p.value===null?height-bottom:y(p.value)} r={p.value===null?3:selected===i?5:3} fill={p.value===null?c.border:p.partial?'#b98842':lineColor} onPress={()=>setSelected(i)}/>)}
   {points.map((p,i)=>i%labelStep===0||i===points.length-1?<SvgText key={p.label} x={x(i)} y={height-7} fill={c.muted} fontSize={10} textAnchor="middle">{p.label.endsWith('-01')||i===0?p.label:monthShort(Number(p.label.slice(5)),locale)}</SvgText>:null)}
  </Svg>}
  <Text style={{color:c.muted,fontSize:11}}>{selectedPoint?`${selectedPoint.label} · ${selectedPoint.value===null?t('observation.notRecorded'):fmt(selectedPoint.value)}${selectedPoint.partial?' · '+t('observation.partial'):''}`:t('observation.trendHelp')}</Text>
 </View>;
}
