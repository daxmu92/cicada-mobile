import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { hasUnsavedDrafts, hasSavingDrafts, discardDrafts } from '../ledger/drafts';
import { confirmAsync } from '../utils/dialog';
export function DraftExitGuard() {
  const {t}=useTranslation();
  useEffect(()=>{
    const beforeUnload=(event: BeforeUnloadEvent)=>{
      if(hasUnsavedDrafts()||hasSavingDrafts()){event.preventDefault();event.returnValue='';}
    };
    if(typeof window==='undefined') return;
    window.addEventListener('beforeunload',beforeUnload);
    let cancelled=false; let unlisten:(()=>void)|undefined; let asking=false;
    if('__TAURI_INTERNALS__' in window) {
      void import('@tauri-apps/api/window').then(async ({getCurrentWindow})=>{
        const appWindow=getCurrentWindow();
        const cleanup=await appWindow.onCloseRequested(async event=>{
          if(!hasUnsavedDrafts()&&!hasSavingDrafts()) return;
          event.preventDefault();
          if(asking||hasSavingDrafts()) return;
          asking=true;
          try { if(await confirmAsync(t('drafts.title'),t('drafts.body'))){discardDrafts();await appWindow.close();} }
          finally{asking=false;}
        });
        if(cancelled) cleanup(); else unlisten=cleanup;
      }).catch(()=>{});
    }
    return()=>{cancelled=true;unlisten?.();window.removeEventListener('beforeunload',beforeUnload);};
  },[t]);
  return null;
}
