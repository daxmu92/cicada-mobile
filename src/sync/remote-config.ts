import { createWebDavRemote, type WebDavConfig } from './providers/webdav';
import { createS3Remote, type S3Config } from './providers/s3';
import type { SyncRemote, HttpClient } from './providers/types';

export type StoredRemoteConfig =
  | ({ provider: 'webdav' } & WebDavConfig)
  | ({ provider: 's3' } & S3Config);

/** Parse a stored credential blob. Back-compat: a value with no `provider`
 *  field but a `baseUrl` is a legacy (pre-S3) WebDAV config. */
export function normalizeStoredConfig(raw: unknown): StoredRemoteConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.provider === 's3' || o.provider === 'webdav') return o as StoredRemoteConfig;
  if (typeof o.baseUrl === 'string') {
    return { provider: 'webdav', ...(o as unknown as WebDavConfig) };
  }
  return null;
}

/** Build a SyncRemote from a tagged config + an injected HttpClient. */
export function buildRemote(config: StoredRemoteConfig, http: HttpClient): SyncRemote {
  return config.provider === 's3'
    ? createS3Remote(config, http)
    : createWebDavRemote(config, http);
}
