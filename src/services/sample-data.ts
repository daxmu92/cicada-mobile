import { getDatabase } from '../db/database';
import { tick } from '../sync/clock';
import { syncScheduler } from '../sync/scheduler';
import { notifyDataChanged } from '../db/changes';
import { replaceBackupDoc, type BackupFile } from './backup-core';
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

export function buildSampleData(options: { monthsOfHistory?: number; transactionsPerMonth?: number } = {}): BackupFile {
  const { monthsOfHistory = 24, transactionsPerMonth = 12 } = options;
  const names = Array.from(new Set(SAMPLE_ASSETS.map((a) => a.account)));
  const accountIds = new Map(names.map((name, i) => [name, i + 1]));
  const doc: BackupFile = { version: 2, exportedAt: new Date().toISOString(), accounts: names.map((name, i) => ({ id: i + 1, name, archived: 0 })), assets: [], snapshots: [], transactions: [], settings: {} };
  const months = pastMonths(monthsOfHistory); const rng = random(42);
  for (const [i, asset] of SAMPLE_ASSETS.entries()) {
    const assetId = i + 1;
    doc.assets.push({ id: assetId, accountId: accountIds.get(asset.account)!, name: asset.name, categories: JSON.stringify(asset.categories), archived: 0 });
    let netWorth = asset.initialValue;
    for (const date of months) {
      const inflow = asset.monthlyInflow * (0.7 + rng() * 0.6);
      const profit = netWorth * (rng() - 0.45) * asset.volatility * 2;
      netWorth += inflow + profit;
      doc.snapshots.push({ assetId, date, netWorth: Math.round(netWorth * 100) / 100, inflow: Math.round(inflow * 100) / 100, profit: Math.round(profit * 100) / 100 });
    }
  }
  const txRng = random(123);
  for (const month of months.slice(-3)) {
    for (let i = 0; i < transactionsPerMonth; i++) {
      const day = Math.floor(txRng() * 28) + 1;
      const date = `${month}-${String(day).padStart(2, '0')}`;
      const isIncome = txRng() < 0.25;
      const tags = isIncome ? INCOME_TAGS : OUTLAY_TAGS;
      const cat = tags[Math.floor(txRng() * tags.length)];
      const value = isIncome
        ? Math.round(cat === 'salary' ? 4000 + txRng() * 1000 : 100 + txRng() * 800)
        : Math.round((cat === 'rent' ? 1500 : cat === 'food' ? 80 : 30 + txRng() * 200) * (0.8 + txRng() * 0.4));
      doc.transactions.push({ id: doc.transactions.length + 1, date, type: isIncome ? 'INCOME' : 'OUTLAY', value, cat, note: '' });
    }
  }
  return doc;
}

export async function loadSampleData(options: { monthsOfHistory?: number; transactionsPerMonth?: number } = {}): Promise<void> {
  const data = buildSampleData(options);
  await syncScheduler.runExclusive(async (sync) => {
    await sync().catch(() => {});
    const deletedAt = await tick(); const freshStamp = await tick();
    await replaceBackupDoc(await getDatabase(), data, { deletedAt, freshStamp });
    notifyDataChanged(); syncScheduler.markDirty();
    await sync().catch(() => {});
  });
}
