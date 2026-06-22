import type { CicadaDB } from '../db/migrations';
import { tick } from './clock';
import { recordTombstonesAt, type Entity } from './tombstone';

export type { Entity };
export { recordTombstonesAt };

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

/** Record tombstones for a delete, minting one fresh HLC for the group. */
export async function recordTombstones(
  db: CicadaDB,
  entity: Entity,
  uuids: string[]
): Promise<void> {
  if (uuids.length === 0) return;
  const deletedAt = await tick();
  await recordTombstonesAt(db, entity, uuids, deletedAt);
}
