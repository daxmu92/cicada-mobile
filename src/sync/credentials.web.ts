import { normalizeStoredConfig, type StoredRemoteConfig } from './remote-config';

const STORE_FILE = 'cicada-credentials.json';
const KEY = 'webdav';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function openStore() {
  const { load } = await import('@tauri-apps/plugin-store');
  return load(STORE_FILE, { defaults: {}, autoSave: true });
}

export async function loadCredentials(): Promise<StoredRemoteConfig | null> {
  if (!isTauri()) return null;
  const store = await openStore();
  const val = await store.get<unknown>(KEY);
  return normalizeStoredConfig(val ?? null);
}

export async function saveCredentials(config: StoredRemoteConfig): Promise<void> {
  if (!isTauri()) return;
  const store = await openStore();
  await store.set(KEY, config);
  await store.save();
}

export async function clearCredentials(): Promise<void> {
  if (!isTauri()) return;
  const store = await openStore();
  await store.delete(KEY);
  await store.save();
}
