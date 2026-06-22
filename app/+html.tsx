import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

// Registers the PWA service worker on web; unregisters any leftover SW on Tauri
// desktop (where assets are embedded in the exe — a SW only serves a stale bundle
// after a rebuild). Injected as a raw <script> because this document is rendered
// to static HTML at build time.
const swRegister = `
if ('serviceWorker' in navigator) {
  if (typeof window !== 'undefined' && window.__TAURI_INTERNALS__) {
    // Desktop (Tauri): assets are embedded in the app; a service worker only
    // serves a STALE bundle after a rebuild. Unregister any leftover SW so
    // existing desktop installs self-heal on next launch.
    navigator.serviceWorker.getRegistrations().then(function (rs) {
      rs.forEach(function (r) { r.unregister(); });
    }).catch(function () {});
  } else {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function (err) {
        console.warn('SW registration failed', err);
      });
    });
  }
}`;

/**
 * Custom HTML document wrapping every web route (Expo Router static rendering).
 * Adds the PWA manifest, theme color, icons, and service-worker registration on
 * top of Expo's required defaults (charset / viewport / scroll reset).
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/* Desktop (WebView2) cache-bust: Tauri's schema rejects Cache-Control
            under app.security.headers, so set no-store here so a rebuilt bundle
            always loads fresh instead of a cached one. */}
        <meta httpEquiv="Cache-Control" content="no-store, max-age=0" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />

        <title>CicadaFinScape</title>
        <meta
          name="description"
          content="Local-first personal finance tracker — net worth, assets, and transactions, all on your device."
        />

        <link rel="manifest" href="/manifest.webmanifest" />
        <meta name="theme-color" content="#0a7ea4" />
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="Cicada" />

        {/* Preserve Expo's default full-height, no-scroll root layout. */}
        <style
          id="expo-reset"
          dangerouslySetInnerHTML={{
            __html: '#root,body,html{height:100%}body{overflow:hidden}#root{display:flex}',
          }}
        />
        <ScrollViewStyleReset />

        <script dangerouslySetInnerHTML={{ __html: swRegister }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
