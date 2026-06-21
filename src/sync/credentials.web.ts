import type { WebDavConfig } from './providers/webdav';

const STORE_FILE = 'cicada-credentials.json';
const KEY = 'webdav';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function openStore() {
  const { load } = await import('@tauri-apps/plugin-store');
  // `defaults` is required by StoreOptions (plugin-store v2.4); we persist
  // explicitly via store.save() after every mutation regardless of autoSave.
  return load(STORE_FILE, { defaults: {}, autoSave: true });
}

export async function loadCredentials(): Promise<WebDavConfig | null> {
  if (!isTauri()) return null; // plain browser: sync disabled, no credentials
  const store = await openStore();
  const val = await store.get<WebDavConfig>(KEY);
  return val ?? null;
}

export async function saveCredentials(config: WebDavConfig): Promise<void> {
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
