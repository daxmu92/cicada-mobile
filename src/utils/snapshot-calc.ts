// Pure arithmetic for the snapshot auto-calculate feature.
// profit = (netWorth - lastNetWorth) - inflow, and its inversion.
// Kept POLICY-FREE: callers decide WHEN to apply these. In particular
// add-record's updateNetWorth intentionally suppresses recompute when
// editing an existing snapshot (its `!hasExisting` guard) — that policy
// stays in the caller and must NOT be baked in here.

export function computeProfit(netWorth: number, lastNetWorth: number, inflow: number): number {
  return netWorth - lastNetWorth - inflow;
}

export function computeInflow(netWorth: number, lastNetWorth: number, profit: number): number {
  return netWorth - lastNetWorth - profit;
}
