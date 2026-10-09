import { useEffect,useRef,useState } from 'react';
import { ScrollView,Text,TouchableOpacity,View } from 'react-native';
import { useLocalSearchParams,useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useFormat,useShared,useTheme } from '../../src/hooks/SettingsContext';
import { getReconciliationPreview,confirmReconciliation } from '../../src/services/reconciliation';
import { confirmAsync,notify } from '../../src/utils/dialog';
type ReconciliationPreview = Awaited<ReturnType<typeof getReconciliationPreview>>;
export default function ReconcileAsset() {
  const {assetId}=useLocalSearchParams<{assetId:string}>(); const router=useRouter(); const {t}=useTranslation();
  const shared=useShared(); const c=useTheme(); const {fmt}=useFormat();
  const [preview,setPreview]=useState<ReconciliationPreview|null>(null); const [error,setError]=useState(false); const [busy,setBusy]=useState(false);
  const load=async()=>{setError(false);try{setPreview(await getReconciliationPreview(Number(assetId)));}catch{setError(true);}};
  useEffect(()=>{let cancelled=false;void getReconciliationPreview(Number(assetId)).then(p=>{if(!cancelled)setPreview(p);}).catch(()=>{if(!cancelled)setError(true);});return()=>{cancelled=true;};},[assetId]);
  const locked=useRef(false);
  const apply=async()=>{
    if(!preview||locked.current||!preview.changes.length)return;
    locked.current=true;setBusy(true);
    try{
      if(!await confirmAsync(t('reconcile.title'),t('reconcile.confirm',{count:preview.changes.length})))return;
      await confirmReconciliation(preview);router.back();
    }
    catch(e){notify(t('common.error'),t(e instanceof Error&&e.message==='RECONCILIATION_CHANGED'?'reconcile.stale':'common.saveFailed'));await load();}
    finally{locked.current=false;setBusy(false);}
  };
  return <ScrollView style={shared.screen} contentContainerStyle={shared.scrollContent}>
    <View style={shared.card}><Text style={shared.heading}>{t('reconcile.title')}</Text><Text style={shared.muted}>{t('reconcile.help')}</Text></View>
    {error?<TouchableOpacity onPress={load}><Text>{t('common.retry')}</Text></TouchableOpacity>:!preview?<Text>{t('common.loading')}</Text>:<>
      {!preview.changes.length&&<Text style={shared.muted}>{t('reconcile.clean')}</Text>}
      {preview.changes.map(change=><View key={change.date} style={shared.card}><Text style={shared.heading}>{change.date}</Text><Text style={shared.muted}>{t('reconcile.previous',{date:change.previousDate})}</Text><Text style={{color:c.ink}}>{fmt(change.before)} → {fmt(change.after)}</Text></View>)}
      <TouchableOpacity accessibilityRole="button" disabled={busy||!preview.changes.length} onPress={apply} style={shared.card}><Text style={{color:c.primary}}>{t(busy?'common.saving':'reconcile.apply')}</Text></TouchableOpacity>
    </>}
  </ScrollView>;
}
