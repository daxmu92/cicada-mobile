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
  return tauriFetch(url, init);
};
