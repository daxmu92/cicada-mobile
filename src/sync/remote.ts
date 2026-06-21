import { httpClient } from './http';
import { buildRemote, type StoredRemoteConfig } from './remote-config';
import type { SyncRemote } from './providers/types';
import { loadCredentials } from './credentials';

export function createConfiguredRemote(config: StoredRemoteConfig): SyncRemote {
  return buildRemote(config, httpClient);
}

export async function loadRemote(): Promise<SyncRemote | null> {
  const config = await loadCredentials();
  if (!config) return null;
  return createConfiguredRemote(config);
}
