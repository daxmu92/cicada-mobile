// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// expo-sqlite ships a WebAssembly SQLite build (wa-sqlite) for the web target.
// Metro doesn't treat `.wasm` as a bundleable asset by default, so register it.
config.resolver.assetExts.push('wasm');

// wa-sqlite persists via OPFS and relies on SharedArrayBuffer, which browsers
// only expose to cross-origin-isolated pages. Set the required headers on the
// dev server. (For a production/static or desktop host, the same COOP/COEP
// headers must be applied by whatever serves the files.)
config.server.enhanceMiddleware = (middleware) => {
  return (req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    return middleware(req, res, next);
  };
};

module.exports = config;
