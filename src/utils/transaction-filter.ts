import type { Transaction, TranType } from './types';
export type TransactionFilter = { search: string; type: TranType | 'ALL'; tag: string };
export function filterTransactions(rows: Transaction[], filter: TransactionFilter): Transaction[] {
  const needle=filter.search.trim().toLocaleLowerCase();
  return rows.filter(row => (filter.type==='ALL'||row.type===filter.type)
    && (!filter.tag || row.cat.split(',').map(s=>s.trim()).includes(filter.tag))
    && (!needle || [row.note,row.cat,row.date,String(row.value)].some(text=>text.toLocaleLowerCase().includes(needle))));
}
