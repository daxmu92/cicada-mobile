import type { CicadaDB } from './migrations';
import { requireMonth } from '../utils/validation';
import type { SnapshotWithAsset } from '../utils/types';
export type ValuationOptions = { forwardFill?: boolean; includeArchived?: boolean };

// Archived history stays visible; only active assets receive inferred values.
const historyFilter = (options: ValuationOptions) => options.includeArchived === false ? 'AND a.archived = 0 AND acc.archived = 0' : '';
export async function monthValuation(db: CicadaDB, date: string, options: ValuationOptions = {}): Promise<SnapshotWithAsset[]> {
  requireMonth(date, 'valuation.date');
  const rows = await db.getAllAsync<{ asset_id: number; source_date: string; net_worth: number; inflow: number; profit: number; asset_name: string; account_name: string }>(`
    SELECT a.id AS asset_id, s.date AS source_date, s.net_worth, s.inflow, s.profit,
           a.name AS asset_name, acc.name AS account_name
      FROM asset a JOIN account acc ON acc.id = a.account_id
      JOIN asset_snapshot s ON s.asset_id = a.id AND s.date = (
        SELECT MAX(p.date) FROM asset_snapshot p WHERE p.asset_id = a.id
          AND (p.date = ? OR (? = 1 AND a.archived = 0 AND acc.archived = 0 AND p.date < ?))
      ) WHERE 1 = 1 ${historyFilter(options)} ORDER BY acc.name, a.name
  `, [date, options.forwardFill ? 1 : 0, date]);
  return rows.map((r) => ({ assetId: r.asset_id, date, netWorth: r.net_worth,
    inflow: r.source_date === date ? r.inflow : 0, profit: r.source_date === date ? r.profit : 0,
    assetName: r.asset_name, accountName: r.account_name, estimated: r.source_date !== date, sourceDate: r.source_date }));
}
export async function monthlyValuations(db: CicadaDB, start: string, end: string, options: ValuationOptions = {}): Promise<{ date: string; netWorth: number; profit: number; inflow: number }[]> {
  requireMonth(start, 'valuation.start'); requireMonth(end, 'valuation.end');
  if (start > end) return [];
  return db.getAllAsync(`WITH RECURSIVE months(date) AS (
      SELECT ? UNION ALL SELECT strftime('%Y-%m',date(date || '-01','+1 month')) FROM months WHERE date < ?
    ) SELECT m.date AS date, SUM(s.net_worth) AS netWorth,
      SUM(CASE WHEN s.date=m.date THEN s.profit ELSE 0 END) AS profit,
      SUM(CASE WHEN s.date=m.date THEN s.inflow ELSE 0 END) AS inflow
    FROM months m CROSS JOIN asset a JOIN account acc ON acc.id=a.account_id
    JOIN asset_snapshot s ON s.asset_id=a.id AND s.date=(
      SELECT MAX(p.date) FROM asset_snapshot p WHERE p.asset_id=a.id
        AND (p.date=m.date OR (?=1 AND a.archived=0 AND acc.archived=0 AND p.date<m.date))
    ) WHERE 1=1 ${historyFilter(options)} GROUP BY m.date ORDER BY m.date`, [start, end, options.forwardFill ? 1 : 0]);
}
