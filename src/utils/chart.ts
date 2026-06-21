// Shared helpers for the line charts (home hero + asset detail).

/**
 * Abbreviate axis values: 1284500 → "1.3M", 1500 → "1.5K", 2000 → "2K",
 * 305699 → "306K". Uses one decimal below 10× a unit so adjacent steps like
 * 1500/2000 don't both round to "2K"; whole multiples drop the ".0".
 */
export function abbrev(n: number): string {
  const a = Math.abs(n);
  const fmt = (v: number, suffix: string) =>
    (Math.abs(v) < 10 ? v.toFixed(1).replace(/\.0$/, '') : String(Math.round(v))) + suffix;
  if (a >= 1e9) return fmt(n / 1e9, 'B');
  if (a >= 1e6) return fmt(n / 1e6, 'M');
  if (a >= 1e3) return fmt(n / 1e3, 'K');
  return String(Math.round(n));
}

export type NiceAxis = {
  offset: number; // baseline value (may be negative); subtract from data before plotting
  top: number; // top value
  niceStep: number; // value per gridline section
  noOfSections: number;
};

/**
 * Compute a "nice" axis range that does NOT start at zero, so the line uses the
 * full vertical space (and negative series stay visible) instead of being
 * clipped at a zero baseline. Handles negative, flat, and all-equal series.
 */
export function niceAxis(min: number, max: number, sections: number): NiceAxis {
  let span = max - min;
  if (span <= 0) span = Math.abs(max) || 1; // flat / all-equal fallback
  const rawStep = span / sections;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const niceStep = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const pad = span * 0.08; // breathing room so the line never touches the edges
  const offset = Math.floor((min - pad) / niceStep) * niceStep;
  const top = Math.ceil((max + pad) / niceStep) * niceStep;
  const noOfSections = Math.max(1, Math.round((top - offset) / niceStep));
  return { offset, top, niceStep, noOfSections };
}
