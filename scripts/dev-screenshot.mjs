// Dev-only UI screenshot helper (not used by the app at runtime).
//
// Drives the running web build in a headless Chromium to capture screenshots
// for visual verification. Uses `playwright-core` (a devDependency) plus a
// Chromium that already lives in the Playwright cache — it does NOT download a
// browser. If none is found, install one once:
//
//     npx playwright install chromium
//
// Usage (with `npm run web` running on http://localhost:8081):
//
//     node scripts/dev-screenshot.mjs <route> <out.png> [--seed]
//     node scripts/dev-screenshot.mjs / home.png --seed       # load sample data first
//     node scripts/dev-screenshot.mjs /transactions tx.png
//
// Programmatic use (for ad-hoc multi-step flows):
//
//     import { launch, loadSampleData } from './scripts/dev-screenshot.mjs';
//     const { browser, page } = await launch();
//     await loadSampleData(page);
//     ... await page.screenshot({ path: 'x.png' }); await browser.close();

import { chromium } from 'playwright-core';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.CICADA_WEB_URL ?? 'http://localhost:8081';

/** Find a Chromium executable from the Playwright cache (or PLAYWRIGHT_CHROMIUM). */
export function findChromium() {
  const override = process.env.PLAYWRIGHT_CHROMIUM;
  if (override && existsSync(override)) return override;
  const base = join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(base)) return null;
  const candidates = [];
  for (const dir of readdirSync(base).sort().reverse()) {
    if (dir.startsWith('chromium_headless_shell-'))
      candidates.push(join(base, dir, 'chrome-headless-shell-linux64', 'chrome-headless-shell'));
    if (dir.startsWith('chromium-')) candidates.push(join(base, dir, 'chrome-linux', 'chrome'));
  }
  return candidates.find(existsSync) ?? null;
}

/** Launch a phone-sized headless page pointed at the dev server. */
export async function launch({ width = 420, height = 900, scale = 2 } = {}) {
  const executablePath = findChromium();
  if (!executablePath) {
    throw new Error(
      'No Chromium found. Run `npx playwright install chromium` (or set PLAYWRIGHT_CHROMIUM).'
    );
  }
  const browser = await chromium.launch({ executablePath, args: ['--no-sandbox', '--disable-gpu'] });
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    locale: 'en-US',
  });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept()); // auto-accept confirm/alert
  return { browser, ctx, page };
}

/** Reset the DB and load the bundled sample data via Settings → Load Sample Data. */
export async function loadSampleData(page) {
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
  await page.getByText('Load Sample Data', { exact: true }).waitFor({ timeout: 30000 });
  await page.getByText('Load Sample Data', { exact: true }).click({ force: true });
  await page.waitForTimeout(4000); // confirm dialog + seed
}

async function main() {
  const [route = '/', out = 'screenshot.png', ...flags] = process.argv.slice(2);
  const { browser, page } = await launch();
  try {
    if (flags.includes('--seed')) await loadSampleData(page);
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000); // let charts settle
    await page.screenshot({ path: out });
    console.log(`Saved ${out} (${BASE}${route})`);
  } finally {
    await browser.close();
  }
}

// Run as CLI only when invoked directly (not when imported).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
