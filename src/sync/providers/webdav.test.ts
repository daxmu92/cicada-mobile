import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWebDavRemote } from './webdav';
import type { HttpClient, HttpResponse } from './types';
import { ConflictError, AuthError } from './types';

type Recorded = { url: string; method: string; headers: Record<string, string>; body?: string };

// A mock HttpClient that records requests and returns scripted responses.
function makeMock(
  responder: (r: Recorded) => { status: number; headers?: Record<string, string>; body?: string }
): { client: HttpClient; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const client: HttpClient = async (url, init) => {
    const rec: Recorded = { url, method: init.method, headers: init.headers, body: init.body };
    calls.push(rec);
    const res = responder(rec);
    const h = res.headers ?? {};
    const lower: Record<string, string> = {};
    for (const k of Object.keys(h)) lower[k.toLowerCase()] = h[k];
    const response: HttpResponse = {
      status: res.status,
      headers: { get: (n: string) => lower[n.toLowerCase()] ?? null },
      text: async () => res.body ?? '',
    };
    return response;
  };
  return { client, calls };
}

const config = {
  baseUrl: 'https://dav.jianguoyun.com/dav/',
  username: 'me@example.com',
  appPassword: 'secret',
};

test('read() GETs the default file path with a Basic auth header', async () => {
  const { client, calls } = makeMock(() => ({ status: 200, headers: { ETag: '"v1"' }, body: '{"k":1}' }));
  const remote = createWebDavRemote(config, client);
  const result = await remote.read();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].url, 'https://dav.jianguoyun.com/dav/cicada/cicada-sync.json');
  // Basic auth = base64("me@example.com:secret"); verify against an independent oracle.
  const expectedAuth = 'Basic ' + Buffer.from('me@example.com:secret').toString('base64');
  assert.equal(calls[0].headers['Authorization'], expectedAuth);
  assert.deepEqual(result, { content: '{"k":1}', etag: '"v1"' });
});

test('read() returns null on 404', async () => {
  const { client } = makeMock(() => ({ status: 404 }));
  const remote = createWebDavRemote(config, client);
  assert.equal(await remote.read(), null);
});

test('read() returns etag:null when the server sends no ETag', async () => {
  const { client } = makeMock(() => ({ status: 200, body: '{}' }));
  const remote = createWebDavRemote(config, client);
  assert.deepEqual(await remote.read(), { content: '{}', etag: null });
});

test('read() throws on an unexpected status (500)', async () => {
  const { client } = makeMock(() => ({ status: 500 }));
  const remote = createWebDavRemote(config, client);
  await assert.rejects(() => remote.read(), /500/);
});

test('testConnection() sends PROPFIND Depth:0 to the base URL', async () => {
  const { client, calls } = makeMock(() => ({ status: 207 }));
  const remote = createWebDavRemote(config, client);
  await remote.testConnection();
  assert.equal(calls[0].method, 'PROPFIND');
  assert.equal(calls[0].url, 'https://dav.jianguoyun.com/dav/');
  assert.equal(calls[0].headers['Depth'], '0');
});

test('testConnection() throws a clear error on 401', async () => {
  const { client } = makeMock(() => ({ status: 401 }));
  const remote = createWebDavRemote(config, client);
  await assert.rejects(() => remote.testConnection(), /authentication|401/i);
});

test('isConnected() reflects whether credentials are present', () => {
  assert.equal(createWebDavRemote(config, makeMock(() => ({ status: 200 })).client).isConnected(), true);
  const bare = { baseUrl: '', username: '', appPassword: '' };
  assert.equal(createWebDavRemote(bare, makeMock(() => ({ status: 200 })).client).isConnected(), false);
});

test('a custom filePath overrides the default', async () => {
  const { client, calls } = makeMock(() => ({ status: 404 }));
  const remote = createWebDavRemote({ ...config, filePath: 'foo/bar.json' }, client);
  await remote.read();
  assert.equal(calls[0].url, 'https://dav.jianguoyun.com/dav/foo/bar.json');
});

test('write(none) PUTs the file with no precondition header', async () => {
  const { client, calls } = makeMock(() => ({ status: 200, headers: { ETag: '"v2"' } }));
  const remote = createWebDavRemote(config, client);
  const res = await remote.write('{"k":2}', { kind: 'none' });

  const put = calls.find((c) => c.method === 'PUT')!;
  assert.equal(put.url, 'https://dav.jianguoyun.com/dav/cicada/cicada-sync.json');
  assert.equal(put.body, '{"k":2}');
  assert.equal(put.headers['Content-Type'], 'application/json');
  assert.equal(put.headers['If-Match'], undefined);
  assert.equal(put.headers['If-None-Match'], undefined);
  assert.deepEqual(res, { etag: '"v2"' });
});

