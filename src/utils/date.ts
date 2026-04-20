export function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function currentDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function currentYear(): number {
  return new Date().getFullYear();
}

export function currentMonth(): number {
  return new Date().getMonth() + 1;
}

export function yearMonth(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function prevYearMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (m === 1) return yearMonth(y - 1, 12);
  return yearMonth(y, m - 1);
}

export function nextYearMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (m === 12) return yearMonth(y + 1, 1);
  return yearMonth(y, m + 1);
}

export function yearMonthList(start: string, end: string): string[] {
  const result: string[] = [];
  let cur = start;
  while (cur <= end) {
    result.push(cur);
    cur = nextYearMonth(cur);
  }
  return result;
}

export const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
