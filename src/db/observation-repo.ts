import { calendarChanges } from '../utils/observation';
import { prevYearMonth } from '../utils/date';
import type { SnapshotWithAsset } from '../utils/types';
import { getDatabase } from './database';
import { readCached } from './query-cache';
export type ObservationMetadata = { latestMonth: string | null; latestTransaction: string | null; activeAssets: number; recordedActive: number };
export function getObservationMetadata(month: string): Promise<ObservationMetadata> {
 return readCached(['observation',month],async()=>{
  const db=await getDatabase();
  return (await db.getFirstAsync<ObservationMetadata>(`SELECT
   (SELECT MAX(date) FROM asset_snapshot) AS latestMonth,
   (SELECT MAX(date) FROM tran) AS latestTransaction,
   (SELECT COUNT(*) FROM asset a JOIN account acc ON acc.id=a.account_id WHERE a.archived=0 AND acc.archived=0) AS activeAssets,
   (SELECT COUNT(*) FROM asset a JOIN account acc ON acc.id=a.account_id JOIN asset_snapshot s ON s.asset_id=a.id WHERE a.archived=0 AND acc.archived=0 AND s.date=?) AS recordedActive`,[month]))!;
 });
}

export function getTrendCoverage(start:string,end:string){
 return readCached(['trend-coverage',start,end],async()=>{
  const db=await getDatabase();
  return db.getAllAsync<{date:string;recordedActive:number}>(`SELECT s.date,SUM(CASE WHEN a.archived=0 AND acc.archived=0 THEN 1 ELSE 0 END) AS recordedActive FROM asset_snapshot s JOIN asset a ON a.id=s.asset_id JOIN account acc ON acc.id=a.account_id WHERE s.date>=? AND s.date<=? GROUP BY s.date`,[start,end]);
 });
}
export function getCalendarChanges(start:string,end:string){
 return readCached(['calendar-comparison',start,end],async()=>{
  const db=await getDatabase();
  const rows=await db.getAllAsync<SnapshotWithAsset>(`SELECT s.asset_id AS assetId,s.date,s.net_worth AS netWorth,s.inflow,s.profit,a.name AS assetName,acc.name AS accountName FROM asset_snapshot s JOIN asset a ON a.id=s.asset_id JOIN account acc ON acc.id=a.account_id WHERE s.date>=? AND s.date<=? ORDER BY s.date,s.asset_id`,[prevYearMonth(start),end]);
  return calendarChanges(start,end,rows);
 });
}
