import { yearMonthList, prevYearMonth } from './date';
import type { SnapshotWithAsset } from './types';
const cents = (n: number) => Math.round(n * 100);
export function compareRecordedAssets(current: SnapshotWithAsset[], previous: SnapshotWithAsset[]) {
  const prior = new Map(previous.filter(row => !row.estimated).map(row => [row.assetId, row]));
  const pairs = current.filter(row => !row.estimated && prior.has(row.assetId));
  if (!pairs.length) return { count: 0, change: null, percent: null, inflow: null, profit: null, residual: null };
  const before = pairs.reduce((n, row) => n + cents(prior.get(row.assetId)!.netWorth), 0);
  const after = pairs.reduce((n, row) => n + cents(row.netWorth), 0);
  const inflow = pairs.reduce((n, row) => n + cents(row.inflow), 0);
  const profit = pairs.reduce((n, row) => n + cents(row.profit), 0);
  const change = after - before;
  return { count: pairs.length, change: change / 100, percent: before ? change / Math.abs(before) * 100 : null, inflow: inflow / 100, profit: profit / 100, residual: (change - inflow - profit) / 100 };
}
export function completeTrend(start: string, end: string, rows: { date: string; netWorth: number }[]) {
  const values = new Map(rows.map(row => [row.date, row.netWorth]));
  return yearMonthList(start, end).map(label => ({ label, value: values.get(label) ?? null }));
}
export function trendPath(points: { value: number | null }[], x: (index: number) => number, y: (value: number) => number) {
  let connected = false;
  return points.map((point, index) => {
    if (point.value === null) { connected = false; return ''; }
    const command = connected ? 'L' : 'M'; connected = true;
    return `${command}${x(index)},${y(point.value)}`;
  }).join(' ');
}
export function calendarChanges(start:string,end:string,rows:SnapshotWithAsset[]){
 const months=new Map<string,SnapshotWithAsset[]>();
 for(const row of rows){const values=months.get(row.date)??[];values.push(row);months.set(row.date,values);}
 return yearMonthList(start,end).map(date=>({date,...compareRecordedAssets(months.get(date)??[],months.get(prevYearMonth(date))??[])}));
}
