import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createS3Remote } from './s3';
import type { HttpClient, HttpResponse } from './types';
import { ConflictError, AuthError } from './types';

type Recorded = { url: string; method: string; headers: Record<string, string>; body?: string };

function makeMock(
  responder: (r: Recorded) => { status: number; headers?: Record<string, string>; body?: string }
): { client: HttpClient; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const client: HttpClient = async (url, init) => {
    const rec: Recorded = { url, method: init.method, headers: init.headers, body: init.body };
    calls.push(rec);
    const res = responder(rec);
    const lower: Record<string, string> = {};
    for (const k of Object.keys(res.headers ?? {})) lower[k.toLowerCase()] = (res.headers as any)[k];
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
  endpoint: 'https://s3.us-east-1.amazonaws.com',
  region: 'us-east-1',
  bucket: 'my-bucket',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
};

test('read() GETs the path-style object URL with a signed Authorization header', async () => {
  const { client, calls } = makeMock(() => ({ status: 200, headers: { ETag: '"v1"' }, body: '{"k":1}' }));
  const result = await createS3Remote(config, client).read();
  assert.deepEqual(result, { content: '{"k":1}', etag: '"v1"' });
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].url, 'https://s3.us-east-1.amazonaws.com/my-bucket/cicada/cicada-sync.json');
  assert.match(calls[0].headers.Authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//);
  assert.ok(calls[0].headers['x-amz-date']);
});

test('read() returns null on 404', async () => {
  const { client } = makeMock(() => ({ status: 404 }));
  assert.equal(await createS3Remote(config, client).read(), null);
});

test('read() throws AuthError on 403', async () => {
  const { client } = makeMock(() => ({ status: 403 }));
  await assert.rejects(() => createS3Remote(config, client).read(), (e) => e instanceof AuthError);
});

test('write(ifMatch) PUTs with If-Match and returns the new etag', async () => {
  const { client, calls } = makeMock(() => ({ status: 200, headers: { ETag: '"v2"' } }));
  const out = await createS3Remote(config, client).write('{"k":2}', { kind: 'ifMatch', etag: '"v1"' });
  assert.deepEqual(out, { etag: '"v2"' });
  assert.equal(calls[0].method, 'PUT');
  assert.equal(calls[0].body, '{"k":2}');
  assert.equal(calls[0].headers['If-Match'], '"v1"');
});

test('write(ifNoneMatch) sends If-None-Match: *', async () => {
  const { client, calls } = makeMock(() => ({ status: 200 }));
  await createS3Remote(config, client).write('{}', { kind: 'ifNoneMatch' });
  assert.equal(calls[0].headers['If-None-Match'], '*');
});

test('write throws ConflictError on 412', async () => {
  const { client } = makeMock(() => ({ status: 412 }));
  await assert.rejects(
    () => createS3Remote(config, client).write('{}', { kind: 'ifMatch', etag: '"stale"' }),
    (e) => e instanceof ConflictError
  );
});

test('testConnection treats 404 as success (connected, not seeded)', async () => {
  const { client } = makeMock(() => ({ status: 404 }));
  await createS3Remote(config, client).testConnection(); // resolves
});

test('testConnection throws AuthError on 403', async () => {
  const { client } = makeMock(() => ({ status: 403 }));
  await assert.rejects(() => createS3Remote(config, client).testConnection(), (e) => e instanceof AuthError);
});
