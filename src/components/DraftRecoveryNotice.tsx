import { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../hooks/SettingsContext';
import type { useRecoverableDraft } from '../hooks/use-recoverable-draft';
export function DraftRecoveryNotice({recovery}:{recovery:ReturnType<typeof useRecoverableDraft>}){
 const {t}=useTranslation(),c=useTheme();const [showPreview,setShowPreview]=useState(false);
 if(!recovery.draft)return recovery.status==='idle'?null:<Text style={{color:c.muted,fontSize:12,marginBottom:10}}>{t('draftRecovery.'+recovery.status)}</Text>;
 const value=recovery.draft.value;
 const labels=[t('addRecord.netWorth'),t('addRecord.inflow'),t('addRecord.profit')];
 const preview=Array.isArray(value)&&value.length===5&&value.every(v=>typeof v==='string')?[t(value[0]==='INCOME'?'addTransaction.typeIncome':'addTransaction.typeOutlay'),...value.slice(1)].join(' · '):Array.isArray(value)&&value.length===4?labels.map((label,i)=>`${label}: ${String(value[i])}`).join(' · '):Array.isArray(value)?value.map(item=>item&&typeof item==='object'&&'draft' in item?`${item.name||t('nav.asset')} · ${labels.map((label,i)=>`${label}: ${item.draft[['netWorth','inflow','profit'][i]]}`).join(' · ')}`:'').join('\n'):'';
 return <View style={{padding:14,borderRadius:10,backgroundColor:c.accentSoft,marginBottom:12,gap:10}}>
  <Text style={{color:c.ink}}>{t('draftRecovery.found',{date:new Date(recovery.draft.updatedAt).toLocaleString()})}</Text>
  {recovery.status==='error'&&<Text style={{color:c.muted}}>{t('draftRecovery.error')}</Text>}
  {!recovery.canRestore&&<Text style={{color:c.muted}}>{t('draftRecovery.changed')}</Text>}
  <TouchableOpacity accessibilityRole="button" onPress={()=>setShowPreview(!showPreview)}><Text style={{color:c.primary}}>{t('draftRecovery.preview')}</Text></TouchableOpacity>
  {showPreview&&<Text selectable style={{color:c.ink}}>{preview}</Text>}
  <View style={{flexDirection:'row',gap:20}}>
   {recovery.canRestore&&<TouchableOpacity accessibilityRole="button" onPress={()=>{void recovery.restore();}}><Text style={{color:c.primary}}>{t('draftRecovery.restore')}</Text></TouchableOpacity>}
   <TouchableOpacity accessibilityRole="button" onPress={()=>{void recovery.discard();}}><Text style={{color:c.primary}}>{t('draftRecovery.discard')}</Text></TouchableOpacity>
  </View>
 </View>;
}
