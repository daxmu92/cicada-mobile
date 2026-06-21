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
  read(): Promise<{ content: string; etag: string | null } | null>; // null if the file is absent (404)
  write(content: string, pre: WritePrecondition): Promise<{ etag: string | null }>; // throws ConflictError on 412
}
