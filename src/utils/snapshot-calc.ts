// Pure arithmetic for the snapshot auto-calculate feature.
// profit = (netWorth - lastNetWorth) - inflow, and its inversion.
// Kept POLICY-FREE: callers decide WHEN to apply these. In particular
// add-record's updateNetWorth intentionally suppresses recompute when
// editing an existing snapshot (its `!hasExisting` guard) — that policy
// stays in the caller and must NOT be baked in here.

// Round to 1 decimal place, dropping trailing zeros (e.g. 1234.0 -> 1234,
// 123.45 -> 123.5, and the float-subtraction noise 0.30000000000000004 ->
// 0.3). Applied to the auto-calculated result only — values the user types
// are never touched.
function round1(value: number): number {
  return parseFloat(value.toFixed(1));
}

export function computeProfit(netWorth: number, lastNetWorth: number, inflow: number): number {
  return round1(netWorth - lastNetWorth - inflow);
}

export function computeInflow(netWorth: number, lastNetWorth: number, profit: number): number {
  return round1(netWorth - lastNetWorth - profit);
}
