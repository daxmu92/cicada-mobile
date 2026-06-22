import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
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
import { type WebDavConfig } from '../sync/providers/webdav';
import {
  overwriteCloud as runOverwriteCloud,
  LAST_SYNCED_KEY,
  SYNC_IN_PROGRESS_KEY,
} from '../sync/sync';
import { getSyncState, setSyncState } from '../sync/sync-state-repo';
import { getDatabase } from '../db/database';
import { cascadeRepair } from '../sync/apply';
import { syncScheduler } from '../sync/scheduler';
import { AuthError } from '../sync/providers/types';

export type SyncStatus = 'idle' | 'syncing' | 'ok' | 'offline' | 'authError' | 'error';

type SyncContextValue = {
  available: boolean;
  connected: boolean;
  status: SyncStatus;
  lastSyncedAt: number | null;
  lastError: string | null;
  testConnection: (config: WebDavConfig) => Promise<void>;
  connect: (config: WebDavConfig) => Promise<void>;
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

  const refreshMeta = useCallback(async () => {
    const creds = await loadCredentials();
    setConnected(creds !== null);
    const raw = await getSyncState(LAST_SYNCED_KEY);
    setLastSyncedAt(raw ? Number(raw) : null);
  }, []);

  // Subscribe to scheduler status/error updates.
  useEffect(() => {
    const unsub = syncScheduler.subscribe((s) => {
      setStatus(s.status);
      setLastError(s.lastError);
      if (s.status === 'ok') void refreshMeta();
    });
    return unsub;
  }, [refreshMeta]);

  // Launch trigger: crash-recovery, load persisted meta, then start scheduler.
  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    (async () => {
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
      if (cancelled) return;
      syncScheduler.start();
      void syncScheduler.requestSync('launch');
    })();
    return () => {
      cancelled = true;
      syncScheduler.stop();
    };
  }, [available, refreshMeta]);

  // Lifecycle triggers: RN AppState (mobile) + DOM visibility/blur (web + Tauri desktop).
  useEffect(() => {
    if (!available) return;
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') void syncScheduler.requestSync('lifecycle');
    });
    const onVisible = () => {
      if (document.visibilityState === 'visible') void syncScheduler.requestSync('lifecycle');
    };
    const onHide = () => { void syncScheduler.requestSync('lifecycle'); };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisible);
      window.addEventListener('blur', onHide);
    }
    return () => {
      sub.remove();
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisible);
        window.removeEventListener('blur', onHide);
      }
    };
  }, [available]);

  const testConnection = useCallback(async (config: WebDavConfig) => {
    await createConfiguredRemote(config).testConnection(); // throws on failure
  }, []);

  const connect = useCallback(async (config: WebDavConfig) => {
    await createConfiguredRemote(config).testConnection(); // verify before persisting
    await saveCredentials(config);
    setConnected(true);
    void syncScheduler.requestSync('manual');
  }, []);

  const disconnect = useCallback(async () => {
    await clearCredentials();
    setConnected(false);
    setStatus('idle');
    setLastError(null);
  }, []);

  const overwriteCloud = useCallback(async () => {
    // Escape hatch: bypass scheduler, call the engine directly with its own guard.
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
      await refreshMeta().catch(() => {});
    }
  }, [refreshMeta]);

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
        syncNow: () => syncScheduler.requestSync('manual'),
        overwriteCloud,
      }}>
      {children}
    </SyncContext.Provider>
  );
}

export function useSync() {
  return useContext(SyncContext);
}
