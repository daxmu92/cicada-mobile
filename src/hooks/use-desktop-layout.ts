import { Platform, useWindowDimensions } from 'react-native';

/** Desktop chrome belongs to the web runtime; native touch layouts stay separate. */
export function useDesktopLayout() {
  const { width } = useWindowDimensions();
  const desktop = Platform.OS === 'web' && (width >= 900 || (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window));
  const compact = width < 1100;
  const sidebarWidth = compact ? 76 : 212;
  const contentWidth = width - (desktop ? sidebarWidth : 0);
  return { desktop, compact, sidebarWidth, contentWidth, split: desktop && contentWidth >= 1000 };
}
