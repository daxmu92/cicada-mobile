// Hybrid Logical Clock — pure encoding + ordering core.
// Imports NOTHING (no DB, no Date, no RN/Expo) so it is unit-testable under
// `node --test`. The stateful tick() that reads Date.now() and persists state
// lives in clock.ts.

export const HLC_PHYS_DIGITS = 15;
export const HLC_COUNTER_DIGITS = 5;
export const HLC_DEVICE_DIGITS = 6;
export const HLC_COUNTER_MAX = 99999; // largest value that fits HLC_COUNTER_DIGITS

export type HlcState = { phys: number; counter: number };

/** Fixed-width string so a plain ordinal compare IS the HLC compare. */
export function encodeHlc(phys: number, counter: number, deviceId: string): string {
  const p = String(phys).padStart(HLC_PHYS_DIGITS, '0');
  const c = String(counter).padStart(HLC_COUNTER_DIGITS, '0');
  const d = deviceId.padStart(HLC_DEVICE_DIGITS, '0').slice(0, HLC_DEVICE_DIGITS);
  return `${p}-${c}-${d}`;
}

export function parseHlc(ts: string): { phys: number; counter: number; deviceId: string } {
  const [p, c, d] = ts.split('-');
  return { phys: Number(p), counter: Number(c), deviceId: d };
}

/** Advance the clock for a new LOCAL event happening at `now` (ms). */
export function advanceLocal(prev: HlcState, now: number): HlcState {
  const phys = Math.max(now, prev.phys);
  const counter = phys === prev.phys ? prev.counter + 1 : 0;
  if (counter > HLC_COUNTER_MAX) {
    return { phys: phys + 1, counter: 0 };
  }
  return { phys, counter };
}

/**
 * Advance the clock on RECEIVING a remote event stamped `remote`, at local time
 * `now` (ms). Standard HLC receive: take the greatest physical time, and bump the
 * counter of whichever component(s) tie it. Guarantees the next encoded stamp
 * sorts after both the local history and the remote event just merged in.
 */
export function receive(local: HlcState, remote: HlcState, now: number): HlcState {
  const phys = Math.max(now, local.phys, remote.phys);
  let counter: number;
  if (phys === local.phys && phys === remote.phys) {
    counter = Math.max(local.counter, remote.counter) + 1;
  } else if (phys === local.phys) {
    counter = local.counter + 1;
  } else if (phys === remote.phys) {
    counter = remote.counter + 1;
  } else {
    counter = 0;
  }
  if (counter > HLC_COUNTER_MAX) {
    return { phys: phys + 1, counter: 0 };
  }
  return { phys, counter };
}

/** Ordinal compare. Returns -1 | 0 | 1. NEVER use localeCompare here. */
export function compareHlc(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
