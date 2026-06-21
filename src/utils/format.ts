export function formatCurrency(
  value: number,
  symbol: string = '$',
  locale: string = 'en-US'
): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const body = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(abs);
  return `${sign}${symbol}${body}`;
}

export function formatSigned(
  value: number,
  symbol: string = '$',
  locale: string = 'en-US'
): string {
  const arrow = value >= 0 ? '▲' : '▼';
  return `${arrow} ${formatCurrency(Math.abs(value), symbol, locale)}`;
}

export function formatCurrencyCompact(
  value: number,
  symbol: string = '$',
  locale: string = 'en-US'
): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.round(Math.abs(value));
  const body = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(abs);
  return `${sign}${symbol}${body}`;
}

export function formatSignedCompact(
  value: number,
  symbol: string = '$',
  locale: string = 'en-US'
): string {
  const arrow = value >= 0 ? '▲' : '▼';
  return `${arrow} ${formatCurrencyCompact(Math.abs(value), symbol, locale)}`;
}
