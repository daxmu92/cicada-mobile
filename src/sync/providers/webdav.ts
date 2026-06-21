import type { HttpClient, SyncRemote, WritePrecondition } from './types';
import { ConflictError, AuthError } from './types';

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

// The parent collection URL of the sync file (with a trailing slash), e.g.
// ".../dav/cicada/cicada-sync.json" -> ".../dav/cicada/".
function folderUrl(fileUrl: string): string {
  const i = fileUrl.lastIndexOf('/');
  return fileUrl.slice(0, i + 1);
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
      if (res.status === 401) throw new AuthError();
      if (!ok(res.status) && res.status !== 207) {
        throw new Error(`WebDAV test connection failed (HTTP ${res.status})`);
      }
    },

    async read(): Promise<{ content: string; etag: string | null } | null> {
      const res = await http(fileUrl, { method: 'GET', headers: authHeaders() });
      if (res.status === 404) return null;
      if (res.status === 401) throw new AuthError();
      if (!ok(res.status)) {
        throw new Error(`WebDAV read failed (HTTP ${res.status})`);
      }
      return { content: await res.text(), etag: res.headers.get('ETag') };
    },

    async write(content: string, pre: WritePrecondition): Promise<{ etag: string | null }> {
      if (pre.kind === 'ifNoneMatch') {
        // Create-only: make sure the parent folder exists first. MKCOL is
        // idempotent for us — 201 (created) and 405 (already exists) both pass;
        // other failures surface on the PUT below.
        await http(folderUrl(fileUrl), { method: 'MKCOL', headers: authHeaders() });
      }

      const headers: Record<string, string> = {
        ...authHeaders(),
        'Content-Type': 'application/json',
      };
      if (pre.kind === 'ifMatch') headers['If-Match'] = pre.etag;
      else if (pre.kind === 'ifNoneMatch') headers['If-None-Match'] = '*';

      const res = await http(fileUrl, { method: 'PUT', headers, body: content });
      if (res.status === 412) {
        throw new ConflictError();
      }
      if (res.status === 401) throw new AuthError();
      if (!ok(res.status)) {
        throw new Error(`WebDAV write failed (HTTP ${res.status})`);
      }
      return { etag: res.headers.get('ETag') };
    },
  };
}
