import type { HttpClient } from './providers/types';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

// Web build: only the Tauri desktop webview can reach a WebDAV server. A plain
// browser / PWA is blocked by CORS (sync is hidden there via isSyncAvailable()).
// Tauri's plugin-http fetch runs in the Rust process and bypasses webview CORS.
// Lazy-imported so a plain browser bundle never loads the plugin.
export const httpClient: HttpClient = async (url, init) => {
  if (!isTauri()) {
    throw new Error('cloud sync is unavailable in a plain browser — use the desktop or mobile app');
  }
  const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try { const response = await tauriFetch(url, { ...init, signal: controller.signal });
    const content = await response.text();
    if (content.length > 20_000_000) throw new Error('WebDAV document exceeds the size limit');
    return { status: response.status, headers: response.headers, text: async () => content }; }
  catch (error) { if (controller.signal.aborted) throw new TypeError('WebDAV request timed out'); throw error; }
  finally { clearTimeout(timer); }
};
