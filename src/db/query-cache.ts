import {getLedgerEpoch} from '../ledger/mode';
import {dataVersion} from './changes';
import {createQueryCache} from './query-cache-core';
export const readCached=createQueryCache(()=>`${getLedgerEpoch()}:${dataVersion()}`);
