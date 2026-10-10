import { subtractAmounts } from './money';

export function computeProfit(netWorth: number, lastNetWorth: number, inflow: number): number {
  return subtractAmounts(netWorth, lastNetWorth, inflow);
}

export function computeInflow(netWorth: number, lastNetWorth: number, profit: number): number {
  return subtractAmounts(netWorth, lastNetWorth, profit);
}
