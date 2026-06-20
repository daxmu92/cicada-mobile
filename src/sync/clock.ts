import { advanceLocal, encodeHlc, type HlcState } from './hlc';
import { getDeviceId } from './device';
import { getSyncState, setSyncState } from './sync-state-repo';

const HLC_KEY = 'hlc';

// Serialize ticks so a read-modify-write of the persisted state can never
// interleave (e.g. an upsert loop), which would otherwise mint duplicate HLCs.
let queue: Promise<unknown> = Promise.resolve();

async function doTick(): Promise<string> {
  const raw = await getSyncState(HLC_KEY);
  const prev: HlcState = raw ? (JSON.parse(raw) as HlcState) : { phys: 0, counter: 0 };
  const next = advanceLocal(prev, Date.now());
  await setSyncState(HLC_KEY, JSON.stringify(next));
  const deviceId = await getDeviceId();
  return encodeHlc(next.phys, next.counter, deviceId);
}

/** Next local HLC timestamp. Awaitable; serialized against concurrent callers. */
export function tick(): Promise<string> {
  const run = queue.then(doTick, doTick);
  // Swallow errors on the queue tail so one failed tick can't wedge the chain.
  queue = run.catch(() => undefined);
  return run;
}
