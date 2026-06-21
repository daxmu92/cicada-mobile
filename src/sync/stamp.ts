import type { CicadaDB } from '../db/migrations';
import { tick } from './clock';

export type Entity = 'account' | 'asset' | 'snapshot' | 'tran' | 'setting';

/** 16 random bytes -> 32 lowercase hex chars. Core SQLite, all backends. */
export async function genUuid(db: CicadaDB): Promise<string> {
  const row = await db.getFirstAsync<{ id: string }>(
    `SELECT lower(hex(randomblob(16))) AS id`
  );
  return row!.id;
}

/** Stamp a create/update: one fresh HLC, plus a uuid on insert. */
export async function stampWrite(
  db: CicadaDB,
  opts: { withUuid: boolean }
): Promise<{ uuid: string | null; updatedAt: string }> {
  const updatedAt = await tick();
  const uuid = opts.withUuid ? await genUuid(db) : null;
  return { uuid, updatedAt };
}

/**
 * Record tombstones for a delete (the row + any cascaded descendants the
 * caller enumerated). All share one HLC — they are one logical deletion.
 * For snapshots the `uuid` is the composite key "<assetUuid>|<date>".
 */
export async function recordTombstones(
  db: CicadaDB,
  entity: Entity,
  uuids: string[]
): Promise<void> {
  if (uuids.length === 0) return;
  const deletedAt = await tick();
  for (const uuid of uuids) {
    await db.runAsync(
      `INSERT INTO tombstone (entity, uuid, deleted_at) VALUES (?, ?, ?)
         ON CONFLICT(entity, uuid) DO UPDATE SET deleted_at = MAX(deleted_at, excluded.deleted_at)`,
      [entity, uuid, deletedAt]
    );
  }
}
