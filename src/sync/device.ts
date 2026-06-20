import { getSyncState } from './sync-state-repo';

// The device id is seeded by the v2 migration (migrations.ts ensureDeviceId).
// It is the HLC tie-break and must be stable for the life of the install.
export async function getDeviceId(): Promise<string> {
  const id = await getSyncState('deviceId');
  if (!id) {
    throw new Error('deviceId missing — v2 migration did not seed sync_state');
  }
  return id;
}
