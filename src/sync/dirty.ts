import type { CicadaDB } from '../db/migrations';
import { notifyDataChanged } from '../db/changes';
import { syncScheduler } from './scheduler';

/** A local mutation happened — ask the scheduler to push (debounced). */
export function bumpDirty(db?:CicadaDB): void {
  notifyDataChanged();
  syncScheduler.markDirty(db?.ledgerMode);
}
