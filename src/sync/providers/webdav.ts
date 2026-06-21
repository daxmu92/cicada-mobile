import type { HttpClient, SyncRemote, WritePrecondition } from './types';
import { ConflictError } from './types';

export type WebDavConfig = {
  baseUrl: string;        // e.g. https://dav.jianguoyun.com/dav/
  username: string;
  appPassword: string;
  filePath?: string;      // default: cicada/cicada-sync.json
};

const DEFAULT_FILE_PATH = 'cicada/cicada-sync.json';

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

// Credentials are expected to be ASCII (email + app password); btoa is present
// on every target (Node 20, RN Hermes, browser, Tauri webview).
function basicAuth(username: string, appPassword: string): string {
  return 'Basic ' + btoa(`${username}:${appPassword}`);
}

function ok(status: number): boolean {
  return status >= 200 && status < 300;
}

export function createWebDavRemote(config: WebDavConfig, http: HttpClient): SyncRemote {
  const filePath = config.filePath ?? DEFAULT_FILE_PATH;
  const fileUrl = joinUrl(config.baseUrl, filePath);
  const authHeaders = (): Record<string, string> => ({
    Authorization: basicAuth(config.username, config.appPassword),
  });

  return {
    isConnected(): boolean {
      return Boolean(config.baseUrl && config.username && config.appPassword);
    },

    async testConnection(): Promise<void> {
      const res = await http(config.baseUrl, {
        method: 'PROPFIND',
        headers: { ...authHeaders(), Depth: '0' },
      });
      if (res.status === 401) {
        throw new Error('WebDAV authentication failed (401) — check the account and app password');
      }
      if (!ok(res.status) && res.status !== 207) {
        throw new Error(`WebDAV test connection failed (HTTP ${res.status})`);
      }
    },

    async read(): Promise<{ content: string; etag: string | null } | null> {
      const res = await http(fileUrl, { method: 'GET', headers: authHeaders() });
      if (res.status === 404) return null;
      if (!ok(res.status)) {
        throw new Error(`WebDAV read failed (HTTP ${res.status})`);
      }
      return { content: await res.text(), etag: res.headers.get('ETag') };
    },

    async write(_content: string, _pre: WritePrecondition): Promise<{ etag: string | null }> {
      // Implemented in Task 2.
      throw new ConflictError('write() not implemented yet');
    },
  };
}
