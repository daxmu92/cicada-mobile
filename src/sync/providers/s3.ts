import { signRequestV4 } from './sigv4';
import {
  ConflictError,
  AuthError,
  type HttpClient,
  type SyncRemote,
  type WritePrecondition,
} from './types';

export type S3Config = {
  endpoint: string;        // e.g. https://<acct>.r2.cloudflarestorage.com  or  https://s3.<region>.amazonaws.com
  region: string;          // R2: "auto"
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  objectKey?: string;      // default "cicada/cicada-sync.json"
};

const DEFAULT_KEY = 'cicada/cicada-sync.json';

function objectUrl(config: S3Config): string {
  const base = config.endpoint.replace(/\/+$/, '');
  const key = (config.objectKey ?? DEFAULT_KEY).replace(/^\/+/, '');
  return `${base}/${config.bucket}/${key}`;
}

// "YYYYMMDDTHHMMSSZ"
function amzNow(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

const ok = (status: number): boolean => status >= 200 && status < 300;

export function createS3Remote(config: S3Config, http: HttpClient): SyncRemote {
  const url = objectUrl(config);

  async function send(method: string, extraHeaders: Record<string, string>, body: string) {
    const signed = signRequestV4({
      method,
      url,
      headers: extraHeaders,
      body,
      region: config.region,
      service: 's3',
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      amzDate: amzNow(),
    });
    return http(url, {
      method,
      headers: { ...extraHeaders, ...signed },
      body: method === 'GET' ? undefined : body,
    });
  }

  return {
    isConnected(): boolean {
      return Boolean(
        config.endpoint && config.bucket && config.accessKeyId && config.secretAccessKey
      );
    },

    async testConnection(): Promise<void> {
      const res = await send('GET', {}, '');
      if (res.status === 401 || res.status === 403) throw new AuthError();
      if (res.status !== 404 && !ok(res.status)) {
        throw new Error(`S3 test connection failed (HTTP ${res.status})`);
      }
    },

    async read(): Promise<{ content: string; etag: string | null } | null> {
      const res = await send('GET', {}, '');
      if (res.status === 404) return null;
      if (res.status === 401 || res.status === 403) throw new AuthError();
      if (!ok(res.status)) throw new Error(`S3 read failed (HTTP ${res.status})`);
      return { content: await res.text(), etag: res.headers.get('ETag') };
    },

    async write(content: string, pre: WritePrecondition): Promise<{ etag: string | null }> {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (pre.kind === 'ifMatch') headers['If-Match'] = pre.etag;
      else if (pre.kind === 'ifNoneMatch') headers['If-None-Match'] = '*';

      const res = await send('PUT', headers, content);
      if (res.status === 412) throw new ConflictError();
      if (res.status === 401 || res.status === 403) throw new AuthError();
      if (!ok(res.status)) throw new Error(`S3 write failed (HTTP ${res.status})`);
      return { etag: res.headers.get('ETag') };
    },
  };
}
