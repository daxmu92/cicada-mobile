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

function monthFormatter(locale: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
}

export function monthShort(month1to12: number, locale: string = 'en-US'): string {
  // Use a fixed UTC date in the given month; day/year are irrelevant for 'short' month.
  return monthFormatter(locale).format(new Date(Date.UTC(2000, month1to12 - 1, 1)));
}

export function formatMonthYear(ym: string, locale: string = 'en-US'): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export function formatLongDate(isoDate: string, locale: string = 'en-US'): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}
