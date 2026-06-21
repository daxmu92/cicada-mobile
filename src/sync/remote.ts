import { httpClient } from './http';
import { createWebDavRemote, type WebDavConfig } from './providers/webdav';
import type { SyncRemote } from './providers/types';
import { loadCredentials } from './credentials';

// Build a remote from an explicit config (used by the Settings "Test connection"
// / Connect flow in Phase 4, before credentials are persisted).
export function createConfiguredRemote(config: WebDavConfig): SyncRemote {
  return createWebDavRemote(config, httpClient);
}

// Build a remote from stored credentials, or null if the user hasn't connected.
export async function loadRemote(): Promise<SyncRemote | null> {
  const config = await loadCredentials();
  if (!config) return null;
  return createConfiguredRemote(config);
}
