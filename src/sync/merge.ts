import { compareHlc } from './hlc';
import type {
  SyncDocument,
  SyncTables,
  TombstoneRecord,
} from './document';

export type MergeResult = {
  tables: SyncTables;
  tombstones: TombstoneRecord[];
};

const snapshotKey = (s: { assetUuid: string; date: string }): string =>
  `${s.assetUuid}|${s.date}`;

/** Keep, per key, the record with the greater stamp (ordinal HLC compare). */
function mergeByKey<T>(
  local: T[],
  remote: T[],
  key: (r: T) => string,
  stamp: (r: T) => string
): Map<string, T> {
  const out = new Map<string, T>();
  for (const r of local) out.set(key(r), r);
  for (const r of remote) {
    const k = key(r);
    const cur = out.get(k);
    if (!cur || compareHlc(stamp(r), stamp(cur)) > 0) out.set(k, r);
  }
  return out;
}

export function merge(local: SyncDocument, remote: SyncDocument): MergeResult {
  // Tombstones compete like records, keyed "<entity>|<uuid>", by deleted_at.
  const tombMap = mergeByKey(
    local.tombstones,
    remote.tombstones,
    (t) => `${t.entity}|${t.uuid}`,
    (t) => t.deleted_at
  );

  const accounts = mergeByKey(local.tables.account, remote.tables.account, (r) => r.uuid, (r) => r.updated_at);
  const assets = mergeByKey(local.tables.asset, remote.tables.asset, (r) => r.uuid, (r) => r.updated_at);
  const snapshots = mergeByKey(local.tables.snapshot, remote.tables.snapshot, snapshotKey, (r) => r.updated_at);
  const trans = mergeByKey(local.tables.tran, remote.tables.tran, (r) => r.uuid, (r) => r.updated_at);
  const settings = mergeByKey(local.tables.setting, remote.tables.setting, (r) => r.key, (r) => r.updated_at);

  // A record is suppressed when a tombstone for the same entity+key is at least
  // as new as the record (delete wins ties; HLC ties across devices are
  // impossible — different deviceId — and on one device tick() is strictly
  // increasing, so "tie" never arises in practice).
  const live = <T>(
    entity: string,
    map: Map<string, T>,
    tombKey: (r: T) => string,
    stamp: (r: T) => string
  ): T[] => {
    const result: T[] = [];
    for (const r of map.values()) {
      const t = tombMap.get(`${entity}|${tombKey(r)}`);
      if (t && compareHlc(t.deleted_at, stamp(r)) >= 0) continue;
      result.push(r);
    }
    return result;
  };

  return {
    tables: {
      account: live('account', accounts, (r) => r.uuid, (r) => r.updated_at),
      asset: live('asset', assets, (r) => r.uuid, (r) => r.updated_at),
      snapshot: live('snapshot', snapshots, snapshotKey, (r) => r.updated_at),
      tran: live('tran', trans, (r) => r.uuid, (r) => r.updated_at),
      setting: Array.from(settings.values()), // settings are never tombstoned
    },
    tombstones: Array.from(tombMap.values()),
  };
}
