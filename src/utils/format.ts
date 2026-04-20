export function formatCurrency(value: number, symbol: string = '$'): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const parts = abs.toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${symbol}${parts.join('.')}`;
}

export function formatSigned(value: number, symbol: string = '$'): string {
  const arrow = value >= 0 ? '▲' : '▼';
  return `${arrow} ${formatCurrency(Math.abs(value), symbol)}`;
}
