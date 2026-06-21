import * as SecureStore from 'expo-secure-store';
import type { WebDavConfig } from './providers/webdav';

// Credentials (incl. the app password) live ONLY here — never in the synced
// sync_state table, never logged. One JSON blob under a single key.
const KEY = 'cicada_webdav_credentials';

export async function loadCredentials(): Promise<WebDavConfig | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  return raw ? (JSON.parse(raw) as WebDavConfig) : null;
}

export async function saveCredentials(config: WebDavConfig): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(config));
}

export async function clearCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
