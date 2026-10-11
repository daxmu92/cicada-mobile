import type { HttpClient } from './providers/types';
export const httpClient: HttpClient = async (url, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try { const response = await fetch(url, { ...init, signal: controller.signal });
    const content = await response.text();
    if (content.length > 20_000_000) throw new Error('WebDAV document exceeds the size limit');
    return { status: response.status, headers: response.headers, text: async () => content }; }
  catch (error) { if (controller.signal.aborted) throw new TypeError('WebDAV request timed out'); throw error; }
  finally { clearTimeout(timer); }
};
