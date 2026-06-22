// Pure grouping logic for the Analysis tab's composition donut.
// NO imports from react-native / ./theme / i18n — must run under `node --test`.
// The caller supplies display strings (uncategorized/others) and assigns colors
// by slice index, keeping this module pure and unit-testable.

export const ACCOUNT_DIMENSION = '__account__';

export type CompositionInput = {
  assetId: number;
  accountName: string;
  categories: Record<string, string>;
  netWorth: number;
};

export type CompositionSlice = {
  key: string; // stable bucket identity (NOT the display label)
  label: string; // display text
  value: number;
};

export type CompositionResult = {
  slices: CompositionSlice[]; // positive buckets, sorted desc, capped to 8
  chartedTotal: number; // sum of slice values (the positive subtotal)
  trueTotal: number; // sum of ALL inputs incl. negatives
  excludedCount: number; // net <= 0 buckets not charted
};

const MAX_SLICES = 8;
const UNCAT_KEY = '__uncat__';
const OTHERS_KEY = '__others__';

/** Distinct dimensions: account first, then sorted category keys present. */
export function compositionDimensions(items: CompositionInput[]): string[] {
  const keys = new Set<string>();
  for (const it of items) {
    for (const k of Object.keys(it.categories)) {
      const v = it.categories[k];
      if (v != null && v !== '') keys.add(k);
    }
  }
  return [ACCOUNT_DIMENSION, ...[...keys].sort()];
}

export function compositionSlices(
  items: CompositionInput[],
  dimension: string,
  labels: { uncategorized: string; others: string }
): CompositionResult {
  const buckets = new Map<string, { label: string; value: number }>();
  let trueTotal = 0;

  for (const it of items) {
    trueTotal += it.netWorth;
    let key: string;
    let label: string;
    if (dimension === ACCOUNT_DIMENSION) {
      key = `acc:${it.accountName}`;
      label = it.accountName;
    } else {
      const v = it.categories[dimension];
      if (v == null || v === '') {
        key = UNCAT_KEY;
        label = labels.uncategorized;
      } else {
        key = `cat:${v}`;
        label = v;
      }
    }
    const b = buckets.get(key);
    if (b) b.value += it.netWorth;
    else buckets.set(key, { label, value: it.netWorth });
  }

  const all = [...buckets.entries()].map(([key, b]) => ({ key, label: b.label, value: b.value }));
  const positives = all.filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const excludedCount = all.length - positives.length;

  let slices: CompositionSlice[] = positives;
  if (positives.length > MAX_SLICES) {
    const head = positives.slice(0, MAX_SLICES - 1);
    const tail = positives.slice(MAX_SLICES - 1);
    const othersValue = tail.reduce((sum, s) => sum + s.value, 0);
    slices = [...head, { key: OTHERS_KEY, label: labels.others, value: othersValue }];
  }

  const chartedTotal = slices.reduce((sum, s) => sum + s.value, 0);
  return { slices, chartedTotal, trueTotal, excludedCount };
}
