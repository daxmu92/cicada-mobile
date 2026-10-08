import { getDatabase } from '../db/database';
import { eraseAllData } from '../sync/erase';
import { tick } from '../sync/clock';
import { syncScheduler } from '../sync/scheduler';
import { notifyDataChanged } from '../db/changes';

// Defaults mirror SettingsContext. Language is intentionally NOT reset — it is a
// per-device UX preference, and resetting it would propagate one device's locale
// to the others.
const SETTING_DEFAULTS: Record<string, string> = {
  currency: '$',
  forwardFill: 'false',
  gainColor: 'green',
  theme: 'warmSlate',
};

/**
 * Erase all financial data and propagate the deletion. Pre-sync folds the
 * cloud's latest stamps into the local clock so the tombstones we mint
 * out-stamp the cloud; post-sync pushes them. Both syncs are best-effort:
 * offline, the tombstones are recorded locally and pushed on the next sync.
 */
export async function eraseAllDataAndSync(opts: { resetSettings: boolean }): Promise<void> {
  await syncScheduler.runExclusive(async (sync) => {
    await sync().catch(() => {});
    const db = await getDatabase();
    const deletedAt = await tick();
    const updatedAt = await tick();
    await db.withTransactionAsync(async (tx) => {
      await eraseAllData(tx, { tick: async () => deletedAt });
      await tx.runAsync('DELETE FROM local_backup'); // Explicit erase also erases local recovery data.
      if (opts.resetSettings) {
        for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
          await tx.runAsync(`INSERT INTO setting(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`, [key, value, updatedAt]);
        }
      }
    });
    notifyDataChanged();
    syncScheduler.markDirty();
    await sync().catch(() => {});
  });
}
