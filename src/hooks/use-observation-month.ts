import { useSyncExternalStore } from 'react';
import { getLedgerMode } from '../ledger/mode';
import { currentYearMonth } from '../utils/date';
const months=new Map<string,string>();
const subscribers=new Set<()=>void>();
function current(){return months.get(getLedgerMode())??currentYearMonth();}
export function useObservationMonth():[string,(month:string)=>void]{
 const month=useSyncExternalStore(listener=>{subscribers.add(listener);return()=>{subscribers.delete(listener);};},current,currentYearMonth);
 return [month,next=>{months.set(getLedgerMode(),next);subscribers.forEach(listener=>listener());}];
}
