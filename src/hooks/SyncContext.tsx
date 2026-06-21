import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { isSyncAvailable } from '../sync/available';
import {
  loadCredentials,
  saveCredentials,
  clearCredentials,
} from '../sync/credentials';
import { createConfiguredRemote } from '../sync/remote';
import { type StoredRemoteConfig } from '../sync/remote-config';
import { AuthError } from '../sync/providers/types';
import {
  syncNow as runSyncNow,
  overwriteCloud as runOverwriteCloud,
  LAST_SYNCED_KEY,
  SYNC_IN_PROGRESS_KEY,
} from '../sync/sync';
import { getSyncState, setSyncState } from '../sync/sync-state-repo';
import { getDatabase } from '../db/database';
import { cascadeRepair } from '../sync/apply';

export type SyncStatus = 'idle' | 'syncing' | 'ok' | 'offline' | 'authError' | 'error';

type SyncContextValue = {
  available: boolean;
  connected: boolean;
  status: SyncStatus;
  lastSyncedAt: number | null;
  lastError: string | null;
  testConnection: (config: StoredRemoteConfig) => Promise<void>;
  connect: (config: StoredRemoteConfig) => Promise<void>;
  disconnect: () => Promise<void>;
  syncNow: () => Promise<void>;
  overwriteCloud: () => Promise<void>;
};

const noop = async () => {};
const SyncContext = createContext<SyncContextValue>({
  available: false,
  connected: false,
  status: 'idle',
  lastSyncedAt: null,
  lastError: null,
  testConnection: noop,
  connect: noop,
  disconnect: noop,
  syncNow: noop,
  overwriteCloud: noop,
});

function classify(e: unknown): { status: SyncStatus; message: string } {
  if (e instanceof AuthError) return { status: 'authError', message: e.message };
  // fetch network failures reject with a TypeError ("Network request failed" on RN).
  if (e instanceof TypeError) return { status: 'offline', message: 'network unavailable' };
  const message = e instanceof Error ? e.message : String(e);
  return { status: 'error', message };
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const available = isSyncAvailable();
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const refreshMeta = useCallback(async () => {
    const creds = await loadCredentials();
    setConnected(creds !== null);
    const raw = await getSyncState(LAST_SYNCED_KEY);
    setLastSyncedAt(raw ? Number(raw) : null);
  }, []);

  const doSync = useCallback(async () => {
    if (!available || inFlight.current) return;
    if ((await loadCredentials()) === null) return;
    inFlight.current = true;
    setStatus('syncing');
    setLastError(null);
    try {
      await runSyncNow();
      setStatus('ok');
    } catch (e) {
      const { status: s, message } = classify(e);
      setStatus(s);
      setLastError(message);
    } finally {
      inFlight.current = false;
      await refreshMeta().catch(() => {});
    }
  }, [available, refreshMeta]);

  // Launch trigger + load persisted meta.
  useEffect(() => {
    if (!available) return;
    (async () => {
      // Crash recovery: a set flag means a prior apply was interrupted
      // (Tauri non-atomic). Repair orphans, clear the flag, then sync normally.
      try {
        if ((await getSyncState(SYNC_IN_PROGRESS_KEY)) === '1') {
          const db = await getDatabase();
          await cascadeRepair(db);
          await setSyncState(SYNC_IN_PROGRESS_KEY, '0');
        }
      } catch {
        // recovery is best-effort; never block startup
      }
      await refreshMeta();
      await doSync();
    })();
  }, [available, refreshMeta, doSync]);

  // Foreground trigger (debounced via the in-flight guard).
  useEffect(() => {
    if (!available) return;
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') void doSync();
    });
    return () => sub.remove();
  }, [available, doSync]);

  const testConnection = useCallback(async (config: StoredRemoteConfig) => {
    await createConfiguredRemote(config).testConnection(); // throws on failure
  }, []);

  const connect = useCallback(async (config: StoredRemoteConfig) => {
    await createConfiguredRemote(config).testConnection(); // verify before persisting
    await saveCredentials(config);
    setConnected(true);
    await doSync();
  }, [doSync]);

  const disconnect = useCallback(async () => {
    await clearCredentials();
    setConnected(false);
    setStatus('idle');
    setLastError(null);
  }, []);

  const overwriteCloud = useCallback(async () => {
    if (!available || inFlight.current) return;
    inFlight.current = true;
    setStatus('syncing');
    setLastError(null);
    try {
      await runOverwriteCloud();
      setStatus('ok');
    } catch (e) {
      const { status: s, message } = classify(e);
      setStatus(s);
      setLastError(message);
    } finally {
      inFlight.current = false;
      await refreshMeta().catch(() => {});
    }
  }, [available, refreshMeta]);

  return (
    <SyncContext.Provider
      value={{
        available,
        connected,
        status,
        lastSyncedAt,
        lastError,
        testConnection,
        connect,
        disconnect,
        syncNow: doSync,
        overwriteCloud,
      }}>
      {children}
    </SyncContext.Provider>
  );
}

export function useSync() {
  return useContext(SyncContext);
}
