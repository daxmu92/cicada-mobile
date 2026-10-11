import { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ObservationMetadata } from '../db/observation-repo';
import { useTheme } from '../hooks/SettingsContext';
import { useDesktopLayout } from '../hooks/use-desktop-layout';
export function ObservationNotice({meta,month,onLatest}:{meta:ObservationMetadata|null;month:string;onLatest:(month:string)=>void}){
 const {t}=useTranslation(),c=useTheme(),{desktop}=useDesktopLayout();
 const [expanded,setExpanded]=useState(false);
 if(!meta)return null;
 const incomplete=meta.recordedActive<meta.activeAssets;
 return <View testID="observation-notice" style={{padding:desktop?0:12,gap:8,backgroundColor:desktop?undefined:c.accentSoft,borderRadius:10,marginBottom:desktop?20:14}}>
  <View style={{flexDirection:'row',alignItems:'center',flexWrap:'wrap',gap:12}}>
   <Text style={{color:incomplete?'#8a6225':c.muted,fontSize:desktop?12:14}}>{t('observation.coverage',{month,count:meta.recordedActive,total:meta.activeAssets})}</Text>
   {meta.latestMonth&&meta.latestMonth!==month&&<TouchableOpacity accessibilityRole="button" onPress={()=>onLatest(meta.latestMonth!)}><Text style={{color:c.primary,fontSize:12}}>{t('observation.goLatest',{month:meta.latestMonth})}</Text></TouchableOpacity>}
   {desktop&&<TouchableOpacity accessibilityRole="button" accessibilityState={{expanded}} onPress={()=>setExpanded(!expanded)}><Text style={{color:c.muted,fontSize:12}}>{t(expanded?'desktop.hideDataDetails':'desktop.dataDetails')}</Text></TouchableOpacity>}
  </View>
  {(!desktop||expanded)&&<>
   <Text style={{color:c.muted,fontSize:12}}>{t('observation.latest',{date:meta.latestMonth??'—'})} · {t('observation.transactionLatest',{date:meta.latestTransaction??'—'})}</Text>
   <Text style={{color:c.muted,fontSize:11}}>{t('observation.coverageHelp')}</Text>
  </>}
 </View>;
}
