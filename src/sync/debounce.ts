export type DebouncerOpts = {
  delayMs: number;
  maxWaitMs: number;
  now: () => number;
  schedule: (ms: number, fn: () => void) => any;
  cancel: (t: any) => void;
};

/** Trailing debounce with a hard ceiling: flush `delayMs` after the last bump,
 *  but never wait longer than `maxWaitMs` since the first un-flushed bump. */
export function createDebouncer(opts: DebouncerOpts, flush: () => void) {
  let timer: any = null;
  let firstBumpAt: number | null = null;

  const clear = () => { if (timer !== null) { opts.cancel(timer); timer = null; } };
  const run = () => { clear(); firstBumpAt = null; flush(); };

  const bump = () => {
    const t = opts.now();
    if (firstBumpAt === null) firstBumpAt = t;
    clear();
    const untilCeiling = opts.maxWaitMs - (t - firstBumpAt);
    const wait = Math.max(0, Math.min(opts.delayMs, untilCeiling));
    timer = opts.schedule(wait, run);
  };

  return { bump, cancel: () => { clear(); firstBumpAt = null; } };
}
