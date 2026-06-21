import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStoredConfig, buildRemote } from './remote-config';
import type { HttpClient, HttpResponse } from './providers/types';

function mock(): { client: HttpClient; calls: { url: string; method: string }[] } {
  const calls: { url: string; method: string }[] = [];
  const client: HttpClient = async (url, init) => {
    calls.push({ url, method: init.method });
    const r: HttpResponse = { status: 404, headers: { get: () => null }, text: async () => '' };
    return r;
  };
  return { client, calls };
}

test('normalize: s3-tagged config passes through', () => {
  const c = { provider: 's3', endpoint: 'https://e', region: 'auto', bucket: 'b', accessKeyId: 'k', secretAccessKey: 's' };
  assert.deepEqual(normalizeStoredConfig(c), c);
});

test('normalize: webdav-tagged config passes through', () => {
  const c = { provider: 'webdav', baseUrl: 'https://d/', username: 'u', appPassword: 'p' };
  assert.deepEqual(normalizeStoredConfig(c), c);
});

test('normalize: legacy config (no provider, has baseUrl) becomes webdav', () => {
  const legacy = { baseUrl: 'https://d/', username: 'u', appPassword: 'p' };
  assert.deepEqual(normalizeStoredConfig(legacy), { provider: 'webdav', ...legacy });
});

test('normalize: null / garbage -> null', () => {
  assert.equal(normalizeStoredConfig(null), null);
  assert.equal(normalizeStoredConfig({ junk: 1 }), null);
});

test('buildRemote dispatches s3 config to the S3 provider (path-style URL)', async () => {
  const { client, calls } = mock();
  const remote = buildRemote(
    { provider: 's3', endpoint: 'https://s3.us-east-1.amazonaws.com', region: 'us-east-1', bucket: 'b', accessKeyId: 'k', secretAccessKey: 's' },
    client
  );
  await remote.read();
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].url, 'https://s3.us-east-1.amazonaws.com/b/cicada/cicada-sync.json');
});

test('buildRemote dispatches webdav config to the WebDAV provider', async () => {
  const { client, calls } = mock();
  const remote = buildRemote(
    { provider: 'webdav', baseUrl: 'https://dav.example.com/', username: 'u', appPassword: 'p' },
    client
  );
  await remote.read();
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].url, 'https://dav.example.com/cicada/cicada-sync.json');
});
