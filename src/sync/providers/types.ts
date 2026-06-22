// Transport-agnostic sync remote. The WebDAV implementation is in webdav.ts;
// an S3/R2 implementation could be added later behind the same interface.

export type WritePrecondition =
  | { kind: 'ifMatch'; etag: string }   // update: server should 412 if remote changed
  | { kind: 'ifNoneMatch' }             // create-only: server should 412 if file exists
  | { kind: 'none' };                   // unconditional overwrite (orchestrator fallback)

export class ConflictError extends Error {
  constructor(message = 'remote precondition failed (HTTP 412)') {
    super(message);
    this.name = 'ConflictError';
  }
}

export class AuthError extends Error {
  constructor(message = 'WebDAV authentication failed (HTTP 401) — check the account and app password') {
    super(message);
    this.name = 'AuthError';
  }
}

// The minimal HTTP response shape the provider needs. Both the global `fetch`
// Response and @tauri-apps/plugin-http's Response satisfy it.
export type HttpResponse = {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
};

export type HttpClient = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string }
) => Promise<HttpResponse>;

export interface SyncRemote {
  isConnected(): boolean;
  testConnection(): Promise<void>;                                   // throws on auth/network failure
  read(opts?: { ifNoneMatch?: string }):
    Promise<{ content: string; etag: string | null } | 'not-modified' | null>; // null = absent (404); 'not-modified' = 304
  write(content: string, pre: WritePrecondition): Promise<{ etag: string | null }>; // throws ConflictError on 412
}
