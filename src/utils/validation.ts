export function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: expected an object`);
  return value as Record<string, unknown>;
}
export function requireText(value: unknown, label: string, allowEmpty = false): asserts value is string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '') || value.length > 100_000) throw new Error(`${label}: invalid text`);
}
export function requireAmount(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER / 100) throw new Error(`${label}: invalid amount`);
}
export function requireId(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error(`${label}: invalid id`);
}
export function isYearMonth(value: unknown): value is string {
  return typeof value === 'string' && /^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(value);
}
export function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) return false;
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export function requireMonth(value: unknown, label: string): asserts value is string {
  if (!isYearMonth(value)) throw new Error(`${label}: invalid month (YYYY-MM)`);
}
export function requireDate(value: unknown, label: string): asserts value is string {
  if (!isDate(value)) throw new Error(`${label}: invalid date (YYYY-MM-DD)`);
}
export function requireStamp(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^\d{15}-\d{5}-[a-zA-Z0-9]{6}$/.test(value)) throw new Error(`${label}: invalid timestamp`);
}
export function requireCategories(value: unknown, label: string): void {
  requireText(value, label, true);
  let decoded: unknown;
  try { decoded = JSON.parse(value); } catch { throw new Error(`${label}: invalid categories JSON`); }
  const object = requireRecord(decoded, label);
  for (const [key, val] of Object.entries(object)) { requireText(key, label); requireText(val, label, true); }
}
export function requireArchived(value: unknown, label: string): void {
  if (value !== 0 && value !== 1) throw new Error(`${label}: expected 0 or 1`);
}
export function uniqueKey(seen: Set<string | number>, value: string | number, label: string): void {
  if (seen.has(value)) throw new Error(`${label}: duplicate key`);
  seen.add(value);
}
export function validateTombstones(value: unknown): void {
  if (!Array.isArray(value)) throw new Error('tombstones: expected an array');
  const keys = new Set<string>();
  for (const entry of value) {
    const t = requireRecord(entry, 'tombstone');
    if (!['account', 'asset', 'snapshot', 'tran'].includes(String(t.entity))) throw new Error('tombstone: invalid entity');
    requireText(t.uuid, 'tombstone.uuid'); requireStamp(t.deleted_at, 'tombstone.deleted_at');
    if (t.entity === 'snapshot') {
      const parts = t.uuid.split('|');
      if (parts.length !== 2 || !parts[0] || !isYearMonth(parts[1])) throw new Error('tombstone: invalid snapshot key');
    }
    uniqueKey(keys, `${t.entity}|${t.uuid}`, 'tombstone');
  }
}
