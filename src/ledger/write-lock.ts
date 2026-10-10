import { createAsyncLock } from '../utils/async-lock';
/** Lock order: scheduler, then writes. Local writes never wait for the scheduler. */
export const ledgerWriteLock=createAsyncLock();
