import { useEffect, useRef } from 'react';
import { useNavigation, usePreventRemove, useRoute } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { confirmAsync, notify } from '../utils/dialog';
import { registerDraft } from '../ledger/drafts';
export function useUnsavedChanges(dirty: boolean, saving = false, onDiscard?:()=>void|Promise<void>) {
  const navigation=useNavigation(); const route=useRoute(); const {t}=useTranslation();
  const approved=useRef(false); const state=useRef({dirty,saving,onDiscard});
  state.current={dirty,saving,onDiscard};
  const previousDirty=useRef(dirty);
  if(dirty&&!previousDirty.current)approved.current=false;
  previousDirty.current=dirty;
  usePreventRemove(dirty||saving,({data})=>{
    if(approved.current) { navigation.dispatch(data.action); return; }
    if(state.current.saving) return;
    void confirmAsync(t('drafts.title'),t('drafts.body')).then(async ok=>{
      if(ok) { await state.current.onDiscard?.(); approved.current=true; navigation.dispatch(data.action); }
    }).catch(()=>notify(t('common.error'),t('draftRecovery.error')));
  });
  useEffect(()=>registerDraft(route.key,{
    dirty:()=>state.current.dirty&&!approved.current,
    saving:()=>state.current.saving,
    discard:async()=>{await state.current.onDiscard?.();approved.current=true;},
  }),[route.key]);
  return ()=>{approved.current=true;};
}
