import { notifyDataChanged } from '../db/changes';
import { syncScheduler } from './scheduler';

/** A local mutation happened — ask the scheduler to push (debounced). */
export function bumpDirty(): void {
  notifyDataChanged();
  syncScheduler.markDirty();
}
