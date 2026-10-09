import type { LedgerMode } from './mode';
/** Call under the maintenance lock, before resolving a database or mutating. */
export function assertLedgerIdentity(expected: LedgerMode, current: LedgerMode) {
  if(expected!==current)throw new Error('LEDGER_CHANGED');
}
