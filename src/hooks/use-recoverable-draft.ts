import { useCallback, useEffect, useRef, useState } from 'react';
import { getDatabase } from '../db/database';
import { getLedgerEpoch, getLedgerMode } from '../ledger/mode';
import { readLocalDraft, removeLocalDraft, saveLocalDraft, type LocalDraft } from '../services/local-draft-core';
export function useRecoverableDraft(options:{key:string|null;ready:boolean;dirty:boolean;baseline:string;value:unknown;restore:(value:unknown)=>void|Promise<void>;valid?:(value:unknown)=>boolean}){
 const content=JSON.stringify(options.value);
 const mode=getLedgerMode(),epoch=getLedgerEpoch(),session=`${mode}:${epoch}:${options.key??''}`;
 const [state,setState]=useState<{session:string;loaded:boolean;draft:LocalDraft|null}>({session:'',loaded:false,draft:null});
 const [paused,setPaused]=useState(false);
 const [status,setStatus]=useState<'idle'|'saving'|'saved'|'error'>('idle');
 const controller=useRef({session:'',generation:0,cleared:false,timer:null as ReturnType<typeof setTimeout>|null});
 const latest=useRef(options);latest.current=options;
 useEffect(()=>{
  const control=controller.current;control.session=session;control.generation++;control.cleared=false;setPaused(false);setStatus('idle');
  let cancelled=false;
  if(!options.ready||!options.key){setState({session,loaded:false,draft:null});return;}
  setState({session,loaded:false,draft:null});
  void getDatabase(mode).then(db=>readLocalDraft(db,options.key!)).then(draft=>{if(!cancelled)setState({session,loaded:true,draft});}).catch(()=>{if(!cancelled){setState({session,loaded:true,draft:null});setStatus('error');}});
  return()=>{cancelled=true;control.generation++;if(control.timer)clearTimeout(control.timer);};
 },[session,mode,options.ready,options.key]);
 const loaded=state.session===session&&state.loaded;
 const draft=loaded?state.draft:null;
 const canRestore=Boolean(draft&&draft.baseline===options.baseline&&(options.valid?.(draft.value)??true));
 const clear=useCallback(async()=>{
  const control=controller.current;control.generation++;control.cleared=true;if(control.timer)clearTimeout(control.timer);
  if(!options.key)return true;
  try{await removeLocalDraft(await getDatabase(mode),options.key);if(control.session===session){setState({session,loaded:true,draft:null});setStatus('idle');}return true;}
  catch{if(control.session===session){control.cleared=false;setStatus('error');}return false;}
 },[mode,session,options.key]);
 const discard=useCallback(async()=>{if(!await clear())return;if(controller.current.session===session)controller.current.cleared=false;},[clear,session]);
 const restore=async()=>{
  if(!draft||!canRestore)return;
  try {await latest.current.restore(draft.value);}catch{setStatus('error');return;}
  if(controller.current.session===session){setState({session,loaded:true,draft:null});controller.current.cleared=false;setStatus('saved');}
 };
 useEffect(()=>{
  if(paused||!loaded||draft||!options.ready||!options.key||controller.current.cleared)return;
  if(!options.dirty){
   const control=controller.current,generation=++control.generation;
   void getDatabase(mode).then(async db=>{if(control.session!==session||control.generation!==generation)return;await removeLocalDraft(db,options.key!);if(control.session===session&&control.generation===generation)setStatus('idle');}).catch(()=>{if(control.session===session&&control.generation===generation)setStatus('error');});
   return;
  }
  const control=controller.current,generation=++control.generation;setStatus('saving');
  const timer=setTimeout(()=>{
   void getDatabase(mode).then(async db=>{
    if(control.session!==session||control.generation!==generation||control.cleared)return;
    await saveLocalDraft(db,options.key!,options.baseline,JSON.parse(content));
    if(control.session===session&&control.generation===generation)setStatus('saved');
   }).catch(()=>{if(control.session===session&&control.generation===generation)setStatus('error');});
  },500);control.timer=timer;
  return()=>clearTimeout(timer);
 },[paused,loaded,draft,mode,session,options.ready,options.dirty,options.key,options.baseline,content]);
 const pause=()=>{controller.current.generation++;controller.current.cleared=true;if(controller.current.timer)clearTimeout(controller.current.timer);setPaused(true);};
 const resume=()=>{controller.current.cleared=false;setPaused(false);};
 const consumed=()=>{pause();setState({session,loaded:true,draft:null});setStatus('idle');};
 return {pause,resume,consumed,blocked:options.ready&&Boolean(options.key)&&(!loaded||Boolean(draft)),draft,canRestore,restore,discard,clear,status};
}
