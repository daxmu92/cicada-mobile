import { useSyncExternalStore } from 'react';
import { dataVersion, serverDataVersion, subscribeData } from '../db/changes';
export function useDataVersion() { return useSyncExternalStore(subscribeData, dataVersion, serverDataVersion); }
