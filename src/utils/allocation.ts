export type AllocationRow = { label: string; value: number; key?: string; color?: string };
export function allocationRows(items: AllocationRow[], maxItems: number, others: string) {
  const positive = items.filter(row => row.value > 0).sort((a,b) => b.value-a.value);
  const total = positive.reduce((sum,row)=>sum+row.value,0);
  const liabilities = items.filter(row=>row.value<0).reduce((sum,row)=>sum+Math.abs(row.value),0);
  const cap = Math.max(2, maxItems);
  const visible = positive.length > cap
    ? [...positive.slice(0,cap-1),{key:'__others__',label:others,value:positive.slice(cap-1).reduce((sum,row)=>sum+row.value,0)}]
    : positive;
  return { visible, total, liabilities };
}
