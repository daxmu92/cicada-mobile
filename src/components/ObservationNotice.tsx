import { Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ObservationMetadata } from '../db/observation-repo';
import { useTheme } from '../hooks/SettingsContext';
export function ObservationNotice({meta,month,onLatest}:{meta:ObservationMetadata|null;month:string;onLatest:(month:string)=>void}){
 const {t}=useTranslation();const c=useTheme();if(!meta)return null;
 return <View style={{padding:12,gap:5,backgroundColor:c.accentSoft,borderRadius:10,marginBottom:14}}>
  <Text style={{color:c.ink}}>{t('observation.coverage',{month,count:meta.recordedActive,total:meta.activeAssets})}</Text>
  <Text style={{color:c.muted,fontSize:12}}>{t('observation.latest',{date:meta.latestMonth??'—'})} · {t('observation.transactionLatest',{date:meta.latestTransaction??'—'})}</Text>
  {meta.latestMonth&&meta.latestMonth!==month&&<TouchableOpacity accessibilityRole="button" onPress={()=>onLatest(meta.latestMonth!)}><Text style={{color:c.primary}}>{t('observation.goLatest',{month:meta.latestMonth})}</Text></TouchableOpacity>}
  <Text style={{color:c.muted,fontSize:11}}>{t('observation.coverageHelp')}</Text>
 </View>;
}
