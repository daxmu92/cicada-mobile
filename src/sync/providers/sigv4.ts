import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

const sha256hex = (s: string): string => bytesToHex(sha256(utf8ToBytes(s)));
const hmacBytes = (key: Uint8Array, s: string): Uint8Array => hmac(sha256, key, utf8ToBytes(s));

export type SignInput = {
  method: string;                    // GET | PUT
  url: string;                       // full path-style object URL
  headers: Record<string, string>;  // caller headers (e.g. If-Match); host/x-amz-* are added here
  body: string;                      // "" for GET
  region: string;
  service: string;                   // "s3"
  accessKeyId: string;
  secretAccessKey: string;
  amzDate: string;                   // "YYYYMMDDTHHMMSSZ" (caller supplies → deterministic/testable)
};

// AWS rules: encode each path segment, keep "/". encodeURIComponent leaves
// !*'() — AWS wants those encoded too.
function encodeS3Path(pathname: string): string {
  return pathname
    .split('/')
    .map((seg) =>
      encodeURIComponent(seg).replace(
        /[!*'()]/g,
        (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()
      )
    )
    .join('/');
}

/** Compute the SigV4 headers to MERGE into a request. */
export function signRequestV4(input: SignInput): Record<string, string> {
  const { method, url, headers, body, region, service, accessKeyId, secretAccessKey, amzDate } = input;
  const u = new URL(url);
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256hex(body);

  // Headers to sign: caller headers (lower-cased) + host + x-amz-content-sha256 + x-amz-date.
  const signing: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) signing[k.toLowerCase()] = v;
  signing['host'] = u.host;
  signing['x-amz-content-sha256'] = payloadHash;
  signing['x-amz-date'] = amzDate;

  const names = Object.keys(signing).sort();
  const canonicalHeaders = names.map((n) => `${n}:${signing[n].trim()}\n`).join('');
  const signedHeaders = names.join(';');

  const canonicalRequest = [
    method,
    encodeS3Path(u.pathname),
    '', // no query params
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256hex(canonicalRequest),
  ].join('\n');

  let key = hmacBytes(utf8ToBytes('AWS4' + secretAccessKey), date);
  key = hmacBytes(key, region);
  key = hmacBytes(key, service);
  key = hmacBytes(key, 'aws4_request');
  const signature = bytesToHex(hmacBytes(key, stringToSign));

  return {
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
  };
}
