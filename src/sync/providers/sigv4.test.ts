import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signRequestV4 } from './sigv4';

test('signRequestV4 reproduces the node-crypto reference (PUT with If-Match)', () => {
  const out = signRequestV4({
    method: 'PUT',
    url: 'https://s3.us-east-1.amazonaws.com/my-bucket/cicada/cicada-sync.json',
    headers: { 'If-Match': '"v1"' },
    body: '{"hello":"world"}',
    region: 'us-east-1',
    service: 's3',
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    amzDate: '20250101T000000Z',
  });
  assert.equal(
    out['x-amz-content-sha256'],
    '93a23971a914e5eacbf0a8d25154cda309c3c1c72fbb9914d47c60f3cb681588'
  );
  assert.equal(out['x-amz-date'], '20250101T000000Z');
  assert.equal(
    out.Authorization,
    'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20250101/us-east-1/s3/aws4_request, ' +
      'SignedHeaders=host;if-match;x-amz-content-sha256;x-amz-date, ' +
      'Signature=6f10faf5523787d0d46a108c2e37bae313896ba4a7a249740c117c2561173769'
  );
});

test('signRequestV4 hashes an empty GET body to the well-known empty-SHA256', () => {
  const out = signRequestV4({
    method: 'GET',
    url: 'https://s3.us-east-1.amazonaws.com/my-bucket/cicada/cicada-sync.json',
    headers: {},
    body: '',
    region: 'us-east-1',
    service: 's3',
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
    amzDate: '20250101T000000Z',
  });
  assert.equal(
    out['x-amz-content-sha256'],
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  );
  // GET signs only host;x-amz-content-sha256;x-amz-date
  assert.match(out.Authorization, /SignedHeaders=host;x-amz-content-sha256;x-amz-date,/);
});
