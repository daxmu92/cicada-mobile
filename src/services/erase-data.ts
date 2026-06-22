import { getDatabase } from '../db/database';
import { eraseAllData } from '../sync/erase';
import { tick } from '../sync/clock';
import { syncScheduler } from '../sync/scheduler';
import { setSetting } from '../db/setting-repo';

// Defaults mirror SettingsContext. Language is intentionally NOT reset — it is a
// per-device UX preference, and resetting it would propagate one device's locale
// to the others.
const SETTING_DEFAULTS: Record<string, string> = {
  currency: '$',
  forwardFill: 'false',
  gainColor: 'green',
};

/**
 * Erase all financial data and propagate the deletion. Pre-sync folds the
 * cloud's latest stamps into the local clock so the tombstones we mint
 * out-stamp the cloud; post-sync pushes them. Both syncs are best-effort:
 * offline, the tombstones are recorded locally and pushed on the next sync.
 */
export async function eraseAllDataAndSync(opts: { resetSettings: boolean }): Promise<void> {
  await syncScheduler.requestSync('manual').catch(() => {}); // best-effort pre-sync (advance clock)
  const db = await getDatabase();
  await eraseAllData(db, { tick });
  if (opts.resetSettings) {
    for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
      await setSetting(key, value);           // fresh-stamped LWW writes propagate
    }
  }
  syncScheduler.markDirty();
  await syncScheduler.requestSync('manual').catch(() => {}); // push tombstones
}
