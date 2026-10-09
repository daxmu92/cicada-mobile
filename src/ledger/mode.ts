import { useSyncExternalStore } from 'react';
export type LedgerMode = 'live' | 'demo';
let mode: LedgerMode = 'live';
let epoch=0;
export const getLedgerEpoch=()=>epoch;
try { if(typeof window!=='undefined'&&window.sessionStorage?.getItem('cicada-ledger-mode')==='demo')mode='demo'; } catch {}
const subscribers=new Set<()=>void>();
export const getLedgerMode=()=>mode;
export const isDemoLedger=()=>mode==='demo';
export function setLedgerMode(next: LedgerMode) { if(mode!==next)epoch++;mode=next; try { if(typeof window!=='undefined')window.sessionStorage?.setItem('cicada-ledger-mode',next); } catch {} subscribers.forEach(fn=>fn()); }
export function useLedgerMode() {
  return useSyncExternalStore((fn)=>{subscribers.add(fn);return()=>{subscribers.delete(fn);};},getLedgerMode,()=> 'live' as LedgerMode);
}
