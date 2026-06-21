import * as SecureStore from 'expo-secure-store';
import { normalizeStoredConfig, type StoredRemoteConfig } from './remote-config';

const KEY = 'cicada_webdav_credentials';

export async function loadCredentials(): Promise<StoredRemoteConfig | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  try {
    return normalizeStoredConfig(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function saveCredentials(config: StoredRemoteConfig): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(config));
}

export async function clearCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