test('write(ifMatch) sends If-Match with the etag', async () => {
  const { client, calls } = makeMock(() => ({ status: 204, headers: { ETag: '"v3"' } }));
  const remote = createWebDavRemote(config, client);
  const res = await remote.write('{}', { kind: 'ifMatch', etag: '"v2"' });
  const put = calls.find((c) => c.method === 'PUT')!;
  assert.equal(put.headers['If-Match'], '"v2"');
  assert.deepEqual(res, { etag: '"v3"' });
});

test('write(ifNoneMatch) MKCOLs the folder first, then PUTs with If-None-Match: *', async () => {
  const { client, calls } = makeMock((r) => {
    if (r.method === 'MKCOL') return { status: 201 };
    return { status: 201, headers: { ETag: '"v1"' } };
  });
  const remote = createWebDavRemote(config, client);
  const res = await remote.write('{}', { kind: 'ifNoneMatch' });

  assert.equal(calls[0].method, 'MKCOL');
  assert.equal(calls[0].url, 'https://dav.jianguoyun.com/dav/cicada/'); // parent folder of the file
  const put = calls.find((c) => c.method === 'PUT')!;
  assert.equal(put.headers['If-None-Match'], '*');
  assert.deepEqual(res, { etag: '"v1"' });
});

test('write(ifNoneMatch) tolerates MKCOL 405 (folder already exists)', async () => {
  const { client } = makeMock((r) => {
    if (r.method === 'MKCOL') return { status: 405 };
    return { status: 201, headers: { ETag: '"v1"' } };
  });
  const remote = createWebDavRemote(config, client);
  const res = await remote.write('{}', { kind: 'ifNoneMatch' });
  assert.deepEqual(res, { etag: '"v1"' });
});

test('write throws ConflictError on HTTP 412', async () => {
  const { client } = makeMock(() => ({ status: 412 }));
  const remote = createWebDavRemote(config, client);
  await assert.rejects(() => remote.write('{}', { kind: 'ifMatch', etag: '"old"' }), ConflictError);
});

test('write returns etag:null when the PUT response has no ETag', async () => {
  const { client } = makeMock(() => ({ status: 200 }));
  const remote = createWebDavRemote(config, client);
  assert.deepEqual(await remote.write('{}', { kind: 'none' }), { etag: null });
});

test('write throws on 401', async () => {
  const { client } = makeMock(() => ({ status: 401 }));
  const remote = createWebDavRemote(config, client);
  await assert.rejects(() => remote.write('{}', { kind: 'none' }), /401|authentication/i);
});

test('read() with ifNoneMatch sends If-None-Match and maps 304 to not-modified', async () => {
  let seenHeaders: Record<string, string> = {};
  const http: HttpClient = async (_url, init) => {
    seenHeaders = init.headers;
    return { status: 304, headers: { get: () => null }, text: async () => '' };
  };
  const remote = createWebDavRemote({ baseUrl: 'https://x/dav/', username: 'u', appPassword: 'p' }, http);
  const r = await remote.read({ ifNoneMatch: 'etag-123' });
  assert.equal(r, 'not-modified');
  assert.equal(seenHeaders['If-None-Match'], 'etag-123');
});

test('read() maps 200 to data and 404 to null', async () => {
  const make = (status: number, body: string, etag: string | null): HttpClient => async () => ({
    status, headers: { get: (n: string) => (n === 'ETag' ? etag : null) }, text: async () => body,
  });
  const cfg = { baseUrl: 'https://x/dav/', username: 'u', appPassword: 'p' };
  const got = await createWebDavRemote(cfg, make(200, '{"a":1}', 'e9'))!.read();
  assert.deepEqual(got, { content: '{"a":1}', etag: 'e9' });
  const absent = await createWebDavRemote(cfg, make(404, '', null)).read();
  assert.equal(absent, null);
});

test('read throws AuthError on 401', async () => {
  const { client } = makeMock(() => ({ status: 401 }));
  const remote = createWebDavRemote(config, client);
  await assert.rejects(() => remote.read(), (e) => e instanceof AuthError);
});

test('write throws AuthError on 401', async () => {
  const { client } = makeMock(() => ({ status: 401 }));
  const remote = createWebDavRemote(config, client);
  await assert.rejects(
    () => remote.write('{}', { kind: 'none' }),
    (e) => e instanceof AuthError
  );
});
