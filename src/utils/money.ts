import { requireAmount } from './validation';

/** App locales use '.' decimals. Commas are accepted only as complete grouping. */
export function parseAmount(text: string, allowBlank = false): number {
  const value = text.trim();
  if (!value && allowBlank) return 0;
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(value)) throw new Error('Invalid amount');
  const amount = Number(value.replace(/,/g, ''));
  requireAmount(amount, 'amount');
  return amount;
}

export function tryAmount(text: string): number | null {
  try { return parseAmount(text, true); } catch { return null; }
}

/** Round binary input noise at the currency boundary, using decimal digits. */
export function minorUnits(value: number): number {
  requireAmount(value, 'amount');
  const sign = value < 0 ? -1 : 1;
  const [mantissa, exponent = '0'] = Math.abs(value).toString().split('e');
  const [whole, fraction = ''] = mantissa.split('.');
  const coefficient = BigInt(whole + fraction);
  const shift = 2 + Number(exponent) - fraction.length;
  const rounded = Number(shift >= 0
    ? coefficient * 10n ** BigInt(shift)
    : (coefficient + 10n ** BigInt(-shift) / 2n) / 10n ** BigInt(-shift));
  if (!Number.isSafeInteger(rounded)) throw new Error('Amount is too large');
  return sign * rounded;
}

export function subtractAmounts(...values: number[]): number {
  if (!values.length) return 0;
  return (minorUnits(values[0]) - values.slice(1).reduce((sum, value) => sum + minorUnits(value), 0)) / 100;
}
