import type { CicadaDB } from '../db/migrations';
import { notifyDataChanged, notifySettingsChanged } from '../db/changes';
import { syncScheduler } from './scheduler';

/** A local mutation happened — ask the scheduler to push (debounced). */
export function bumpDirty(db?:CicadaDB,kind:'data'|'settings'='data'): void {
  if(kind==='settings')notifySettingsChanged();else notifyDataChanged();
  syncScheduler.markDirty(db?.ledgerMode);
}
