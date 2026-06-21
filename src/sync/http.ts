import type { HttpClient } from './providers/types';

// Native (iOS / Android): the global fetch. React Native's networking passes
// arbitrary methods (PUT / PROPFIND / MKCOL) through to NSURLSession / OkHttp,
// and there is no browser CORS layer. A fetch Response satisfies HttpResponse
// (status / headers.get / text) structurally.
export const httpClient: HttpClient = (url, init) => fetch(url, init);
