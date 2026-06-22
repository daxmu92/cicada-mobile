import { createAccount } from '../db/account-repo';
import { createAsset } from '../db/asset-repo';
import { upsertSnapshot } from '../db/snapshot-repo';
import { createTransaction } from '../db/tran-repo';
import { getDatabase } from '../db/database';
import { eraseAllData } from '../sync/erase';
import { tick } from '../sync/clock';
import { syncScheduler } from '../sync/scheduler';
import { currentYearMonth, prevYearMonth } from '../utils/date';

type SampleAsset = {
  account: string;
  name: string;
  categories: Record<string, string>;
  initialValue: number;
  monthlyInflow: number;
  volatility: number;
};

const SAMPLE_ASSETS: SampleAsset[] = [
  {
    account: 'Main Bank',
    name: 'Checking',
    categories: { Risk: 'Low', Type: 'Cash' },
    initialValue: 5000,
    monthlyInflow: 500,
    volatility: 0.0,
  },
  {
    account: 'Main Bank',
    name: 'Savings',
    categories: { Risk: 'Low', Type: 'Cash' },
    initialValue: 20000,
    monthlyInflow: 800,
    volatility: 0.01,
  },
  {
    account: 'Brokerage',
    name: 'Index Funds',
    categories: { Risk: 'Medium', Type: 'Stock' },
    initialValue: 35000,
    monthlyInflow: 1500,
    volatility: 0.06,
  },
  {
    account: 'Brokerage',
    name: 'Tech Stocks',
    categories: { Risk: 'High', Type: 'Stock' },
    initialValue: 15000,
    monthlyInflow: 500,
    volatility: 0.12,
  },
  {
    account: 'Crypto',
    name: 'BTC',
    categories: { Risk: 'High', Type: 'Crypto' },
    initialValue: 8000,
    monthlyInflow: 300,
    volatility: 0.2,
  },
  {
    account: 'Retirement',
    name: '401k',
    categories: { Risk: 'Medium', Type: 'Retirement' },
    initialValue: 45000,
    monthlyInflow: 1200,
    volatility: 0.04,
  },
];

const INCOME_TAGS = ['salary', 'bonus', 'dividend', 'freelance'];
const OUTLAY_TAGS = ['food', 'rent', 'transport', 'utilities', 'entertainment', 'shopping', 'travel'];

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function pastMonths(count: number): string[] {
  const result: string[] = [];
  let cur = currentYearMonth();
  for (let i = 0; i < count; i++) {
    result.unshift(cur);
    cur = prevYearMonth(cur);
  }
  return result;
}

export async function loadSampleData(options: {
  monthsOfHistory?: number;
  transactionsPerMonth?: number;
} = {}): Promise<void> {
  const { monthsOfHistory = 24, transactionsPerMonth = 12 } = options;

  const db = await getDatabase();
  await eraseAllData(db, { tick });

  // Create accounts
  const accountIds = new Map<string, number>();
  const accountNames = Array.from(new Set(SAMPLE_ASSETS.map((a) => a.account)));
  for (const name of accountNames) {
    accountIds.set(name, await createAccount(name));
  }

  // Create assets and their snapshots
  const months = pastMonths(monthsOfHistory);
  const rng = random(42);

  for (const asset of SAMPLE_ASSETS) {
    const accountId = accountIds.get(asset.account)!;
    const assetId = await createAsset(accountId, asset.name, asset.categories);

    let netWorth = asset.initialValue;
    for (const date of months) {
      const inflow = asset.monthlyInflow * (0.7 + rng() * 0.6);
      const returnRate = (rng() - 0.45) * asset.volatility * 2;
      const profit = netWorth * returnRate;
      netWorth = netWorth + inflow + profit;
      await upsertSnapshot(
        assetId,
        date,
        Math.round(netWorth * 100) / 100,
        Math.round(inflow * 100) / 100,
        Math.round(profit * 100) / 100
      );
    }
  }

  // Create transactions for the last 3 months
  const txRng = random(123);
  const recentMonths = months.slice(-3);
  for (const month of recentMonths) {
    for (let i = 0; i < transactionsPerMonth; i++) {
      const day = Math.floor(txRng() * 28) + 1;
      const date = `${month}-${String(day).padStart(2, '0')}`;
      const isIncome = txRng() < 0.25;

      if (isIncome) {
        const tag = INCOME_TAGS[Math.floor(txRng() * INCOME_TAGS.length)];
        const value = tag === 'salary' ? 4000 + txRng() * 1000 : 100 + txRng() * 800;
        await createTransaction(date, 'INCOME', Math.round(value), tag, '');
      } else {
        const tag = OUTLAY_TAGS[Math.floor(txRng() * OUTLAY_TAGS.length)];
        const base = tag === 'rent' ? 1500 : tag === 'food' ? 80 : 30 + txRng() * 200;
        const value = Math.round(base * (0.8 + txRng() * 0.4));
        await createTransaction(date, 'OUTLAY', value, tag, '');
      }
    }
  }
  syncScheduler.markDirty();
  await syncScheduler.requestSync('manual').catch(() => {});
}
