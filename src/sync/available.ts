import { Platform } from 'react-native';

// Cloud sync targets native (iOS/Android) and Tauri desktop. A plain browser /
// PWA cannot reach a WebDAV server (CORS), so sync is hidden there and the app
// stays local-only. Tauri is detected the same way database.web.ts does it.
export function isSyncAvailable(): boolean {
  if (Platform.OS !== 'web') return true;
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
