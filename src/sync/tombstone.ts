import type { CicadaDB } from '../db/migrations';

export type Entity = 'account' | 'asset' | 'snapshot' | 'tran' | 'setting';

/**
 * Record tombstones at a caller-supplied HLC stamp. All uuids share `deletedAt`
 * (one logical deletion). For snapshots the `uuid` is the composite key
 * "<assetUuid>|<date>".
 *
 * This module is deliberately clock-free (no import of ./clock, and therefore
 * no transitive pull of the DB/react-native graph) so it can be unit-tested
 * under node and imported by erase.ts without forcing a dynamic import.
 */
export async function recordTombstonesAt(
  db: CicadaDB,
  entity: Entity,
  uuids: string[],
  deletedAt: string
): Promise<void> {
  for (const uuid of uuids) {
    await db.runAsync(
      `INSERT INTO tombstone (entity, uuid, deleted_at) VALUES (?, ?, ?)
         ON CONFLICT(entity, uuid) DO UPDATE SET deleted_at = MAX(deleted_at, excluded.deleted_at)`,
      [entity, uuid, deletedAt]
    );
  }
}
