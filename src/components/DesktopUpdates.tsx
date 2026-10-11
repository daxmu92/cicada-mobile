import {useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Modal,Text,TouchableOpacity,View} from 'react-native';
import {useTranslation} from 'react-i18next';
import type {Update} from '@tauri-apps/plugin-updater';
import {useTheme} from '../hooks/SettingsContext';
import {hasSavingDrafts,hasUnsavedDrafts} from '../ledger/drafts';
import {ledgerWriteLock} from '../ledger/write-lock';
import {syncScheduler} from '../sync/scheduler';
import {confirmAsync,notify} from '../utils/dialog';
import {installVerifiedUpdate} from '../services/update-core';
export const desktopUpdatesAvailable=()=>typeof window!=='undefined'&&'__TAURI_INTERNALS__' in window;
export function checkDesktopUpdates(){if(desktopUpdatesAvailable())window.dispatchEvent(new Event('cicada-check-update'));}
export function DesktopUpdates(){
 const {t}=useTranslation();const translate=useRef(t);translate.current=t;const c=useTheme();const [update,setUpdate]=useState<Update|null>(null);const [busy,setBusy]=useState(false);const active=useRef(false);const current=useRef<Update|null>(null);
 useEffect(()=>{
  if(!desktopUpdatesAvailable())return;
  let disposed=false;
  const check=async(manual=false)=>{
   if(active.current)return;active.current=true;
   try{
    const {check}=await import('@tauri-apps/plugin-updater');const next=await check({timeout:15000});
    if(disposed){await next?.close();return;}
    await current.current?.close();current.current=next;setUpdate(next);
    if(manual&&!next)notify(translate.current('updates.check'),translate.current('updates.latest')); 
   }catch{if(manual&&!disposed)notify(translate.current('common.error'),translate.current('updates.failed'));}
   finally{active.current=false;}
  };
  const manual=()=>{void check(true);};window.addEventListener('cicada-check-update',manual);void check();
  return()=>{disposed=true;window.removeEventListener('cicada-check-update',manual);const old=current.current;current.current=null;void old?.close().catch(()=>{});};
 },[]);
 const install=async()=>{
  if(!update||active.current)return;active.current=true;
  try{
   await installVerifiedUpdate(update,{
    hasDrafts:()=>hasUnsavedDrafts()||hasSavingDrafts(),
    confirm:async()=>{const yes=await confirmAsync(t('updates.install'),t('updates.confirm'));if(yes)setBusy(true);return yes;},
    exclusive:task=>syncScheduler.runExclusive(()=>ledgerWriteLock.run(task)),
    restart:async()=>{const {relaunch}=await import('@tauri-apps/plugin-process');await relaunch();},
   });
  }catch(e){notify(t('common.error'),t(e instanceof Error&&e.message==='UNSAVED_DRAFT'?'updates.draft':'updates.failed'));}
  finally{setBusy(false);active.current=false;}
 };
 if(!desktopUpdatesAvailable())return null;
 return <>{update&&<View style={{padding:10,backgroundColor:c.accentSoft}}><Text style={{color:c.ink}}>{t('updates.available',{version:update.version})}</Text><TouchableOpacity accessibilityRole="button" disabled={busy} onPress={()=>{void install();}}><Text style={{color:c.primary}}>{t('updates.install')}</Text></TouchableOpacity></View>}<Modal visible={busy} transparent><View style={{flex:1,justifyContent:'center',alignItems:'center',backgroundColor:c.bg}}><ActivityIndicator color={c.primary}/><Text style={{color:c.ink}}>{t('updates.busy')}</Text></View></Modal></>;
}
