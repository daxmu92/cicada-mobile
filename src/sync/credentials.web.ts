import { invoke } from '@tauri-apps/api/core';
import type { WebDavConfig } from './providers/webdav';
import { createAsyncLock } from '../utils/async-lock';

const lock = createAsyncLock();
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
async function legacyStore() {
  const { load } = await import('@tauri-apps/plugin-store');
  return load('cicada-credentials.json', { defaults: {}, autoSave: false });
}
export function loadCredentials(): Promise<WebDavConfig | null> {
  return lock.run(async () => {
    if (!isTauri()) return null;
    const secret = await invoke<string | null>('cicada_load_credentials');
    if (secret) return JSON.parse(secret) as WebDavConfig;
    const store = await legacyStore();
    const config = await store.get<WebDavConfig>('webdav');
    if (!config) return null;
    // Remove the plaintext only after the OS credential store accepted it.
    await invoke('cicada_save_credentials', { secret: JSON.stringify(config) });
    await store.delete('webdav'); await store.save();
    return config;
  });
}
export function saveCredentials(config: WebDavConfig): Promise<void> {
  return lock.run(async () => {
    if (!isTauri()) return;
    await invoke('cicada_save_credentials', { secret: JSON.stringify(config) });
    const store = await legacyStore(); await store.delete('webdav'); await store.save();
  });
}
export function clearCredentials(): Promise<void> {
  return lock.run(async () => {
    if (!isTauri()) return;
    await invoke('cicada_clear_credentials');
    const store = await legacyStore(); await store.delete('webdav'); await store.save();
  });
}
